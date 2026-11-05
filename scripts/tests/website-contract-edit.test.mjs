import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}
const customers = load('src/lib/holding-customers.ts');
const contracts = load('src/lib/website-contracts.ts', { '@/lib/holding-customers': customers });
const id = '10000000-0000-4000-8000-000000000001';
const input = {
  id, revision: 0, request_id: id, customer_id: id, plan_id: id, payment_method: 'PIX',
  total_cents: 50000, count: 2, first_due_date: '2026-12-01', deposit_cents: 0, deposit_due_date: '',
};
function harness(patch = {}) {
  const local = {
    id, customer_id: id, billing_state: 'review', asaas_environment: 'production',
    edit_revision: 0, updated_at: 'before', holding_website_invoices: [],
    holding_website_installments: [{ asaas_payment_id: 'pay_test' }], ...patch.local,
  };
  const calls = [], writes = [], rpcs = [];
  class Query {
    constructor() { this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    update(value) { this.value = value; return this; }
    single() { return this; }
    then(resolve, reject) {
      const match = this.filters.every(([k, v]) => local[k] === v);
      if (this.value && match) { writes.push(this.value); Object.assign(local, this.value, { updated_at: 'locked' }); }
      return Promise.resolve({ data: match ? structuredClone(local) : null, error: null }).then(resolve, reject);
    }
  }
  const api = load('src/lib/website-contract-edit.ts', {
    '@/lib/holding-customers': customers, '@/lib/website-contracts': contracts,
    '@/lib/website-billing': { websiteReference: (id, kind, revision = 0) => `website|${id}|${kind}${revision ? `|r${revision}` : ''}` },
    '@/lib/supabase-server': { supabaseServer: {
      from: (table) => { assert.equal(table, 'holding_website_contracts'); return new Query(); },
      rpc: async (name, args) => { rpcs.push({ name, args }); return { data: patch.saveFail ? null : id, error: patch.saveFail ? {} : null }; },
    } },
    '@/lib/website-asaas': { createWebsiteAsaas: async () => ({
      environment: patch.environment || 'production',
      findPayments: async (reference) => { calls.push(['find', reference]); if (patch.failure) throw new Error('HTTP 404'); return patch.payments || []; },
      getPayment: async (id) => { calls.push(['get', id]); return { id, deleted: true, status: 'PENDING', ...patch.payment }; },
    }) },
  });
  return { ...api, calls, writes, rpcs, local };
}
test('editing verifies both references and each deleted payment before saving atomic replacement without provider writes', async () => {
  const h = harness();
  assert.equal((await h.editWebsiteContract(input)).id, id);
  assert.deepEqual(h.calls.map(([kind]) => kind), ['find', 'find', 'get']);
  assert.equal(h.rpcs[0].name, 'holding_edit_website_contract');
  assert.equal(h.rpcs[0].args.p_locked_at, 'locked');
  assert.equal(h.rpcs[0].args.p_previous_state, 'review');
  assert.deepEqual(h.rpcs[0].args.p_schedule, contracts.buildWebsiteSchedule(input));
});
test('editing local contracts needs no Asaas access and keeps the customer fixed', async () => {
  const h = harness({ local: { billing_state: 'local', asaas_environment: null, holding_website_installments: [] } });
  await h.editWebsiteContract(input);
  assert.equal(h.calls.length, 0);
  const changed = harness();
  await assert.rejects(changed.editWebsiteContract({ ...input, customer_id: '10000000-0000-4000-8000-000000000002' }), /trocar o cliente/);
  assert.equal(changed.writes.length, 0);
});
test('active, paid, refunded, unconfirmed deletion, wrong environment and lookup failures never unlock a new emission', async () => {
  for (const patch of [
    { payments: [{ deleted: false }] }, { payments: [{ deleted: true, status: 'RECEIVED' }] },
    { payment: { deleted: false } }, { payment: { status: 'CHARGEBACK_REQUESTED' } },
    { payment: { status: 'RECEIVED' } }, { payment: { status: 'CONFIRMED' } },
    { payment: { status: 'REFUNDED' } }, { payment: { confirmedDate: '2026-11-04' } },
    { payment: { paymentDate: '2026-11-04' } }, { failure: true }, { environment: 'sandbox' }, { saveFail: true },
  ]) {
    const h = harness(patch);
    await assert.rejects(h.editWebsiteContract(input));
    assert.equal(h.local.billing_state, 'review');
    assert.equal(h.local.edit_revision, 0);
    assert.equal(h.rpcs.length, patch.saveFail ? 1 : 0);
  }
});
test('stale revision, fiscal reservation and processing prevent editing before any remote call', async () => {
  for (const local of [
    { edit_revision: 1 }, { billing_state: 'processing' }, { holding_website_invoices: [{ id }] },
  ]) {
    const h = harness({ local });
    await assert.rejects(h.editWebsiteContract(input));
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.rpcs.length, 0);
  }
});
test('malformed edits and subscriptions are rejected without touching data', async () => {
  for (const body of [null, {}, { ...input, revision: -1 }, { ...input, subscription: {} }, { ...input, total_cents: 0 }]) {
    const h = harness();
    await assert.rejects(h.editWebsiteContract(body));
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
  }
});
