import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';

function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in overrides)) throw new Error(`Missing mock ${id}`);
    return overrides[id];
  }, mod, mod.exports);
  return mod.exports;
}
const helpers = load('src/lib/ai-usage-report.ts');
const tenant = '11111111-1111-4111-8111-111111111111';
test('USD estimates keep sub-cent precision and distinguish unknown costs from zero', () => {
  assert.equal(helpers.formatarCustoIA(null), 'Não calculado');
  assert.match(helpers.formatarCustoIA(0), /0,00/);
  assert.match(helpers.formatarCustoIA(0.00000555), /0,00000555/);
  assert.match(helpers.formatarCustoIA(12.34), /12,34/);
});
test('report uses half-open Brasilia days and exact pagination/filter parameters', () => {
  assert.deepEqual(helpers.parametrosConsumoIA(new URLSearchParams({
    inicio: '2026-10-13', fim: '2026-10-13', tenant, funcao: 'credito.analise', pagina: '2',
  })), { p_inicio: '2026-10-13T03:00:00.000Z', p_fim: '2026-10-14T03:00:00.000Z', p_tenant: tenant, p_funcao: 'credito.analise', p_pagina: 2 });
});
test('invalid dates, ranges, tenant, usage and page are rejected, not silently defaulted', () => {
  for (const invalid of [
    { inicio: '2026-02-30' }, { fim: '2026-10-01' }, { inicio: '2024-01-01' },
    { tenant: 'invalid' }, { funcao: 'unknown' }, { pagina: '0' }, { pagina: '1.5' }, { pagina: '1000000' },
  ]) assert.throws(() => helpers.parametrosConsumoIA(new URLSearchParams({ inicio: '2026-10-13', fim: '2026-10-13', ...invalid })));
});
function route({ authorized = true, dbError = null, nameError = null } = {}) {
  const calls = [];
  const result = {
    total: 55, tenants: [{ tenant_id: tenant, chamadas: 55, tokens_total: 1210, custo_estimado_usd: 0.00030525 }],
    funcoes: [{ tenant_id: tenant, funcao: 'credito.analise', custo_estimado_usd: 0.00030525 }],
    mensal: [{ tenant_id: tenant, mes: '2026-10', custo_estimado_usd: 0.00030525 }],
    eventos: [{ tenant_id: tenant, tokens_total: 22, custo_estimado_usd: 0.00000555 }],
  };
  const api = load('src/app/api/admin/ai-usage/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => authorized ? { ok: true } : { ok: false, status: 403, error: 'Denied' } },
    '@/lib/ai-usage-report': helpers,
    '@/lib/supabase-server': { supabaseServer: { rpc: async (name, params) => { calls.push({ name, params }); return { data: result, error: dbError }; } } },
    '@/lib/glass-client': { getGlassClient: async () => ({ from: table => {
      assert.equal(table, 'vidracarias');
      return { select: fields => { assert.equal(fields, 'id, nome'); return { in: async (_field, ids) => { assert.deepEqual(ids, [tenant]); return { data: [{ id: tenant, nome: 'Tenant fixture' }], error: nameError }; } }; } };
    } }) },
  });
  return { ...api, calls };
}
test('report route authenticates before queries and rejects invalid filters before RPC', async () => {
  const denied = route({ authorized: false });
  assert.equal((await denied.GET(new Request('http://localhost/api/admin/ai-usage'))).status, 403);
  assert.equal(denied.calls.length, 0);
  const invalid = route();
  assert.equal((await invalid.GET(new Request('http://localhost/api/admin/ai-usage?inicio=bad'))).status, 400);
  assert.equal(invalid.calls.length, 0);
});
test('report enriches names without altering full-period summary or paged detail counts', async () => {
  const api = route();
  const response = await api.GET(new Request('http://localhost/api/admin/ai-usage?inicio=2026-10-13&fim=2026-10-13&pagina=2'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json();
  assert.equal(result.total, 55);
  assert.equal(result.pagina, 2);
  assert.equal(result.tenants[0].tokens_total, 1210);
  assert.equal(result.tenants[0].nome, 'Tenant fixture');
  assert.equal(result.tenants[0].custo_estimado_usd, 0.00030525);
  assert.equal(result.funcoes[0].custo_estimado_usd, 0.00030525);
  assert.equal(result.mensal[0].custo_estimado_usd, 0.00030525);
  assert.equal(api.calls[0].name, 'ai_usage_report');
});
test('database and name lookup failures produce explicit errors, never empty-success reports', async () => {
  const old = console.error; console.error = () => {};
  try {
    for (const options of [{ dbError: new Error('missing_table') }, { nameError: new Error('unavailable') }]) {
      const api = route(options);
      const response = await api.GET(new Request('http://localhost/api/admin/ai-usage?inicio=2026-10-13&fim=2026-10-13'));
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /Não foi possível carregar/);
    }
  } finally { console.error = old; }
});

test('report renders precise USD, tenant/function/month summaries and unknown costs without showing a fake balance', () => {
  const resumo = {
    tenant_id: tenant, nome: 'Tenant fixture', chamadas: 2, operacoes: 1, tentativas_extras: 1,
    chamadas_com_consumo: 2, chamadas_com_custo: 1, operacoes_com_custo: 0, erros: 0, pendentes: 0,
    tokens_entrada: 17, tokens_saida: 5, tokens_total: 22, custo_estimado_usd: 0.00000555,
    custo_medio_chamada_usd: 0.00000555, custo_medio_operacao_usd: null, custo_tentativas_usd: null,
  };
  const report = {
    total: 2, pagina: 1, tenants: [resumo],
    funcoes: [{ ...resumo, funcao: 'credito.analise' }],
    mensal: [{ ...resumo, mes: '2026-10' }],
    eventos: [{
      id: 'event1', tenant_id: tenant, created_at: '2026-10-13T12:14:46Z',
      funcao: 'credito.analise', provider: 'openai', model: 'gpt-4o-mini', tentativa: 1,
      tokens_entrada: 17, tokens_cache: 0, tokens_saida: 5, tokens_total: 22, custo_estimado_usd: 0.00000555,
      tarifa_entrada_usd_milhao: 0.15, tarifa_cache_usd_milhao: 0.075, tarifa_saida_usd_milhao: 0.6,
      status: 'concluida', erro_codigo: null, referencia_id: null, prompt_chave: null,
    }],
  };
  let stateIndex = 0;
  const { default: Page } = load('src/app/assinaturas/consumo-ia/page.tsx', {
    'react/jsx-runtime': jsxRuntime,
    react: {
      Fragment: React.Fragment,
      useMemo: fn => fn(),
      useState: initial => {
        const i = stateIndex++;
        return [i === 4 ? report : i === 6 ? tenant : typeof initial === 'function' ? initial() : initial, () => {}];
      },
    },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/supabase-browser': { createSupabaseBrowser: () => ({}) },
    '@/lib/ai-usage-report': helpers,
  });
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /0,00000555/);
  assert.match(html, /Consumo geral da Holding/);
  assert.match(html, /Fechar evolução/);
  assert.match(html, /10\/2026/);
  assert.match(html, /gpt-4o-mini/);
  assert.doesNotMatch(html, /Média \/ operação|Tentativas extras|Custo por função e tenant/);
  assert.match(html, /09:14:46/);
  assert.match(html, /Tenant fixture/);
  assert.match(html, /1 chamada\(s\) sem custo calculado/);
  assert.doesNotMatch(html, /Saldo disponível|Sem estimativa de cobrança/);
});
