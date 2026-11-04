import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id} in ${path}`);
    return dependencies[id];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const customers = load('src/lib/holding-customers.ts');
const terms = load('src/lib/website-contracts.ts', { '@/lib/holding-customers': customers });
const customerId = '10000000-0000-4000-8000-000000000001';
const contractId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const customer = {
  id: customerId, name: 'Cliente fictício', document: '52998224725', email: 'test@example.test',
  phone: '', postal_code: '', address: '', address_number: '', complement: '', district: '', city: '', state: '', active: true,
  asaas_state: 'local', asaas_customer_id: null, asaas_environment: null,
};
const input = { total_cents: 10001, count: 3, first_due_date: '2027-01-31', deposit_cents: 0, deposit_due_date: '' };
const contract = (overrides = {}) => ({
  id: contractId, customer_id: customerId, plan_id: requestId,
  customer_snapshot: { name: customer.name, document: customer.document, email: customer.email },
  plan_snapshot: { name: 'Site fictício', scope: 'Escopo definido' },
  total_cents: input.total_cents, payment_method: 'CREDIT_CARD', billing_state: 'local', asaas_environment: null,
  holding_website_installments: terms.buildWebsiteSchedule(input).map((row, i) => ({
    ...row, id: `parcel-${i}`, asaas_payment_id: null, invoice_url: null, status: 'LOCAL',
  })), ...overrides,
});

test('validates CPF/CNPJ check digits and normalized customer data without accepting extra integration properties', () => {
  for (const document of ['52998224725', '11222333000181']) assert.equal(customers.validDocument(document), true);
  for (const document of ['00000000000', '11111111111111', '52998224724', '11222333000182', '']) {
    assert.equal(customers.validDocument(document), false);
  }
  const normalized = customers.validateHoldingCustomer({
    ...customer, name: ' Cliente fictício ', document: '529.982.247-25', state: 'sp',
    postal_code: '01001-000', phone: '(11) 99999-9999', asaas_customer_id: 'untrusted',
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.data.document, '52998224725');
  assert.equal(normalized.data.state, 'SP');
  assert.equal(normalized.data.phone, '11999999999');
  assert.equal(normalized.data.postal_code, '01001000');
  assert.equal(normalized.data.asaas_customer_id, undefined);
  assert.equal(normalized.data.id, undefined);
  for (const value of [
    null, [], {}, { ...customer, email: 'invalid' }, { ...customer, active: 'true' },
    { ...customer, name: ' ' }, { ...customer, state: 'XX' }, { ...customer, postal_code: '1' },
    { ...customer, phone: '123' }, { ...customer, address: 'a'.repeat(201) },
  ]) assert.equal(customers.validateHoldingCustomer(value).ok, false);
});

test('calculates exact monthly installments, month-end anchors, leap years and final cents', () => {
  assert.deepEqual(terms.buildWebsiteSchedule(input), [
    { number: 1, kind: 'balance', amount_cents: 3333, due_date: '2027-01-31' },
    { number: 2, kind: 'balance', amount_cents: 3333, due_date: '2027-02-28' },
    { number: 3, kind: 'balance', amount_cents: 3335, due_date: '2027-03-31' },
  ]);
  const leap = terms.buildWebsiteSchedule({ ...input, first_due_date: '2028-01-31' });
  assert.equal(leap[1].due_date, '2028-02-29'); assert.equal(leap[2].due_date, '2028-03-31');
  for (const total_cents of [12, 100, 10001, 999999999]) {
    const rows = terms.buildWebsiteSchedule({ ...input, total_cents, count: 12 });
    assert.equal(rows.reduce((sum, row) => sum + row.amount_cents, 0), total_cents);
    assert.ok(rows.every((row) => Number.isInteger(row.amount_cents) && row.amount_cents > 0));
  }
  const entry = terms.buildWebsiteSchedule({ ...input, deposit_cents: 2000, deposit_due_date: '2027-01-15' });
  assert.equal(entry.length, 4);
  assert.equal(entry[0].kind, 'deposit');
  assert.equal(entry.reduce((sum, row) => sum + row.amount_cents, 0), 10001);
});

test('rejects invalid financial inputs and impossible dates without generating defaults', () => {
  for (const patch of [
    { count: 0 }, { count: 13 }, { count: 1.5 }, { total_cents: 0 }, { total_cents: Infinity },
    { total_cents: 1.01 }, { total_cents: 2 }, { deposit_cents: -1 }, { deposit_cents: 10001 },
    { deposit_cents: 1.5 }, { first_due_date: '2027-02-29' }, { first_due_date: '2027-99-99' },
    { first_due_date: '2027-04-31' }, { first_due_date: '' }, { first_due_date: '2100-12-31' },
    { deposit_cents: 100, deposit_due_date: '' }, { deposit_cents: 100, deposit_due_date: '2027-01-31' },
  ]) assert.throws(() => terms.buildWebsiteSchedule({ ...input, ...patch }), undefined, JSON.stringify(patch));
  const valid = { ...input, customer_id: customerId, plan_id: requestId, request_id: contractId, payment_method: 'PIX' };
  assert.equal(terms.validateWebsiteContract(valid).schedule.length, 3);
  for (const patch of [{ request_id: '' }, { customer_id: 'glass|id' }, { plan_id: '' }, { payment_method: 'UNDEFINED' }, { count: '3' }]) {
    assert.throws(() => terms.validateWebsiteContract({ ...valid, ...patch }));
  }
});

function billingHarness({ existing = [], local = contract(), customerData = customer, timeout = false, lookupFail = false, createCustomerFail = false, persistFail = false, environment = 'sandbox' } = {}) {
  const tables = {
    holding_customers: [{ ...customerData }],
    holding_website_contracts: [structuredClone(local)],
    holding_website_installments: structuredClone(local.holding_website_installments).map((row) => ({ ...row, contract_id: local.id })),
  };
  const calls = [], writes = [], remote = structuredClone(existing);
  class Query {
    constructor(table) { assert.ok(table in tables, `Cross-boundary table: ${table}`); this.table = table; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    single() { this.singleRow = true; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    update(value) { this.updateValue = value; return this; }
    then(resolve, reject) {
      const selected = tables[this.table].filter((row) => this.filters.every(([key, value]) => row[key] === value));
      if (this.updateValue) {
        writes.push({ table: this.table, value: this.updateValue });
        if (persistFail && this.table === 'holding_website_installments') {
          return Promise.resolve({ data: null, error: { code: 'TEST' } }).then(resolve, reject);
        }
        selected.forEach((row) => Object.assign(row, this.updateValue));
      }
      const data = this.singleRow ? selected[0] || null : selected;
      return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve, reject);
    }
  }
  const api = {
    environment,
    async findCustomer(document) { calls.push(['findCustomer', document]); return existing.length ? 'cus_test' : null; },
    async createCustomer() { calls.push(['createCustomer']); if (createCustomerFail) throw new Error('Uncertain customer POST'); return 'cus_test'; },
    async findPayments(reference) {
      calls.push(['findPayments', reference]);
      if (lookupFail) throw new Error('Lookup failed');
      return remote.filter((row) => row.externalReference === reference);
    },
    async createPayments(payload) {
      calls.push(['createPayments', payload]);
      const kind = payload.reference.split('|')[2];
      const rows = local.holding_website_installments.filter((row) => row.kind === kind);
      for (let index = 0; index < rows.length; index++) {
        remote.push({
          id: `pay_${kind}${index}`, customer: 'cus_test', externalReference: payload.reference,
          billingType: local.payment_method, value: rows[index].amount_cents / 100, dueDate: rows[index].due_date,
          status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/test',
          ...(rows.length > 1 ? { installment: 'group', installmentNumber: index + 1 } : {}),
        });
      }
      if (timeout) throw new Error('Uncertain payment POST');
      return remote.at(-1);
    },
  };
  const billing = load('src/lib/website-billing.ts', {
    '@/lib/supabase-server': { supabaseServer: { from: (table) => new Query(table) } },
    '@/lib/website-asaas': { createWebsiteAsaas: async () => api },
  });
  return { ...billing, tables, calls, writes, remote };
}

for (const method of ['PIX', 'BOLETO', 'CREDIT_CARD']) {
  test(`emits ${method} as a single installment group and persists individual links without touching SaaS or fiscal tables`, async () => {
    const local = contract({ payment_method: method });
    const h = billingHarness({ local });
    await h.billWebsiteContract(contractId, true);
    const creates = h.calls.filter(([name]) => name === 'createPayments');
    assert.equal(creates.length, 1);
    assert.equal(creates[0][1].count, 3);
    assert.equal(creates[0][1].total_cents, 10001);
    assert.equal(creates[0][1].method, method);
    assert.equal(h.tables.holding_website_contracts[0].billing_state, 'issued');
    assert.ok(h.tables.holding_website_installments.every((row) => row.asaas_payment_id && row.invoice_url));
    await assert.rejects(h.billWebsiteContract(contractId, true), /já foi emitida/);
    assert.equal(h.calls.filter(([name]) => name === 'createPayments').length, 1);
  });
}

test('entry is a separate payment and remaining credit card balance is one installment purchase', async () => {
  const local = contract({
    holding_website_installments: terms.buildWebsiteSchedule({ ...input, deposit_cents: 2000, deposit_due_date: '2027-01-15' })
      .map((row, i) => ({ ...row, id: `p-${i}`, asaas_payment_id: null })),
  });
  const h = billingHarness({ local });
  await h.billWebsiteContract(contractId, true);
  const creates = h.calls.filter(([name]) => name === 'createPayments').map(([, body]) => body);
  assert.equal(creates.length, 2);
  assert.equal(creates[0].count, 1); assert.equal(creates[0].total_cents, 2000);
  assert.equal(creates[1].count, 3); assert.equal(creates[1].total_cents, 8001);
  assert.notEqual(creates[0].reference, creates[1].reference);
});

test('only one concurrent request can claim a contract for emission', async () => {
  const h = billingHarness();
  const results = await Promise.allSettled([h.billWebsiteContract(contractId, true), h.billWebsiteContract(contractId, true)]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'createPayments').length, 1);
});

test('a timed-out creation blocks all re-emission and reconciliation only reads existing payments', async () => {
  const h = billingHarness({ timeout: true });
  await assert.rejects(h.billWebsiteContract(contractId, true), /Uncertain/);
  assert.equal(h.tables.holding_website_contracts[0].billing_state, 'review');
  assert.equal(h.remote.length, 3);
  await assert.rejects(h.billWebsiteContract(contractId, true), /revisão/);
  await h.billWebsiteContract(contractId, false);
  assert.equal(h.tables.holding_website_contracts[0].billing_state, 'issued');
  assert.equal(h.calls.filter(([name]) => name === 'createPayments').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'createCustomer').length, 1);
});

test('lookup and local persistence failures cannot trigger success-shaped results or new POST retries', async () => {
  for (const options of [{ lookupFail: true }, { persistFail: true }, { createCustomerFail: true }]) {
    const h = billingHarness(options);
    await assert.rejects(h.billWebsiteContract(contractId, true));
    assert.equal(h.tables.holding_website_contracts[0].billing_state, 'review');
    await assert.rejects(h.billWebsiteContract(contractId, true));
    assert.ok(h.calls.filter(([name]) => name === 'createPayments').length <= 1);
    if (options.createCustomerFail) {
      await assert.rejects(h.billWebsiteContract(contractId, false), /inconclusivo/);
      assert.equal(h.calls.filter(([name]) => name === 'createCustomer').length, 1);
    }
  }
});

test('consult never creates customers or payments and respects the saved Asaas environment', async () => {
  const local = contract({ billing_state: 'review', asaas_environment: 'sandbox' });
  const h = billingHarness({ local });
  await assert.rejects(h.billWebsiteContract(contractId, false), /inconclusivo/);
  assert.equal(h.calls.some(([name]) => name.startsWith('create')), false);
  const mismatch = billingHarness({ local, environment: 'production' });
  await assert.rejects(mismatch.billWebsiteContract(contractId, false), /outro ambiente/);
  assert.equal(mismatch.calls.length, 0);
});

test('matching rejects wrong amounts, dates, methods, customers, references, duplicates and deleted payments', () => {
  const h = billingHarness();
  const local = contract();
  const remote = local.holding_website_installments.map((row, i) => ({
    id: `pay_${i}`, customer: 'cus_test', billingType: 'CREDIT_CARD', externalReference: h.websiteReference(local.id, 'balance'),
    value: row.amount_cents / 100, dueDate: row.due_date, status: 'PENDING',
    installment: 'group', installmentNumber: i + 1,
  }));
  assert.equal(h.matchWebsitePayments(local, 'balance', 'cus_test', remote).length, 3);
  for (const patch of [
    { value: 100 }, { dueDate: '2020-01-01' }, { customer: 'cus_other' }, { externalReference: 'glass|test' },
    { billingType: 'BOLETO' }, { deleted: true }, { installmentNumber: 2 }, { installment: 'other' },
  ]) {
    assert.throws(() => h.matchWebsitePayments(local, 'balance', 'cus_test', [{ ...remote[0], ...patch }, ...remote.slice(1)]));
  }
  assert.throws(() => h.matchWebsitePayments(local, 'balance', 'cus_test', remote.slice(1)));
  assert.throws(() => h.matchWebsitePayments(local, 'balance', 'cus_test', [remote[0], remote[0], remote[2]]));
});

test('integration dependency graph never imports Glass, Barber, PaymentProcessor or fiscal emitters', () => {
  for (const path of [
    'src/lib/holding-customers.ts', 'src/lib/website-contracts.ts', 'src/lib/website-asaas.ts', 'src/lib/website-billing.ts',
    'src/app/api/admin/holding-customers/route.ts', 'src/app/api/admin/website-contracts/route.ts',
    'src/app/api/admin/website-contracts/options/route.ts', 'src/app/api/admin/website-contracts/billing/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /from ['"][^'"]*(?:glass|barber|payment-processor|nfse|nfe)[^'"]*['"]/i, path);
    assert.doesNotMatch(source, /SUPABASE_GLASS|SUPABASE_BARBER|vidracarias|barbearias|system_finance_records/, path);
  }
});

function asaasHarness(respond, config = { asaasApiKey: 'test-key', asaasEnv: 'sandbox' }) {
  const calls = [];
  const adapter = load('src/lib/website-asaas.ts', {
    '@/lib/finance-config-server': { readFinanceConfig: async () => config },
  }, {
    fetch: async (url, init) => {
      const call = { url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      return respond(call);
    },
  });
  return { ...adapter, calls };
}
const remotePayment = (patch = {}) => ({
  id: 'pay_test', customer: 'cus_test', externalReference: `website|${contractId}|balance`,
  billingType: 'CREDIT_CARD', value: 100.01, dueDate: '2027-01-31', status: 'PENDING',
  invoiceUrl: 'https://sandbox.asaas.com/i/test', ...patch,
});

test('Asaas transport sends a single totalValue installment purchase, never card details or one payment per card month', async () => {
  const h = asaasHarness(() => Response.json(remotePayment()));
  const client = await h.createWebsiteAsaas();
  await client.createPayments({
    customer: 'cus_test', method: 'CREDIT_CARD', count: 3, total_cents: 10001,
    due_date: '2027-01-31', reference: `website|${contractId}|balance`, description: 'Site',
  });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url.href, 'https://sandbox.asaas.com/api/v3/payments');
  assert.equal(h.calls[0].init.method, 'POST');
  assert.equal(h.calls[0].body.totalValue, 100.01);
  assert.equal(h.calls[0].body.installmentCount, 3);
  assert.equal(h.calls[0].body.value, undefined);
  assert.equal(h.calls[0].body.installmentValue, undefined);
  assert.equal(h.calls[0].body.creditCard, undefined);
  assert.equal(h.calls[0].body.creditCardToken, undefined);
  await client.createPayments({
    customer: 'cus_test', method: 'PIX', count: 1, total_cents: 10001,
    due_date: '2027-01-31', reference: `website|${contractId}|balance`, description: 'Site',
  });
  assert.equal(h.calls[1].body.value, 100.01);
  assert.equal(h.calls[1].body.totalValue, undefined);
  assert.equal(h.calls[1].body.installmentCount, undefined);
});

test('Asaas adapter retrieves every page and all installments, while rejecting ambiguous or unsafe responses', async () => {
  const h = asaasHarness(({ url }) => {
    if (url.pathname.endsWith('/installments/group/payments')) return Response.json({
      hasMore: false, data: [remotePayment({ installment: 'group', installmentNumber: 1 })],
    });
    if (url.searchParams.get('offset') === '0') return Response.json({ hasMore: true, data: [remotePayment({ installment: 'group' })] });
    return Response.json({ hasMore: false, data: [] });
  });
  const result = await (await h.createWebsiteAsaas()).findPayments(`website|${contractId}|balance`);
  assert.equal(result.length, 1);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[1].url.searchParams.get('offset'), '100');
  assert.equal(h.calls[2].url.pathname, '/api/v3/installments/group/payments');
  for (const invoiceUrl of ['http://asaas.com/i/test', 'https://evil.test', 'https://asaas.com.evil.test', 'javascript:alert(1)', 'https://user:pass@asaas.com/i/test']) {
    assert.throws(() => h.safeAsaasInvoice(invoiceUrl));
  }
  for (const body of [
    { data: [], hasMore: true },
    { data: [] },
    { data: [remotePayment({ value: '100' })], hasMore: false },
    { data: [remotePayment({ invoiceUrl: 'https://evil.test' })], hasMore: false },
    { data: [remotePayment({ installment: 'a' }), remotePayment({ id: 'pay_other', installment: 'b' })], hasMore: false },
  ]) {
    const invalid = asaasHarness(() => Response.json(body));
    await assert.rejects((await invalid.createWebsiteAsaas()).findPayments('reference'));
  }
});

test('Asaas transport fails explicitly for missing config, HTTP failures and uncertain POSTs without automatic retries', async () => {
  for (const config of [{}, { asaasApiKey: 'key' }, { asaasApiKey: 'key', asaasEnv: 'other' }]) {
    const h = asaasHarness(() => { throw new Error('Must not call'); }, config);
    await assert.rejects(h.createWebsiteAsaas());
    assert.equal(h.calls.length, 0);
  }
  for (const respond of [
    () => { throw new Error('Timeout'); },
    () => Response.json({ errors: [{ code: 'invalid' }] }, { status: 400 }),
  ]) {
    const h = asaasHarness(respond);
    await assert.rejects((await h.createWebsiteAsaas()).createCustomer(customer));
    assert.equal(h.calls.length, 1);
  }
});

test('customer lookup refuses duplicate remote documents and never updates a preexisting Asaas customer', async () => {
  const h = asaasHarness(() => Response.json({
    hasMore: false, data: [{ id: 'cus_test', cpfCnpj: customer.document, deleted: false }],
  }));
  assert.equal(await (await h.createWebsiteAsaas()).findCustomer(customer.document), 'cus_test');
  assert.equal(h.calls[0].init.method, 'GET');
  const duplicate = asaasHarness(() => Response.json({
    hasMore: false, data: [{ id: 'cus_one', cpfCnpj: customer.document }, { id: 'cus_two', cpfCnpj: customer.document }],
  }));
  await assert.rejects((await duplicate.createWebsiteAsaas()).findCustomer(customer.document), /mais de um cliente/);
});

function webhookHarness(path, verifiedRef, recurring = false) {
  const processorCalls = [], clientCalls = [];
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/services/payment-processor': {
      PaymentProcessor: { handlePaymentConfirmed: async (payload) => processorCalls.push(payload) },
      emitirNFeExcedentePago: async () => { throw new Error('Unexpected fiscal emission'); },
    },
    '@/lib/asaas-webhook-verify': {
      fetchVerifiedAsaasPayment: async () => ({ ok: true, payment: {
        id: 'pay_test', externalReference: verifiedRef, value: 100, billingType: 'PIX',
      } }),
    },
    '@/lib/supabase-server': { supabaseServer: { from: (table) => {
      assert.equal(table, 'system_settings');
      return { select() { return this; }, eq() { return this; }, single: async () => ({ data: { value: {} } }) };
    } } },
    '@supabase/supabase-js': { createClient: (...args) => { clientCalls.push(args); return {}; } },
    '@/lib/overage-block': { releaseOverageBlock: async () => { throw new Error('Unexpected tenant access'); } },
    '@/lib/website-subscriptions': { processWebsiteSubscriptionPayment: async () => recurring },
  };
  const route = load(path, dependencies);
  return {
    processorCalls, clientCalls,
    post: (externalReference = verifiedRef) => route.POST(new Request('http://localhost/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test', externalReference } }),
    })),
  };
}

test('both existing webhooks quarantine Website payments before any SaaS client or processor call', async () => {
  for (const path of ['src/app/api/webhooks/payments/route.ts', 'src/app/api/webhooks/asaas/route.ts']) {
    for (const rawRef of [`website|${contractId}|balance`, undefined, 'glass|forged']) {
      const h = webhookHarness(path, `website|${contractId}|balance`);
      const response = await h.post(rawRef === undefined ? null : rawRef);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ignored, 'website_billing_isolated');
      assert.equal(h.processorCalls.length, 0);
      assert.equal(h.clientCalls.length, 0);
    }
  }
});

test('webhook guards preserve dispatch of verified Glass and Barber payments', async () => {
  for (const path of ['src/app/api/webhooks/payments/route.ts', 'src/app/api/webhooks/asaas/route.ts']) {
    for (const ref of ['glass|tenant|monthly', 'barber|tenant|annual']) {
      const h = webhookHarness(path, ref);
      assert.equal((await h.post()).status, 200);
      assert.equal(h.processorCalls.length, 1);
      assert.equal(h.processorCalls[0].externalReference, ref);
    }
  }
});

test('both webhooks route recurring Websites to their own processor before constructing tenant clients', async () => {
  for (const path of ['src/app/api/webhooks/payments/route.ts', 'src/app/api/webhooks/asaas/route.ts']) {
    const h = webhookHarness(path, `website-subscription|${contractId}`, true);
    const response = await h.post();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, 'website_subscription');
    assert.equal(h.processorCalls.length, 0); assert.equal(h.clientCalls.length, 0);
  }
});

function apiHarness(path, { denied = false, deniedFiscal = false, customerError = null, rpcError = null } = {}) {
  const permissions = [], writes = [], rpcs = [], tables = [];
  class Query {
    constructor(table) { tables.push(table); this.filters = []; }
    select() { return this; }
    order() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    neq(key, value) { this.filters.push([`not:${key}`, value]); return this; }
    insert(value) { writes.push({ kind: 'insert', value }); return this; }
    update(value) { writes.push({ kind: 'update', value }); return this; }
    delete() { writes.push({ kind: 'delete' }); return this; }
    maybeSingle() { return Promise.resolve({ data: { id: customerId, ...customer }, error: customerError }); }
    then(resolve, reject) { return Promise.resolve({ data: [], error: customerError }).then(resolve, reject); }
  }
  const billingCalls = [];
  const route = load(path, {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/holding-commercial-auth': { authorizeHoldingCommercial: async (_req, required) => {
      permissions.push(required);
      return denied || (deniedFiscal && required.includes('menu.notas_fiscais')) ? Response.json({ error: 'Denied' }, { status: 403 }) : null;
    } },
    '@/lib/holding-customers': customers,
    '@/lib/website-contracts': terms,
    '@/lib/website-subscription-terms': load('src/lib/website-subscription-terms.ts', {
      '@/lib/holding-customers': customers, '@/lib/website-contracts': terms,
      '@/lib/website-plans': load('src/lib/website-plans.ts'),
    }),
    '@/lib/website-billing': { billWebsiteContract: async (...args) => { billingCalls.push(args); return { message: 'ok' }; } },
    '@/lib/supabase-server': { supabaseServer: {
      from: (table) => new Query(table),
      rpc: async (name, args) => { rpcs.push({ name, args }); return { data: { id: contractId, subscription_id: null }, error: rpcError }; },
    } },
  });
  return {
    permissions, writes, rpcs, tables, billingCalls,
    request: (method, body, raw = false) => route[method](new Request('http://localhost/api/admin/test', {
      method, ...(method === 'GET' ? {} : { body: raw ? body : JSON.stringify(body) }),
    })),
  };
}

test('customer API validates documents, whitelists editable fields, and reports duplicate documents', async () => {
  const path = 'src/app/api/admin/holding-customers/route.ts';
  const h = apiHarness(path);
  assert.equal((await h.request('POST', { ...customer, glass_tenant_id: 'untrusted' })).status, 201);
  assert.equal(h.writes[0].value.asaas_state, undefined);
  assert.equal(h.writes[0].value.id, undefined);
  assert.equal(h.writes[0].value.glass_tenant_id, undefined);
  assert.deepEqual(h.permissions[0], ['menu.clientes']);
  const duplicate = apiHarness(path, { customerError: { code: '23505' } });
  assert.equal((await duplicate.request('POST', customer)).status, 409);
  assert.equal((await h.request('POST', '{', true)).status, 400);
  assert.equal((await h.request('PUT', { ...customer, id: 'bad' })).status, 400);
});

test('customer DELETE requires permission and a UUID, and reports FK conflicts without deleting contracted customers', async () => {
  const path = 'src/app/api/admin/holding-customers/route.ts';
  const denied = apiHarness(path, { denied: true });
  assert.equal((await denied.request('DELETE', { id: customerId })).status, 403);
  assert.equal(denied.writes.length, 0);
  const h = apiHarness(path);
  assert.equal((await h.request('DELETE', { id: 'bad' })).status, 400);
  assert.equal(h.writes.length, 0);
  assert.equal((await h.request('DELETE', { id: customerId })).status, 200);
  assert.equal(h.writes[0].kind, 'delete');
  const contracted = apiHarness(path, { customerError: { code: '23503' } });
  const response = await contracted.request('DELETE', { id: customerId });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /projeto ou assinatura/);
});

test('contract API saves a server-calculated schedule atomically with an idempotency key and rejects tampering', async () => {
  const h = apiHarness('src/app/api/admin/website-contracts/route.ts');
  const body = {
    ...input, customer_id: customerId, plan_id: requestId, request_id: contractId, payment_method: 'CREDIT_CARD',
    customer_snapshot: { document: 'forged' }, schedule: [{ amount_cents: 1 }],
  };
  assert.equal((await h.request('POST', body)).status, 201);
  assert.equal(h.rpcs[0].name, 'holding_create_website_bundle');
  assert.equal(h.rpcs[0].args.p_request_id, contractId);
  assert.deepEqual(h.rpcs[0].args.p_schedule, terms.buildWebsiteSchedule(input));
  assert.equal(h.rpcs[0].args.customer_snapshot, undefined);
  assert.deepEqual(h.permissions[0], ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.clientes']);
  assert.equal((await h.request('POST', { ...body, request_id: null })).status, 400);
  assert.equal((await h.request('POST', '{', true)).status, 400);
  const conflict = apiHarness('src/app/api/admin/website-contracts/route.ts', { rpcError: { code: '22023' } });
  assert.equal((await conflict.request('POST', body)).status, 409);
});

test('combined contract API validates optional subscription, enforces fiscal permission and forces the same customer/request', async () => {
  const body = { ...input, customer_id: customerId, plan_id: requestId, request_id: contractId, payment_method: 'PIX' };
  const subscription = {
    plan_id: requestId, amount_cents: 15999, billing_cycle: 'annual', first_due_date: '2026-12-10', payment_method: 'BOLETO',
    fiscal_confirmed: true, customer_id: 'forged', request_id: 'forged', asaas_subscription_id: 'sub_foreign',
  };
  const path = 'src/app/api/admin/website-contracts/route.ts';
  const h = apiHarness(path);
  assert.equal((await h.request('POST', { ...body, subscription })).status, 201);
  assert.equal(h.rpcs[0].name, 'holding_create_website_bundle');
  assert.equal(h.rpcs[0].args.p_subscription.customer_id, customerId);
  assert.equal(h.rpcs[0].args.p_subscription.request_id, contractId);
  assert.equal(h.rpcs[0].args.p_subscription.amount_cents, 15999);
  assert.equal(h.rpcs[0].args.p_subscription.fiscal_confirmed, true);
  assert.equal(h.rpcs[0].args.p_subscription.asaas_subscription_id, undefined);
  for (const patch of [{ fiscal_confirmed: false }, { amount_cents: 0 }, { billing_cycle: 'one_time' }, { first_due_date: 'wrong' }]) {
    assert.equal((await h.request('POST', { ...body, subscription: { ...subscription, ...patch } })).status, 400);
  }
  assert.equal(h.rpcs.length, 1);
  const denied = apiHarness(path, { deniedFiscal: true });
  assert.equal((await denied.request('POST', { ...body, subscription })).status, 403);
  assert.equal(denied.rpcs.length, 0);
  assert.equal((await denied.request('POST', body)).status, 201);
  assert.equal(denied.rpcs[0].args.p_subscription, null);
});

test('billing API requires an explicit action and cannot use untrusted provider IDs or amounts', async () => {
  const h = apiHarness('src/app/api/admin/website-contracts/billing/route.ts');
  for (const action of ['generate', 'sync']) {
    assert.equal((await h.request('POST', { id: contractId, action, customer: 'forged', value: 1 })).status, 200);
  }
  assert.deepEqual(h.billingCalls, [[contractId, true], [contractId, false]]);
  for (const body of [null, {}, { id: contractId, action: 'delete' }, { id: 'glass|tenant', action: 'generate' }]) {
    assert.equal((await h.request('POST', body)).status, 400);
  }
});

test('all commercial APIs deny access before any customer, contract, provider or database mutation', async () => {
  for (const [path, methods] of [
    ['src/app/api/admin/holding-customers/route.ts', ['GET', 'POST', 'PUT']],
    ['src/app/api/admin/website-contracts/route.ts', ['GET', 'POST']],
    ['src/app/api/admin/website-contracts/options/route.ts', ['GET']],
    ['src/app/api/admin/website-contracts/billing/route.ts', ['POST']],
  ]) {
    for (const method of methods) {
      const h = apiHarness(path, { denied: true });
      assert.equal((await h.request(method, {})).status, 403);
      assert.equal(h.tables.length + h.writes.length + h.rpcs.length + h.billingCalls.length, 0);
    }
  }
});

test('commercial authorization fails closed on permission query errors and requires every active resource', async () => {
  const required = ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.clientes'];
  const request = new Request('http://localhost/api/admin/website-contracts');
  function auth(options = {}) {
    const calls = [];
    class Query {
      constructor(table) { calls.push(table); this.table = table; }
      select() { return this; }
      eq() { return this; }
      in() { return this; }
      maybeSingle() { return this; }
      then(resolve, reject) {
        const values = {
          holding_user_permission_profiles: options.bootstrap ? [] : [{ profile_id: 'profile' }],
          holding_permission_profiles: [{ name: options.owner ? 'Administrador' : 'Comercial' }],
          equipe_791: { cargo: 'Comercial' },
          holding_permission_resources: (options.resources ?? required).map((code) => ({ code })),
          holding_profile_resource_permissions: (options.permissions ?? required).map((resource_code) => ({ resource_code })),
        };
        assert.ok(this.table in values);
        return Promise.resolve({
          data: options.failedTable === this.table ? null : values[this.table],
          error: options.failedTable === this.table ? new Error('Permission lookup failed') : null,
        }).then(resolve, reject);
      }
    }
    return {
      calls,
      ...load('src/lib/holding-commercial-auth.ts', {
        'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
        '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => options.denied
          ? { ok: false, status: 401, error: 'Denied' } : { ok: true, user: { email: 'test@example.test' } } },
        '@/lib/supabase-server': { supabaseServer: { from: (table) => new Query(table) } },
      }),
    };
  }
  assert.equal(await auth().authorizeHoldingCommercial(request, required), null);
  assert.equal(await auth({ bootstrap: true }).authorizeHoldingCommercial(request, required), null);
  assert.equal(await auth({ owner: true, permissions: [] }).authorizeHoldingCommercial(request, required), null);
  for (const options of [{ permissions: [] }, { permissions: required.slice(0, 2) }, { resources: required.slice(0, 2) }]) {
    assert.equal((await auth(options).authorizeHoldingCommercial(request, required)).status, 403);
  }
  const denied = auth({ denied: true });
  assert.equal((await denied.authorizeHoldingCommercial(request, required)).status, 401);
  assert.equal(denied.calls.length, 0);
  for (const failedTable of [
    'holding_user_permission_profiles', 'holding_permission_profiles', 'equipe_791',
    'holding_permission_resources', 'holding_profile_resource_permissions',
  ]) await assert.rejects(auth({ failedTable }).authorizeHoldingCommercial(request, required), /lookup failed/);
});
