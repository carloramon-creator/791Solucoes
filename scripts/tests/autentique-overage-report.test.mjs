import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('detalhamento da fatura usa os valores fechados de todos os consumos', async () => {
  const output = ts.transpileModule(readFileSync('src/app/api/admin/tenant-invoices/[id]/consultflex-report/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const metadata = {
    tenant_id: 'tenant', ref_month: '2026-10', period_start: '2026-10-01', period_end: '2026-11-01',
    prices: { consultflexBasicPrice: 5.005 }, consultflex: { basic: 1, complete: 0 },
    autentique: { uso: 12, franquia: 10, excedentes: 2, preco: 1.005 },
    extras: { messages: 10, marketingMessages: 2 },
    values: { consultflexBasic: 5, messages: 1, marketingMessages: 1, autentique: 2, accessAddons: 3 },
  };
  const from = (table) => ({
    select() { return this; }, eq() { return this; },
    single() { return Promise.resolve({ data: table === 'system_finance_records' ? { id: 'record', value: 12, metadata } : { nome: 'Tenant' }, error: null }); },
  });
  const deps = {
    'next/server': { NextResponse: Response }, pdfkit: {}, stream: {}, fs: {}, path: {},
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true }) },
    '@/lib/supabase-server': { supabaseServer: { from } },
    '@/lib/glass-client': { getGlassClient: async () => ({ from(table) { assert.equal(table, 'vidracarias'); return from(table); } }) },
    '@/services/nfse/noto-sans-base64': { notoSansBase64: '' },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    assert.ok(id in deps, `Unexpected dependency: ${id}`);
    return deps[id];
  }, mod, mod.exports);
  const response = await mod.exports.GET(new Request('https://holding.test/report?format=json'), { params: Promise.resolve({ id: 'record' }) });
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.deepEqual(items.map((item) => [item.id, item.value]), [
    ['consultflex-basic', 5], ['sac', 1], ['marketing', 1], ['autentique', 2], ['access', 3],
  ]);
  assert.equal(items.find((item) => item.id === 'autentique').name, '12 docs / 10 inclusos');
  assert.equal(items.find((item) => item.id === 'autentique').type, '2 excedentes x R$ 1,005');
  assert.equal(items.find((item) => item.id === 'consultflex-basic').type, 'Unitário R$ 5,005');
});
