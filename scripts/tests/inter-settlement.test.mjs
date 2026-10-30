import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadRoute({ provider = 'inter', detached = true, denied = false, rpcError = null } = {}) {
  const writes = [];
  const rpcCalls = [];
  const record = {
    id: 'record', type: 'expense', value: 100, status: 'pending', description: 'Conta',
    category: 'Compras', bank_account_id: 'account', payment_method: 'Pix',
    metadata: {
      provider, bank_link_provider: provider, bank_tx_id: 'bank-tx', bank_confirmed_at: '2026-10-30',
    },
  };
  class Query {
    constructor() { this.action = 'select'; }
    select() { return this; }
    eq() { return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    insert(value) { this.action = 'insert'; this.value = value[0]; return this; }
    async single() {
      if (this.action === 'select') return { data: record, error: null };
      writes.push({ action: this.action, value: this.value });
      if (this.action === 'insert') return { data: { id: 'remaining', ...this.value }, error: null };
      const metadata = { ...this.value.metadata };
      if (detached) {
        delete metadata.bank_tx_id;
        delete metadata.bank_confirmed_at;
        delete metadata.bank_link_provider;
      }
      return { data: { ...record, ...this.value, metadata }, error: null };
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
    '@/lib/supabase-server': { supabaseServer: {
      from: () => new Query(),
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        return {
          error: rpcError,
          data: rpcError ? null : {
            settledRecord: { id: 'record', status: 'paid', value: 40 },
            remainingRecord: {
              id: 'remaining', status: 'pending', value: 60,
              metadata: { settlement_parent_id: 'record' },
            },
            bankReviewRequired: true,
            meta: { originalValue: 100, paidAmount: 40, difference: 60, handling: 'keep_open' },
          },
        };
      },
    } },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => denied
        ? { ok: false, status: 401, error: 'Sessão inválida.' }
        : { ok: true, user: { id: 'admin' } },
    },
  };
  const code = ts.transpileModule(readFileSync('src/app/api/system/finance-records/settle/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return { ...mod.exports, writes, rpcCalls };
}

function settleRequest(paidAmount = 40) {
  return new Request('http://localhost/api/system/finance-records/settle', {
    method: 'POST',
    body: JSON.stringify({ recordId: 'record', paidAmount, differenceHandling: 'keep_open' }),
  });
}

test('a partial Inter settlement reports the review and never copies its old bank link to the remainder', async () => {
  const route = loadRoute();
  const response = await route.POST(settleRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.bankReviewRequired, true);
  assert.equal(body.remainingRecord.value, 60);
  assert.equal(body.remainingRecord.metadata.bank_tx_id, undefined);
  assert.equal(body.remainingRecord.metadata.settlement_parent_id, 'record');
  assert.equal(route.writes.length, 0);
  assert.deepEqual(route.rpcCalls, [{
    name: 'bank_inter_settle_record',
    args: {
      p_record_id: 'record', p_paid_amount: 40, p_bank_account_id: null,
      p_payment_method: null, p_handling: 'keep_open',
    },
  }]);
});

test('preserves other providers when their existing bank link remains intact', async () => {
  const route = loadRoute({ provider: 'asaas', detached: false });
  const response = await route.POST(settleRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.bankReviewRequired, false);
  assert.equal(route.writes.find((write) => write.action === 'insert').value.metadata.bank_tx_id, 'bank-tx');
  assert.equal(route.rpcCalls.length, 0);
});

test('reports stale linked settlements without falling back to separate writes', async () => {
  const route = loadRoute({ rpcError: { code: 'P0001', message: 'O vínculo bancário mudou.' } });
  const response = await route.POST(settleRequest());
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /vínculo bancário mudou/);
  assert.equal(route.rpcCalls.length, 1);
  assert.equal(route.writes.length, 0);
});

test('rejects unauthorized and invalid settlements before writing', async () => {
  const denied = loadRoute({ denied: true });
  assert.equal((await denied.POST(settleRequest())).status, 401);
  assert.equal(denied.writes.length, 0);
  const invalid = loadRoute();
  assert.equal((await invalid.POST(settleRequest(0))).status, 400);
  assert.equal(invalid.writes.length, 0);
});
