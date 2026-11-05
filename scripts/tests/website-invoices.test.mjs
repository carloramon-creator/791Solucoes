import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}
const customers = load('src/lib/holding-customers.ts');
const terms = load('src/lib/website-contracts.ts', { '@/lib/holding-customers': customers });
const plans = load('src/lib/website-plans.ts');
const xml = load('src/services/nfse/xml-service.ts', {
  'fast-xml-parser': require('fast-xml-parser'),
  './cancelamento': load('src/services/nfse/cancelamento.ts', {
    './data-hora': load('src/services/nfse/data-hora.ts'),
  }),
});
const id = '20000000-0000-4000-8000-000000000001';
const contract = () => ({
  id, total_cents: 300001,
  customer_snapshot: {
    name: 'Cliente ficticio', document: '52998224725', email: 'test@example.test',
    postal_code: '01001000', address: 'Rua ficticia', address_number: '10',
    district: 'Centro', city: 'Sao Paulo', state: 'SP',
  },
  plan_snapshot: {
    invoice_policy: 'manual_project_total',
    fiscal_config: {
      national_code: '010101', municipal_code: '', nbs: '123456789',
      service_description: 'Confeccao de website ficticio', simples_percent: 8.25, accountant_confirmed: true,
    },
  },
});
const config = () => ({
  environment: 'producao', prestador_cnpj: '11222333000181', pfxBase64: 'test-only',
  passphrase: ' password with spaces ',
  nacional: { enabled: true, enquadramentoConfirmado: true, serie: '1', municipioEmissao: '3550308',
    // Must never use the licensing codes, even when present in the shared issuer.
    codigoTributacaoNacional: '010501', codigoNbs: '111032200' },
});
const result = {
  success: true, status: 'authorized', invoiceId: '123', message: 'Test',
  xml: '<NFSe><infNFSe><nNFSe>123</nNFSe></infNFSe></NFSe>',
  accessLink: 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1',
};
function harness({ local = contract(), settings = config(), timeout = false, editDuringReservation = false, failTable, failStatus } = {}) {
  const tables = {
    holding_website_contracts: [local], system_settings: [{ id: 'nfse_config', value: settings }],
    holding_website_invoices: [], system_invoices: [],
  };
  const calls = [], writes = [];
  class Query {
    constructor(table) { assert.ok(table in tables, `Cross-boundary table: ${table}`); this.table = table; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    single() { this.singleRow = true; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    update(value) { this.updateValue = value; return this; }
    insert(value) { this.insertValue = value; return this; }
    then(resolve, reject) {
      const selected = tables[this.table].filter((row) => this.filters.every(([key, value]) => row[key] === value));
      const value = this.updateValue || this.insertValue;
      if (value) {
        writes.push({ table: this.table, value });
        if (this.table === failTable && (!failStatus || value.status === failStatus || value.value?.status === failStatus)) {
          return Promise.resolve({ data: null, error: { code: 'TEST' } }).then(resolve, reject);
        }
        if (this.insertValue) {
          const row = { id: 'history-id', ...this.insertValue };
          tables[this.table].push(row); selected.push(row);
        } else selected.forEach((row) => Object.assign(row, value));
      }
      return Promise.resolve({ data: structuredClone(this.singleRow ? selected[0] : selected), error: null }).then(resolve, reject);
    }
  }
  const db = {
    from: (table) => new Query(table),
    rpc: (name, args) => ({ single: async () => {
      const recurring = name === 'holding_reserve_website_subscription_invoice';
      assert.equal(name, recurring ? 'holding_reserve_website_subscription_invoice' : 'holding_reserve_website_invoice');
      assert.equal(recurring ? args.p_payment_id : args.p_contract_id, id);
      if (tables.holding_website_invoices.length) return { error: { code: '23505' } };
      const row = {
        id: 'reservation-id', contract_id: recurring ? null : id, subscription_payment_id: recurring ? id : null,
        operation: `nfse_producao_website_${recurring ? 'subscription_' : ''}${id}`,
        dps_number: '42', series: args.p_series, competence: args.p_competence || '2026-11-04', status: 'preparing',
      };
      tables.holding_website_invoices.push(row);
      tables.system_settings.push({ id: row.operation, value: { status: 'preparando' } });
      if (editDuringReservation) tables.holding_website_contracts[0].total_cents = 1;
      return { data: row, error: null };
    } }),
  };
  const api = load('src/lib/website-invoices.ts', {
    '@/lib/supabase-server': { supabaseServer: db }, '@/lib/website-plans': plans,
    '@/lib/website-contracts': terms, '@/lib/holding-customers': customers,
    '@/services/nfse/providers/national': { __esModule: true, default: {
      emit: async (...args) => { calls.push(args); if (timeout) throw new Error('test timeout'); return result; },
    } },
    '@/services/nfse/xml-service': xml,
    '@/services/nfse/data-hora': { dataHoraNacional: () => '2026-11-04T12:00:00-03:00' },
    '@/services/nfse/documento-oficial': load('src/services/nfse/documento-oficial.ts', { 'fast-xml-parser': require('fast-xml-parser') }),
    '@/services/nfse/danfse-snapshot': load('src/services/nfse/danfse-snapshot.ts'),
    '@/services/nfse/municipios-ibge.json': [{ codigo: '3550308', nome: 'São Paulo', uf: 'SP' }],
  });
  return { ...api, calls, tables, writes };
}

test('a concurrent contract edit cannot send a stale fiscal snapshot after reservation', async () => {
  const h = harness({ editDuringReservation: true });
  await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-04', true), /alterada durante a reserva/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.tables.holding_website_invoices.length, 1);
});

test('preview validates the complete DPS, uses project fiscal snapshot and performs zero writes or sends', async () => {
  const h = harness();
  const preview = await h.emitWebsiteInvoice(id, '2026-11-04', false);
  assert.equal(preview.sent, false);
  assert.equal(preview.preview.total_cents, 300001);
  assert.equal(preview.preview.simples_percent, 8.25);
  const data = h.websiteInvoiceData(contract(), config(), '2026-11-04');
  const body = xml.default.generateDPS(data);
  assert.match(body, /<cTribNac>010101<\/cTribNac>/);
  assert.doesNotMatch(body, /<cTribMun>|010501|111032200/);
  assert.match(body, /<pTotTribSN>8.25<\/pTotTribSN>/);
  assert.match(body, /<vServ>3000.01<\/vServ>/);
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
  assert.equal(h.tables.holding_website_invoices.length, 0);
});

test('one project total can be manually issued before payment, independently of billing, with durable official history', async () => {
  const h = harness();
  const emitted = await h.emitWebsiteInvoice(id, '2026-11-04', true);
  assert.equal(emitted.sent, true);
  assert.equal(h.calls.length, 1);
  const [data, certificate, password] = h.calls[0];
  assert.equal(data.ambiente, 1); assert.equal(data.numero, '42');
  assert.equal(data.servico.valorServicos, 3000.01);
  assert.equal(certificate, 'test-only'); assert.equal(password, ' password with spaces ');
  assert.equal(h.tables.holding_website_invoices[0].status, 'authorized');
  assert.equal(h.tables.holding_website_invoices[0].system_invoice_id, 'history-id');
  const history = h.tables.system_invoices[0];
  assert.equal(history.value, 3000.01);
  assert.equal(history.metadata.operacao_nacional, `nfse_producao_website_${id}`);
  assert.equal(history.metadata.xml, result.xml);
  await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-03', true), /já reservada/);
  assert.equal(h.calls.length, 1);
});

test('concurrent confirmations reserve and send only one DPS', async () => {
  const h = harness();
  const outcomes = await Promise.allSettled([
    h.emitWebsiteInvoice(id, '2026-11-04', true), h.emitWebsiteInvoice(id, '2026-11-04', true),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(h.calls.length, 1);
});

test('recurring invoices reuse the generic national pipeline with separate payment origin and idempotent reservation', async () => {
  const source = contract(); source.plan_snapshot.invoice_policy = 'automatic_after_payment'; source.total_cents = 99000;
  const h = harness();
  assert.equal((await h.emitWebsiteSubscriptionInvoice(id, source, '2026-11-04')).sent, true);
  assert.equal(h.calls[0][0].servico.valorServicos, 990);
  assert.equal(h.tables.system_invoices[0].metadata.website_subscription_payment_id, id);
  assert.equal(h.tables.system_invoices[0].metadata.website_contract_id, undefined);
  assert.equal(h.tables.system_invoices[0].metadata.invoice_policy, 'automatic_after_payment');
  assert.equal((await h.emitWebsiteSubscriptionInvoice(id, source, '2026-11-03')).sent, false);
  assert.equal(h.calls.length, 1);
});

test('timeouts retain review state and prevent retries even with another competence', async () => {
  const h = harness({ timeout: true });
  await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-04', true), /test timeout/);
  assert.equal(h.tables.holding_website_invoices[0].status, 'review');
  assert.equal(h.tables.system_settings.at(-1).value.status, 'verificar_no_portal');
  await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-03', true), /já reservada/);
  assert.equal(h.calls.length, 1); assert.equal(h.tables.system_invoices.length, 0);
});

test('local control failures never send; post-authorization persistence failures never allow another note', async () => {
  const h = harness({ failTable: 'system_settings', failStatus: 'enviando' });
  await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-04', true), /Nenhuma DPS enviada/);
  assert.equal(h.calls.length, 0);
  for (const failTable of ['holding_website_invoices', 'system_settings', 'system_invoices']) {
    const failed = harness({ failTable, failStatus: failTable === 'system_invoices' ? undefined : 'authorized' });
    await assert.rejects(failed.emitWebsiteInvoice(id, '2026-11-04', true), /autorizada/);
    await assert.rejects(failed.emitWebsiteInvoice(id, '2026-11-04', true), /já reservada/);
    assert.equal(failed.calls.length, 1);
  }
});

test('missing fiscal confirmation, invalid tax rates/addresses and recurring products fail before reservation', async () => {
  const changes = [
    (c) => { c.plan_snapshot.fiscal_config.accountant_confirmed = false; },
    (c) => { c.plan_snapshot.fiscal_config = null; },
    (c) => { c.plan_snapshot.fiscal_config.simples_percent = null; },
    (c) => { c.plan_snapshot.fiscal_config.simples_percent = 101; },
    (c) => { c.plan_snapshot.invoice_policy = 'automatic_after_payment'; },
    (c) => { c.customer_snapshot.postal_code = ''; },
    (c) => { c.customer_snapshot.city = 'unknown'; },
    (c) => { c.customer_snapshot.document = '00000000000'; },
  ];
  for (const change of changes) {
    const c = contract(); change(c); const h = harness({ local: c });
    await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-04', true));
    assert.equal(h.tables.holding_website_invoices.length, 0); assert.equal(h.calls.length, 0);
  }
  for (const competence of ['2027-01-01', '2026-11-05', '2026-02-30', '']) {
    const h = harness();
    await assert.rejects(h.emitWebsiteInvoice(id, competence, true));
    assert.equal(h.calls.length, 0);
  }
  const settings = config(); settings.environment = 'homologacao';
  const h = harness({ settings });
  await assert.rejects(h.emitWebsiteInvoice(id, '2026-11-04', true), /produção/);
});

test('invoice endpoint requires Websites and fiscal permissions, strict UUID and explicit boolean confirmation', async () => {
  let allowed = false, permissions, calls = 0;
  const route = load('src/app/api/admin/website-contracts/invoice/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-commercial-auth': { authorizeHoldingCommercial: async (_req, resources) => {
      permissions = resources; return allowed ? null : Response.json({ error: 'Forbidden' }, { status: 403 });
    } },
    '@/lib/holding-customers': customers,
    '@/lib/website-invoices': { emitWebsiteInvoice: async () => { calls++; return { sent: false, preview: {} }; } },
  });
  const request = (body) => new Request('https://holding.test/api/admin/website-contracts/invoice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const valid = { id, competence: '2026-11-04', confirmed: false };
  assert.equal((await route.POST(request(valid))).status, 403);
  assert.deepEqual(permissions, ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.notas_fiscais']);
  allowed = true;
  for (const body of [null, {}, { ...valid, id: 'glass|id' }, { ...valid, confirmed: 'true' }]) {
    assert.equal((await route.POST(request(body))).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await route.POST(request(valid))).status, 200);
  assert.equal(calls, 1);
});
