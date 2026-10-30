import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const transactionId = '00000000-0000-4000-8000-000000000001';
const recordId = '10000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000001';

class InterReviewError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function loadRoute(options = {}) {
  const calls = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: options.transaction === false ? null : { id: transactionId }, error: null }),
  };
  const dependencies = {
    'next/server': {
      NextResponse: {
        json: (body, init) => new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => options.denied
        ? { ok: false, status: 401, error: 'Sessão inválida.' }
        : { ok: true, user: { id: actorId, email: 'admin@example.test' } },
    },
    '@/lib/holding-permissions': {
      userCanAccessResource: async (_email, resource) => resource === 'menu.financeiro'
        ? options.financeAllowed !== false
        : options.paidAllowed !== false,
    },
    '@/lib/bank-sync': {
      InterReviewError,
      resolveInterReview: async (input) => {
        calls.push({ kind: 'resolve', input });
        if (options.resolveError) throw options.resolveError;
        return { action: input.action, autoClassified: false };
      },
    },
    '@/lib/supabase-server': {
      supabaseServer: {
        from: () => query,
        rpc: async (name, args) => {
          calls.push({ kind: 'rpc', name, args });
          return {
            data: options.candidates || [{
              id: recordId, status: 'pending', record_type: 'expense', value: 10, description: 'Teste',
              created_at: null, bank_account_id: null, payment_method: null,
              category: null, bank_id: null, source: null, blocked_reason: null, total_count: 21,
            }],
            error: options.rpcError || null,
          };
        },
      },
    },
  };
  const code = ts.transpileModule(readFileSync('src/app/api/system/bank-sync/reconcile/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return { ...mod.exports, calls };
}

function request(method, body, query = '') {
  return new Request(`http://localhost/api/system/bank-sync/reconcile${query}`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

test('requires authentication and finance access for review actions', async () => {
  for (const options of [{ denied: true }, { financeAllowed: false }]) {
    const route = loadRoute(options);
    const get = await route.GET(request('GET', undefined, `?transactionId=${transactionId}`));
    const post = await route.POST(request('POST', { transactionId, action: 'create' }));
    assert.equal(get.status, options.denied ? 401 : 403);
    assert.equal(post.status, options.denied ? 401 : 403);
    assert.equal(route.calls.length, 0);
  }
});

test('validates identifiers and offsets before querying', async () => {
  const route = loadRoute();
  for (const query of [
    '?transactionId=invalid',
    `?transactionId=${transactionId}&offset=-1`,
    `?transactionId=${transactionId}&offset=2147483648`,
  ]) {
    assert.equal((await route.GET(request('GET', undefined, query))).status, 400);
  }
  for (const body of ['{', null, { transactionId, action: 'link', recordId: 'invalid' }, { transactionId, action: 'ignore' }]) {
    assert.equal((await route.POST(request('POST', body))).status, 400);
  }
  assert.equal(route.calls.length, 0);
});

test('paginates candidates and does not expose internal counts in each candidate', async () => {
  const route = loadRoute();
  const response = await route.GET(request('GET', undefined, `?transactionId=${transactionId}&offset=20`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.total, 21);
  assert.equal(body.offset, 20);
  assert.equal(body.pageSize, 20);
  assert.equal(body.candidates[0].id, recordId);
  assert.equal(body.candidates[0].record_type, 'expense');
  assert.equal('total_count' in body.candidates[0], false);
  assert.deepEqual(route.calls[0].args, {
    p_transaction_id: transactionId, p_offset: 20, p_limit: 20,
  });
});

test('passes the paid-record permission and authenticated actor to the resolver', async () => {
  const route = loadRoute({ paidAllowed: false });
  const response = await route.POST(request('POST', { transactionId, action: 'link', recordId }));
  assert.equal(response.status, 200);
  assert.deepEqual(route.calls[0].input, {
    transactionId, action: 'link', recordId, allowPaid: false, actorId,
  });
  const create = await route.POST(request('POST', { transactionId, action: 'create' }));
  assert.equal(create.status, 200);
  assert.equal(route.calls[1].input.allowPaid, false);
  assert.equal(route.calls[1].input.recordId, undefined);
});

test('surfaces stale reviews, permission errors, and unexpected failures', async () => {
  const missing = loadRoute({ transaction: false });
  assert.equal((await missing.GET(request('GET', undefined, `?transactionId=${transactionId}`))).status, 404);
  const forbidden = loadRoute({ resolveError: new InterReviewError('Sem permissão.', 403) });
  assert.equal((await forbidden.POST(request('POST', { transactionId, action: 'create' }))).status, 403);
  const stale = loadRoute({ resolveError: new InterReviewError('Já resolvida.', 409) });
  assert.equal((await stale.POST(request('POST', { transactionId, action: 'create' }))).status, 409);
  const failed = loadRoute({ rpcError: { message: 'Banco indisponível.' } });
  const response = await failed.GET(request('GET', undefined, `?transactionId=${transactionId}`));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Banco indisponível/);
});
