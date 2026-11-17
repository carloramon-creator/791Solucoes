import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

const tenantId = 'test-tenant';
const accessCharges = load('src/lib/glass-access-charges.ts', {});
const limits = {
  usersIncluded: 10, extraUserPrice: 50, wppDevices: 10, extraDevicePrice: 20,
  wppMessages: 1000, extraMessagePrice: 0.1, mktMessages: 200, extraMktMessagePrice: 0.5,
  consultflexBasicPrice: 5, consultflexCompletePrice: 10,
};

function database(tables, { forbidProfiles = false, failTable } = {}) {
  const writes = [];
  class Query {
    constructor(table) {
      if (forbidProfiles) assert.notEqual(table, 'user_profiles', 'Closing must not bill registered users');
      this.table = table;
      this.filters = [];
    }
    select(_columns, options) { this.count = options?.count === 'exact'; return this; }
    eq(column, value) {
      if (column === 'sistema') this.system = value;
      if (this.table === 'orcamento_assinaturas_autentique') this.filters.push((row) => row[column] === value);
      return this;
    }
    not(column, op, value) {
      if (this.table === 'orcamento_assinaturas_autentique' && op === 'is' && value === null) this.filters.push((row) => row[column] != null);
      return this;
    }
    in() { return this; }
    gte(column, value) { if (this.table === 'orcamento_assinaturas_autentique') this.filters.push((row) => new Date(row[column]) >= new Date(value)); return this; }
    lte() { return this; }
    lt(column, value) { if (this.table === 'orcamento_assinaturas_autentique') this.filters.push((row) => new Date(row[column]) < new Date(value)); return this; }
    order() { return this; }
    range() { return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    insert(value) { this.write = value; return this; }
    update(value) { this.write = value; return this; }
    then(resolve, reject) {
      if (this.write) writes.push({ table: this.table, value: this.write });
      let rows = tables[this.table] || [];
      if (this.system) rows = rows.filter((row) => row.sistema === this.system);
      if (this.table === 'orcamento_assinaturas_autentique') rows = rows.filter((row) => this.filters.every((filter) => filter(row)));
      return Promise.resolve({
        data: this.write ? { id: 'test-record' } : this.one ? rows[0] || null : rows,
        count: this.count ? rows.length : null,
        error: this.table === failTable ? { message: 'Test database error' } : null,
      }).then(resolve, reject);
    }
  }
  return {
    writes,
    from: (table) => new Query(table),
    rpc: async (name) => {
      assert.equal(name, 'whatsapp_uso_mensal');
      return { data: tables.whatsapp_usage || [{ vidracaria_id: tenantId, sac: 0, marketing: 0 }], error: null };
    },
  };
}

function harness({ users = 14, messages = 0, marketing = 0, credit = false, existing, failTable, orders = [], whatsappUsers = 0, documents = 0, signatureRows, mini = false, enableCharge = false, signatureLimits = { autentiqueDocsIncluded: 10, autentiqueExtraDocPrice: 1 } } = {}) {
  const payments = [];
  const tables = {
    vidracarias: [{
      id: tenantId, nome: 'Test', cnpj: enableCharge ? '12345678000199' : null, email: 'tenant@example.test', plano_codigo: mini ? 'mini' : 'padrao', limite_usuarios: 10, limite_usuarios_whats: 10,
      limite_mensagens_whatsapp: 1000, limite_mensagens_marketing: 200,
    }],
    user_profiles: Array.from({ length: users }, (_, i) => ({ user_id: `u${i}`, vidracaria_id: tenantId, ativo: true })),
    glass_whatsapp_access_users: Array.from({ length: whatsappUsers }, (_, i) => ({ user_id: `u${i}`, vidracaria_id: tenantId })),
    glass_access_orders: orders,
    orcamento_assinaturas_autentique: signatureRows || Array.from({ length: documents }, (_, i) => ({ id: `doc-${i}`, vidracaria_id: tenantId, autentique_document_id: `remote-${i}`, status: 'aguardando_assinaturas', enviado_em: '2026-10-15T12:00:00Z' })),
    whatsapp_usage: [{ vidracaria_id: tenantId, sac: messages, marketing }],
    orcamentos: credit ? [{ id: 'budget', vidracaria_id: tenantId }] : [],
    orcamento_credito_consultas: credit ? [{
      id: 'query', orcamento_id: 'budget', vidracaria_id: tenantId,
      tipo_consulta: 'basico', status_consulta: 'sucesso',
    }] : [],
  };
  const holding = database({
    system_plans: [
      { sistema: '791glass', system_limits: { ...limits, ...(mini ? {} : signatureLimits) } },
      { sistema: '791glass-mini', system_limits: signatureLimits },
    ],
    system_settings: [{ value: enableCharge ? { asaasApiKey: 'test-key' } : {} }],
    system_finance_records: existing ? [existing] : [],
  });
  const glass = database(tables, { failTable });
  const closingGlass = database(tables, { forbidProfiles: true, failTable });
  const api = load('src/app/api/admin/subscription-usage/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/glass-client': { getGlassClient: async () => glass },
    '@/lib/supabase-server': { supabaseServer: holding },
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true }) },
    '@/lib/glass-access-charges': accessCharges,
  });
  const payment = load('src/services/payment-processor.ts', {
    './asaas-service': { AsaasClient: class {
      async getCustomerByEmail() { return { id: 'test-customer' }; }
      async createPayment(payment) { payments.push(payment); return { id: 'test-payment', invoiceUrl: 'https://test.example/invoice' }; }
    } },
    '@/lib/overage-block': { registerOverageBlockRule: async () => {} }, './inter-service': {}, '@supabase/supabase-js': {},
    '@/lib/nfse/providers/ipm': {}, '@/services/nfse/danfse-snapshot': {},
    '@/services/nfse/emissao-nacional': {},
    '@/lib/glass-access-charges': accessCharges,
  });
  return {
    holding,
    payments,
    usage: () => api.GET(new Request('https://holding.test/api/admin/subscription-usage')),
    close: (options = {}) => payment.scheduleMonthlyOverageChargeForTenant({
      holdingSupabase: holding, glassSupabase: closingGlass, tenantId,
      now: new Date(2026, 10, 1, 12), ...options,
    }),
  };
}

for (const users of [10, 14, 100]) {
  test(`${users} registered users with 10 simultaneous slots produce no usage charge`, async () => {
    const h = harness({ users });
    const response = await h.usage();
    assert.equal(response.status, 200);
    const data = await response.json();
    const tenant = data.tenants[0];
    assert.equal(tenant.usage.registeredUsers, users);
    assert.equal(tenant.limits.users, 10);
    assert.equal(tenant.status.users, 'ok');
    assert.equal(tenant.overage.extraUsers, 0);
    assert.equal(tenant.overage.values.users, 0);
    assert.equal(tenant.overage.values.total, 0);
    const closing = await h.close();
    assert.equal(closing.reason, 'no_overage');
    assert.equal(closing.details.values.total, 0);
    assert.equal(closing.details.extras.users, 0);
    assert.deepEqual(h.holding.writes, []);
  });
}

test('messages, marketing and Consultflex keep their charges without charging registered users', async () => {
  const h = harness({ messages: 1010, marketing: 202, credit: true });
  const tenant = (await (await h.usage()).json()).tenants[0];
  assert.equal(tenant.overage.values.users, 0);
  assert.equal(tenant.overage.values.messages, 1);
  assert.equal(tenant.overage.values.marketingMessages, 1);
  assert.equal(tenant.overage.values.consultflexTotal, 5);
  assert.equal(tenant.overage.values.total, 7);
  const closing = await h.close({ previewOnly: true });
  assert.equal(closing.reason, 'preview');
  assert.equal(closing.details.values.total, 7);
  assert.equal(closing.details.values.users, 0);
  assert.deepEqual(h.holding.writes, []);
});

test('monthly closing writes only legitimate usage and never adds registered users', async () => {
  const h = harness({ messages: 1010 });
  const closing = await h.close();
  assert.equal(closing.created, true);
  const record = h.holding.writes[0].value;
  assert.equal(record.value, 1);
  assert.equal(record.metadata.values.users, 0);
  assert.equal(record.metadata.extras.users, 0);
  assert.doesNotMatch(record.description, /Usuários extras/);
});

test('existing financial history stays intact, including old user charges', async () => {
  const existing = {
    id: 'old-invoice', value: 200,
    metadata: { extras: { users: 4 }, values: { users: 200, total: 200 } },
  };
  const h = harness({ existing });
  assert.equal((await h.close()).reason, 'already_exists');
  const preview = await h.close({ previewOnly: true });
  assert.equal(preview.reason, 'preview_existing');
  assert.equal(preview.details.values.users, 200);
  assert.equal(preview.details.values.total, 200);
  assert.deepEqual(h.holding.writes, []);
});

test('database failures remain explicit rather than returning a zero estimate', async () => {
  const h = harness({ failTable: 'vidracarias' });
  const response = await h.usage();
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Test database error/);
  await assert.rejects(h.close(), /Test database error/);
});

test('named WhatsApp grants are metrics, never implicit excess charges', async () => {
  const h = harness({ users: 100, whatsappUsers: 14 });
  const tenant = (await (await h.usage()).json()).tenants[0];
  assert.equal(tenant.usage.whatsappUsers, 14);
  assert.equal(tenant.overage.values.whatsappUsers, 0);
  assert.equal(tenant.overage.values.total, 0);
  assert.equal((await h.close()).reason, 'no_overage');
});

test('only explicit confirmed nonmonthly access orders enter monthly closing', async () => {
  const order = { id: 'order', vidracaria_id: tenantId, kind: 'system', quantity: 2, unit_cents: 5000,
    status: 'confirmed', cycle: 'annual', billing_from: '2026-10-25', billing_until: '2027-01-10' };
  const h = harness({ orders: [order, { ...order, status: 'quoted' }, { ...order, cycle: 'monthly' }] });
  assert.equal((await h.close({ previewOnly: true })).details.values.accessAddons, 100);
  const closed = await h.close();
  assert.equal(closed.created, true);
  assert.equal(h.holding.writes[0].value.value, 100);
  assert.equal(h.holding.writes[0].value.metadata.values.accessAddons, 100);
  assert.equal(accessCharges.glassAccessChargesForMonth([order], '2026-09').total, 0);
  assert.equal(accessCharges.glassAccessChargesForMonth([order], '2026-10').total, 100);
  assert.equal(accessCharges.glassAccessChargesForMonth([order], '2026-12').total, 100);
  assert.equal(accessCharges.glassAccessChargesForMonth([order], '2027-01').total, 0);
  assert.throws(() => accessCharges.glassAccessChargesForMonth([order], '2026-13'));
});

test('sent documents over the plan allowance join the single monthly invoice', async () => {
  const h = harness({ documents: 12, messages: 1010, marketing: 202, credit: true });
  const preview = await h.close({ previewOnly: true });
  assert.deepEqual(preview.details.autentique, { uso: 12, franquia: 10, preco: 1, excedentes: 2, valor: 2 });
  assert.equal(preview.details.values.total, 9);
  const closed = await h.close();
  assert.equal(closed.created, true);
  const record = h.holding.writes[0].value;
  assert.equal(record.value, 9);
  assert.equal(record.metadata.values.autentique, 2);
  assert.deepEqual(record.metadata.autentique, preview.details.autentique);
  assert.match(record.description, /Autentique.*12 documentos.*10 inclusos.*2 excedentes/);
});

test('plan allowance, mini pricing and unconfigured plans are respected', async () => {
  const included = harness({ documents: 10 });
  assert.equal((await included.close()).reason, 'no_overage');
  const mini = harness({ documents: 12, mini: true, signatureLimits: { autentiqueDocsIncluded: 5, autentiqueExtraDocPrice: 2 } });
  assert.equal((await mini.close({ previewOnly: true })).details.values.autentique, 14);
  const unconfigured = harness({ documents: 11, signatureLimits: {} });
  await assert.rejects(unconfigured.close(), /Franquia ou preço Autentique não configurado/);
});

test('only successfully sent documents for this tenant and Brasília month are counted', async () => {
  const base = { vidracaria_id: tenantId, autentique_document_id: 'sent', status: 'aguardando_assinaturas' };
  const h = harness({
    signatureLimits: { autentiqueDocsIncluded: 0, autentiqueExtraDocPrice: 1 },
    signatureRows: [
      { ...base, enviado_em: '2026-10-01T02:59:59Z' },
      { ...base, enviado_em: '2026-10-01T03:00:00Z' },
      { ...base, enviado_em: '2026-11-01T02:59:59Z' },
      { ...base, enviado_em: '2026-11-01T03:00:00Z' },
      { ...base, autentique_document_id: null, enviado_em: '2026-10-15T12:00:00Z' },
      { ...base, vidracaria_id: 'other', enviado_em: '2026-10-15T12:00:00Z' },
    ],
  });
  assert.equal((await h.close({ previewOnly: true })).details.autentique.uso, 2);
  const failed = harness({ failTable: 'orcamento_assinaturas_autentique' });
  await assert.rejects(failed.close(), /Test database error/);
});

test('one Asaas charge includes the detailed signature excess and other consumption', async () => {
  const h = harness({ documents: 12, messages: 1010, marketing: 202, credit: true, enableCharge: true });
  const closed = await h.close();
  assert.equal(closed.created, true);
  assert.equal(h.payments.length, 1);
  assert.equal(h.payments[0].value, 9);
  assert.equal(h.payments[0].dueDate, '2026-11-10');
  assert.match(h.payments[0].description, /WhatsApp SAC.*WhatsApp Marketing.*ConsultFlex Básica.*Autentique.*2 excedentes/);
});
