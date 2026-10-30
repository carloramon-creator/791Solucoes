import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadRoute({ denied = false, financeAllowed = true, count = 235, reviewError = null } = {}) {
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = {}; }
    select(value) { this.selection = value; return this; }
    eq(key, value) { this.filters[key] = value; return this; }
    order() { return this; }
    limit() { return this; }
    range(start, end) { this.page = [start, end]; return this; }
    then(resolve, reject) {
      calls.push({ table: this.table, filters: this.filters, page: this.page });
      if (this.filters.status === 'revisao_duplicidade') {
        return Promise.resolve({
          data: [{ id: 'review', amount: 10 }], count, error: reviewError,
        }).then(resolve, reject);
      }
      return Promise.resolve({ data: [], count: null, error: null }).then(resolve, reject);
    }
  }
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
      authenticateHoldingAdmin: async () => denied
        ? { ok: false, status: 401, error: 'Sessão inválida.' }
        : { ok: true, user: { id: 'admin', email: 'admin@example.test' } },
    },
    '@/lib/holding-permissions': { userCanAccessResource: async () => financeAllowed },
    '@/lib/bank-sync': { suggestRulePattern: () => '', syncBankAccounts: async () => [] },
    '@/lib/supabase-server': { supabaseServer: { from: (table) => new Query(table) } },
  };
  const code = ts.transpileModule(readFileSync('src/app/api/system/bank-sync/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return { ...mod.exports, calls };
}

test('paginates the review queue while preserving the complete count', async () => {
  const route = loadRoute();
  const response = await route.GET(new Request('http://localhost/api/system/bank-sync?reviewOffset=100'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pendingReviewCount, 235);
  assert.equal(body.pendingReviews[0].id, 'review');
  assert.deepEqual(route.calls.find((call) => call.filters.status === 'revisao_duplicidade').page, [100, 199]);
});

test('rejects invalid pages and access without querying financial data', async () => {
  const invalid = loadRoute();
  assert.equal((await invalid.GET(new Request('http://localhost/api/system/bank-sync?reviewOffset=-1'))).status, 400);
  assert.equal(invalid.calls.length, 0);
  const denied = loadRoute({ denied: true });
  assert.equal((await denied.GET(new Request('http://localhost/api/system/bank-sync'))).status, 401);
  assert.equal(denied.calls.length, 0);
  const forbidden = loadRoute({ financeAllowed: false });
  assert.equal((await forbidden.GET(new Request('http://localhost/api/system/bank-sync'))).status, 403);
  assert.equal(forbidden.calls.length, 0);
});

test('reports failures instead of hiding the review queue', async () => {
  const missingCount = loadRoute({ count: null });
  assert.equal((await missingCount.GET(new Request('http://localhost/api/system/bank-sync'))).status, 500);
  const failed = loadRoute({ reviewError: { message: 'Banco indisponível.' } });
  const response = await failed.GET(new Request('http://localhost/api/system/bank-sync'));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Banco indisponível/);
});
