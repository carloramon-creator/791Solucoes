import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const customers = load('src/lib/holding-customers.ts');
const contracts = load('src/lib/website-contracts.ts', { '@/lib/holding-customers': customers });
const catalog = load('src/lib/website-plans.ts');
const terms = load('src/lib/website-subscription-terms.ts', {
  '@/lib/holding-customers': customers, '@/lib/website-contracts': contracts, '@/lib/website-plans': catalog,
});
const id = '10000000-0000-4000-8000-000000000001';
const paymentId = '20000000-0000-4000-8000-000000000001';
const row = (patch = {}) => ({
  id, customer_id: id, plan_id: id, customer_snapshot: { name: 'Cliente ficticio', document: '52998224725' },
  plan_snapshot: { name: 'Hospedagem', scope: 'Backup', invoice_policy: 'automatic_after_payment', billing_cycle: 'quarterly' },
  amount_cents: 25550, payment_method: 'PIX', first_due_date: '2026-11-20',
  asaas_environment: 'production', asaas_subscription_id: 'sub_test', asaas_customer_id: 'cus_test',
  billing_state: 'issued', remote_status: 'ACTIVE', lifecycle_status: 'active', approval_status: 'approved', pending_action: null, resume_due_date: null, ...patch,
});
const payment = (patch = {}) => ({
  id: 'pay_test', subscription: 'sub_test', customer: 'cus_test', value: 255.5, dueDate: '2026-11-20',
  confirmedDate: '2026-11-04', paymentDate: '2026-11-05', status: 'CONFIRMED', billingType: 'PIX',
  externalReference: terms.websiteSubscriptionReference(id), invoiceUrl: 'https://asaas.com/i/test', ...patch,
});
const remote = (patch = {}) => ({
  id: 'sub_test', customer: 'cus_test', billingType: 'PIX', cycle: 'QUARTERLY', value: 255.5,
  externalReference: terms.websiteSubscriptionReference(id), status: 'ACTIVE', nextDueDate: '2027-02-20', ...patch,
});

test('pending client approval cannot reach the Asaas adapter even through direct generation', async () => {
  const h = harness({ local: row({ billing_state: 'local', approval_status: 'pending' }) });
  await assert.rejects(h.billWebsiteSubscription(id, true), /aprovação do cliente/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
});

function harness({ local = row(), current = payment(), environment = 'production', sendFail = false, lookupFail = false, createTimeout = false, matches = [remote()] } = {}) {
  const tables = {
    holding_website_subscriptions: local ? [structuredClone(local)] : [],
    holding_website_subscription_payments: [], holding_website_invoices: [],
  };
  const calls = [], sends = [], writes = [];
  let subscriptionState = remote();
  class Query {
    constructor(table) { assert.ok(table in tables, `Cross-boundary table ${table}`); this.table = table; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    is(key, value) { return this.eq(key, value); }
    update(value) { this.value = value; return this; }
    single() { this.singleRow = true; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    then(resolve, reject) {
      if (lookupFail && this.table === 'holding_website_subscriptions') return Promise.resolve({ error: { code: 'TEST' } }).then(resolve, reject);
      const selected = tables[this.table].filter((r) => this.filters.every(([k, v]) => r[k] === v));
      if (this.value) {
        writes.push({ table: this.table, value: this.value });
        selected.forEach((r) => Object.assign(r, this.value));
      }
      return Promise.resolve({ data: structuredClone(this.singleRow ? selected[0] || null : selected), error: null }).then(resolve, reject);
    }
  }
  const asaas = {
    environment,
    getPayment: async (id) => { calls.push(['GET payment', id]); return current; },
    getSubscription: async () => { calls.push(['GET subscription']); return subscriptionState; },
    setSubscriptionStatus: async (id, status, nextDueDate) => {
      calls.push(['PUT subscription', id, status, nextDueDate]);
      subscriptionState = { ...subscriptionState, status, ...(nextDueDate ? { nextDueDate } : {}) };
      return subscriptionState;
    },
    subscriptionReference: async () => remote().externalReference,
    subscriptionPayments: async () => [current],
    findSubscriptions: async () => { calls.push(['GET subscriptions']); return matches; },
    createSubscription: async (input) => { calls.push(['POST subscription', input]); if (createTimeout) throw new Error('test timeout'); return remote({ nextDueDate: input.due_date }); },
  };
  const api = load('src/lib/website-subscriptions.ts', {
    '@/lib/supabase-server': { supabaseServer: {
      from: (table) => new Query(table),
      rpc: async (name, args) => {
        assert.equal(name, 'holding_record_website_subscription_payment');
        let saved = tables.holding_website_subscription_payments.find((r) => r.asaas_payment_id === args.p_payment_id);
        if (!saved) {
          saved = { id: paymentId, asaas_payment_id: args.p_payment_id, paid_on: args.p_paid_on, fiscal_error: null };
          tables.holding_website_subscription_payments.push(saved);
        }
        saved.paid_on ||= args.p_paid_on; saved.status = args.p_status;
        return { data: saved.id, error: null };
      },
    } },
    '@/lib/website-asaas': { createWebsiteAsaas: async () => asaas },
    '@/lib/website-billing': { customerForAsaas: async () => 'cus_test' },
    '@/lib/website-contracts': contracts,
    '@/lib/website-subscription-terms': terms,
    '@/services/nfse/data-hora': { dataHoraNacional: () => '2026-11-04T12:00:00-03:00' },
    '@/lib/website-invoices': {
      validateWebsiteSubscriptionFiscal: async () => { calls.push(['validate fiscal']); },
      emitWebsiteSubscriptionInvoice: async (...args) => {
        if (tables.holding_website_invoices.length) throw new Error('Already reserved');
        tables.holding_website_invoices.push({ subscription_payment_id: paymentId, status: sendFail ? 'review' : 'authorized', system_invoice_id: sendFail ? null : id });
        sends.push(args); if (sendFail) throw new Error('Fiscal timeout; do not resend');
        return { sent: true };
      },
    },
  });
  return { ...api, tables, sends, calls, writes, asaas };
}

test('subscription input validates explicit fiscal consent, all four cycles and negotiated integer cents', () => {
  const input = {
    request_id: id, customer_id: id, plan_id: id, amount_cents: 25550, payment_method: 'PIX',
    billing_cycle: 'quarterly', first_due_date: '2026-11-20', fiscal_confirmed: true,
  };
  for (const billing_cycle of catalog.WEBSITE_RECURRING_CYCLES) {
    assert.equal(terms.validateWebsiteSubscription({ ...input, billing_cycle }).billing_cycle, billing_cycle);
  }
  for (const patch of [{ fiscal_confirmed: false }, { amount_cents: 1.1 }, { amount_cents: 0 }, { billing_cycle: 'one_time' },
    { first_due_date: '2026-02-30' }, { customer_id: 'glass|id' }, { request_id: null }]) {
    assert.throws(() => terms.validateWebsiteSubscription({ ...input, ...patch }));
  }
});

test('paid recurring webhook re-reads Asaas, invoices one full negotiated period and preserves confirmation competence', async () => {
  const h = harness();
  assert.equal(await h.processWebsiteSubscriptionPayment(payment({ value: 1, status: 'PENDING' })), true);
  assert.equal(h.calls[0][0], 'GET payment');
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0][1].total_cents, 25550); assert.equal(h.sends[0][2], '2026-11-04');
  assert.equal(await h.processWebsiteSubscriptionPayment(payment()), true);
  assert.equal(h.sends.length, 1);
});

test('pending, cash, deleted, refunds and sandbox payments do not send a production NFS-e', async () => {
  for (const patch of [{ status: 'PENDING' }, { status: 'OVERDUE' }, { status: 'RECEIVED_IN_CASH' }, { status: 'REFUNDED' }, { deleted: true }]) {
    const h = harness({ current: payment(patch) });
    await h.processWebsiteSubscriptionPayment(payment());
    assert.equal(h.sends.length, 0);
  }
  const h = harness({ environment: 'sandbox', local: row({ asaas_environment: 'sandbox' }) });
  await h.processWebsiteSubscriptionPayment(payment());
  assert.equal(h.sends.length, 0);
});

test('strict payment matching rejects foreign customer/subscription, changed amount/method/reference and missing confirmation dates', async () => {
  const h = harness();
  for (const patch of [{ subscription: 'sub_other' }, { customer: 'cus_other' }, { value: 100 }, { billingType: 'BOLETO' },
    { externalReference: 'glass|id' }, { dueDate: '2026-01-01' }, { confirmedDate: '', paymentDate: '' }, { installment: 'group' }]) {
    assert.throws(() => h.validateSubscriptionPayment(row(), payment(patch)));
  }
  assert.equal(h.validateSubscriptionPayment(row(), payment({ externalReference: '' })), '2026-11-04');
  for (const patch of [{ value: 10 }, { cycle: 'MONTHLY' }, { customer: 'cus_other' }, { deleted: true }, { externalReference: 'glass|id' }]) {
    assert.throws(() => h.matchWebsiteSubscription(row(), remote(patch), 'cus_test'));
  }
});

test('fiscal timeout persists a visible review alert and duplicate notifications never resend a reserved note', async () => {
  const h = harness({ sendFail: true });
  await h.processWebsiteSubscriptionPayment(payment());
  assert.match(h.tables.holding_website_subscription_payments[0].fiscal_error, /timeout/);
  await h.processWebsiteSubscriptionPayment(payment());
  assert.equal(h.sends.length, 1);
});

test('refund after authorization flags review without canceling or reissuing a note', async () => {
  const current = payment(); const h = harness({ current });
  await h.processWebsiteSubscriptionPayment(payment());
  current.status = 'REFUNDED';
  await h.processWebsiteSubscriptionPayment(payment());
  assert.equal(h.sends.length, 1);
  assert.match(h.tables.holding_website_subscription_payments[0].fiscal_error, /cancelamento não é automático/);
});

test('explicit Glass/Barber/finance/project notifications bypass Websites integration and missing links cannot leak into SaaS processing', async () => {
  const h = harness();
  for (const externalReference of ['glass|id', 'barber|id', 'finance_record|id', `website|${id}|balance`]) {
    assert.equal(await h.processWebsiteSubscriptionPayment({ id: 'pay_any', externalReference }), false);
  }
  assert.equal(h.calls.length, 0);
  const pendingLink = harness({ local: null, current: payment({ externalReference: '' }) });
  await assert.rejects(pendingLink.processWebsiteSubscriptionPayment(payment({ externalReference: '' })), /sem vínculo local/);
  const fail = harness({ lookupFail: true });
  await assert.rejects(fail.processWebsiteSubscriptionPayment(payment()), /localizar/);
  assert.equal(fail.sends.length, 0);
});

test('activation creates one quarterly subscription at the client price, while uncertain POSTs require read-only recovery', async () => {
  const local = row({ asaas_environment: null, asaas_subscription_id: null, asaas_customer_id: null, billing_state: 'local' });
  const h = harness({ local, matches: [], current: payment({ status: 'PENDING' }) });
  await h.billWebsiteSubscription(id, true);
  const post = h.calls.find(([name]) => name === 'POST subscription')[1];
  assert.equal(post.cycle, 'QUARTERLY'); assert.equal(post.amount_cents, 25550);
  await assert.rejects(h.billWebsiteSubscription(id, true), /já enviada/);
  assert.equal(h.calls.filter(([name]) => name === 'POST subscription').length, 1);
  const failed = harness({ local, matches: [], createTimeout: true });
  await assert.rejects(failed.billWebsiteSubscription(id, true), /timeout/);
  assert.equal(failed.tables.holding_website_subscriptions[0].billing_state, 'review');
  await assert.rejects(failed.billWebsiteSubscription(id, true), /já enviada/);
  failed.asaas.findSubscriptions = async () => [remote()];
  await failed.billWebsiteSubscription(id, false);
  assert.equal(failed.calls.filter(([name]) => name === 'POST subscription').length, 1);
});

test('Asaas subscription transport maps all cycles, omits card data and retrieves subscription payments individually', async () => {
  const calls = [];
  const adapter = load('src/lib/website-asaas.ts', {
    '@/lib/finance-config-server': { readFinanceConfig: async () => ({ asaasApiKey: 'test-only', asaasEnv: 'sandbox' }) },
  }, { fetch: async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/payments/')) return Response.json(payment({ externalReference: null }));
    return Response.json(remote({ cycle: init.body ? JSON.parse(init.body).cycle : 'QUARTERLY' }));
  } });
  const client = await adapter.createWebsiteAsaas();
  for (const cycle of ['MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']) {
    await client.createSubscription({ customer: 'cus_test', method: 'CREDIT_CARD', cycle,
      amount_cents: 25550, due_date: '2026-11-20', reference: terms.websiteSubscriptionReference(id), description: 'Site' });
    const call = calls.at(-1);
    assert.equal(call.body.value, 255.5); assert.equal(call.body.cycle, cycle);
    assert.equal(call.body.creditCard, undefined); assert.equal(call.body.installmentCount, undefined);
    assert.equal(call.init.redirect, 'error');
  }
  assert.equal((await client.getPayment('pay_test')).externalReference, '');
});

test('annual payment sends exactly the full annual client price, never a monthly fraction', async () => {
  const h = harness({ local: row({ amount_cents: 99000, plan_snapshot: {
    name: 'Hospedagem', billing_cycle: 'annual', invoice_policy: 'automatic_after_payment',
  } }), current: payment({ value: 990 }) });
  h.asaas.getSubscription = async () => remote({ value: 990, cycle: 'YEARLY' });
  await h.processWebsiteSubscriptionPayment(payment());
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0][1].total_cents, 99000);
});

test('all recurring cycles map to their exact Asaas frequency', () => {
  const h = harness();
  for (const [billing_cycle, cycle] of [['monthly', 'MONTHLY'], ['quarterly', 'QUARTERLY'], ['semiannual', 'SEMIANNUALLY'], ['annual', 'YEARLY']]) {
    h.matchWebsiteSubscription(row({ plan_snapshot: { billing_cycle } }), remote({ cycle }), 'cus_test');
  }
});

test('subscription APIs enforce fiscal permissions, validate input, and only persist whitelisted server RPC arguments', async () => {
  let allowed = false; const rpcs = [], permissions = [], bills = [], changes = [];
  const deps = {
    'next/server': { NextResponse: Response },
    '@/lib/holding-commercial-auth': { authorizeHoldingCommercial: async (_req, resources) => {
      permissions.push(resources);
      return allowed ? null : Response.json({ error: 'Forbidden' }, { status: 403 });
    } },
    '@/lib/supabase-server': { supabaseServer: { rpc: async (name, args) => { rpcs.push({ name, args }); return { data: id, error: null }; } } },
    '@/lib/website-subscription-terms': terms,
    '@/lib/holding-customers': customers,
    '@/lib/website-subscription-approval': { approveWebsiteSubscription: async () => {} },
    '@/lib/website-subscriptions': {
      billWebsiteSubscription: async (...args) => { bills.push(args); return { message: 'Test' }; },
      changeWebsiteSubscription: async (...args) => { changes.push(args); return { message: 'Test' }; },
    },
  };
  const route = load('src/app/api/admin/website-subscriptions/route.ts', deps);
  const billing = load('src/app/api/admin/website-subscriptions/billing/route.ts', deps);
  const request = (body) => new Request('https://holding.test/api', { method: 'POST', body: JSON.stringify(body) });
  const input = {
    request_id: id, customer_id: id, plan_id: id, amount_cents: 25550, payment_method: 'PIX',
    billing_cycle: 'quarterly', first_due_date: '2026-11-20', fiscal_confirmed: true,
    plan_snapshot: { name: 'forged' }, asaas_subscription_id: 'sub_untrusted',
  };
  assert.equal((await route.POST(request(input))).status, 403);
  assert.equal((await billing.POST(request({ id, action: 'generate' }))).status, 403);
  assert.equal((await billing.POST(request({ id, action: 'pause', confirmed: true }))).status, 403);
  assert.equal(rpcs.length + bills.length, 0);
  assert.ok(permissions.every((required) => required.includes('menu.notas_fiscais') && required.includes('submenu.assinaturas.websites')));
  allowed = true;
  assert.equal((await route.POST(request({ ...input, fiscal_confirmed: false }))).status, 400);
  assert.equal((await route.POST(request(input))).status, 201);
  assert.equal(rpcs[0].name, 'holding_create_website_subscription');
  assert.equal(rpcs[0].args.p_amount_cents, 25550); assert.equal(rpcs[0].args.p_cycle, 'quarterly');
  assert.equal(rpcs[0].args.plan_snapshot, undefined); assert.equal(rpcs[0].args.asaas_subscription_id, undefined);
  assert.equal((await billing.POST(request({ id, action: 'generate' }))).status, 400);
  for (const action of ['generate', 'sync']) assert.equal((await billing.POST(request({ id, action, confirmed: true }))).status, 200);
  assert.deepEqual(bills, [[id, true], [id, false]]);
  assert.equal((await billing.POST(request({ id, action: 'delete' }))).status, 400);
  for (const action of ['pause', 'resume', 'cancel']) {
    assert.equal((await billing.POST(request({ id, action }))).status, 400);
    assert.equal((await billing.POST(request({ id, action, confirmed: false }))).status, 400);
    assert.equal((await billing.POST(request({ id, action, confirmed: true, next_due_date: '2026-12-10', asaas_subscription_id: 'sub_foreign' }))).status, 200);
  }
  assert.deepEqual(changes, ['pause', 'resume', 'cancel'].map((action) => [id, action, '2026-12-10']));
});

test('pause, resume with new due date and terminal cancellation only update own subscription, never payments or invoices', async () => {
  const h = harness();
  await h.changeWebsiteSubscription(id, 'pause');
  let local = h.tables.holding_website_subscriptions[0];
  assert.equal(local.lifecycle_status, 'paused'); assert.equal(local.remote_status, 'INACTIVE');
  assert.equal(local.pending_action, null); assert.equal(local.billing_state, 'issued');
  assert.deepEqual(h.calls.find(([name]) => name === 'PUT subscription'), ['PUT subscription', 'sub_test', 'INACTIVE', undefined]);
  await h.changeWebsiteSubscription(id, 'resume', '2026-12-20');
  assert.equal(local.lifecycle_status, 'active');
  assert.deepEqual(h.calls.at(-1), ['PUT subscription', 'sub_test', 'ACTIVE', '2026-12-20']);
  await h.changeWebsiteSubscription(id, 'cancel');
  assert.equal(local.lifecycle_status, 'cancelled');
  await assert.rejects(h.changeWebsiteSubscription(id, 'resume', '2026-12-20'), /encerrada/);
  await assert.rejects(h.billWebsiteSubscription(id, true), /já enviada/);
  assert.equal(h.sends.length, 0);
  assert.ok(h.writes.every((write) => write.table === 'holding_website_subscriptions'));
});

test('local lifecycle changes never call Asaas, paused/cancelled cannot generate, and reactivation validates dates', async () => {
  const h = harness({ local: row({ billing_state: 'local', asaas_environment: null, asaas_subscription_id: null, asaas_customer_id: null }) });
  await h.changeWebsiteSubscription(id, 'pause');
  await assert.rejects(h.billWebsiteSubscription(id, true), /pausada/);
  for (const date of [undefined, '2026-02-30', '2026-11-03']) await assert.rejects(h.changeWebsiteSubscription(id, 'resume', date), /vencimento/);
  await h.changeWebsiteSubscription(id, 'resume', '2026-12-10');
  assert.equal(h.tables.holding_website_subscriptions[0].first_due_date, '2026-12-10');
  await h.changeWebsiteSubscription(id, 'cancel');
  await assert.rejects(h.billWebsiteSubscription(id, true), /encerrada/);
  assert.equal(h.calls.length, 0);
  const future = harness({ local: row({ lifecycle_status: 'paused', first_due_date: '2027-01-10' }) });
  await assert.rejects(future.changeWebsiteSubscription(id, 'resume', '2026-12-10'), /anteceder o início/);
  assert.equal(future.calls.length, 0);
});

test('lifecycle controls claim atomically, deny processing/review, reject foreign remote and never repeat uncertain mutations', async () => {
  for (const billing_state of ['processing', 'review']) {
    const h = harness({ local: row({ billing_state }) });
    await assert.rejects(h.changeWebsiteSubscription(id, 'pause'), /processamento\/revisão/);
    assert.equal(h.calls.length, 0);
  }
  const concurrent = harness();
  const results = await Promise.allSettled([concurrent.changeWebsiteSubscription(id, 'pause'), concurrent.changeWebsiteSubscription(id, 'cancel')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.calls.filter(([name]) => name === 'PUT subscription').length, 1);
  const foreign = harness();
  foreign.asaas.getSubscription = async () => remote({ customer: 'cus_foreign' });
  await assert.rejects(foreign.changeWebsiteSubscription(id, 'pause'), /divergente/);
  assert.equal(foreign.calls.filter(([name]) => name === 'PUT subscription').length, 0);
  const uncertain = harness({ current: payment({ status: 'PENDING' }) });
  let puts = 0;
  uncertain.asaas.setSubscriptionStatus = async () => { puts++; throw new Error('test timeout'); };
  await assert.rejects(uncertain.changeWebsiteSubscription(id, 'cancel'), /timeout/);
  assert.equal(uncertain.tables.holding_website_subscriptions[0].pending_action, 'cancel');
  assert.equal(uncertain.tables.holding_website_subscriptions[0].billing_state, 'review');
  await assert.rejects(uncertain.changeWebsiteSubscription(id, 'cancel'), /revisão/);
  await assert.rejects(uncertain.billWebsiteSubscription(id, false), /não foi confirmada/);
  uncertain.asaas.getSubscription = async () => remote({ status: 'INACTIVE' });
  await uncertain.billWebsiteSubscription(id, false);
  assert.equal(puts, 1);
  assert.equal(uncertain.tables.holding_website_subscriptions[0].lifecycle_status, 'cancelled');
  assert.equal(uncertain.tables.holding_website_subscriptions[0].pending_action, null);
});

test('payments issued before interruption still invoice after confirmation and fiscal failures remain visible', async () => {
  for (const lifecycle_status of ['paused', 'cancelled']) {
    const h = harness({ local: row({ lifecycle_status }), sendFail: lifecycle_status === 'cancelled' });
    h.asaas.getSubscription = async () => remote({ status: 'INACTIVE' });
    await h.processWebsiteSubscriptionPayment(payment());
    assert.equal(h.sends.length, 1);
    if (lifecycle_status === 'cancelled') assert.match(h.tables.holding_website_subscription_payments[0].fiscal_error, /timeout/);
  }
});

test('uncertain reactivation confirms the chosen due date on sync and never sends the update twice', async () => {
  const h = harness({ local: row({ lifecycle_status: 'paused', remote_status: 'INACTIVE' }), current: payment({ status: 'PENDING' }) });
  let state = remote({ status: 'INACTIVE' }), puts = 0;
  h.asaas.getSubscription = async () => state;
  h.asaas.setSubscriptionStatus = async (_id, status, nextDueDate) => {
    puts++; state = remote({ status, nextDueDate }); throw new Error('test timeout after update');
  };
  await assert.rejects(h.changeWebsiteSubscription(id, 'resume', '2026-12-10'), /timeout/);
  assert.equal(h.tables.holding_website_subscriptions[0].resume_due_date, '2026-12-10');
  state = remote({ status: 'ACTIVE', nextDueDate: '2026-12-11' });
  await assert.rejects(h.billWebsiteSubscription(id, false), /não foi confirmada/);
  state.nextDueDate = '2026-12-10';
  await h.billWebsiteSubscription(id, false);
  assert.equal(h.tables.holding_website_subscriptions[0].lifecycle_status, 'active');
  assert.equal(h.tables.holding_website_subscriptions[0].pending_action, null);
  assert.equal(h.tables.holding_website_subscriptions[0].resume_due_date, null);
  assert.equal(puts, 1);
});

test('ended subscriptions cannot be silently reactivated by a remote change and stale lifecycle claims cannot generate', async () => {
  const ended = harness({ local: row({ lifecycle_status: 'cancelled' }), current: payment({ status: 'PENDING' }) });
  await assert.rejects(ended.billWebsiteSubscription(id, false), /reativada fora/);
  assert.equal(ended.tables.holding_website_subscriptions[0].lifecycle_status, 'cancelled');
  assert.equal(ended.sends.length, 0);
  const h = harness({ local: row({ billing_state: 'local', asaas_environment: null, asaas_subscription_id: null }) });
  const results = await Promise.allSettled([h.changeWebsiteSubscription(id, 'pause'), h.billWebsiteSubscription(id, true)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'POST subscription').length, 0);
});

test('subscription status transport uses PUT, preserves pending payments, validates IDs and never exposes a DELETE', async () => {
  const calls = [];
  const adapter = load('src/lib/website-asaas.ts', {
    '@/lib/finance-config-server': { readFinanceConfig: async () => ({ asaasApiKey: 'test-only', asaasEnv: 'sandbox' }) },
  }, { fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, init, body });
    return Response.json(remote({ status: body.status, nextDueDate: body.nextDueDate || '2026-12-10' }));
  } });
  const client = await adapter.createWebsiteAsaas();
  await client.setSubscriptionStatus('sub_test', 'INACTIVE');
  await client.setSubscriptionStatus('sub_test', 'ACTIVE', '2026-12-10');
  assert.ok(calls.every(({ init, body }) => init.method === 'PUT' && body.updatePendingPayments === false));
  assert.deepEqual(calls[0].body, { status: 'INACTIVE', updatePendingPayments: false });
  assert.deepEqual(calls[1].body, { status: 'ACTIVE', nextDueDate: '2026-12-10', updatePendingPayments: false });
  await assert.rejects(client.setSubscriptionStatus('glass|id', 'INACTIVE'), /inválido/);
  assert.equal(calls.length, 2);
});
