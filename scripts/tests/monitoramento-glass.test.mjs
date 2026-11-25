import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';

function route({ authenticated = true, permitted = true, queryError = null, configError = false } = {}) {
  const calls = [];
  const code = ts.transpileModule(readFileSync('src/app/api/admin/monitoramento-glass/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => authenticated
        ? { ok: true, user: { email: 'admin@example.test' } }
        : { ok: false, status: 401, error: 'Sessão inválida.' },
    },
    '@/lib/holding-route-permissions': {
      hasExplicitHoldingPermission: async (email, codes) => {
        calls.push(['permission', email, codes]);
        return permitted;
      },
    },
    '@/lib/glass-client': {
      getGlassClient: async () => {
        calls.push(['client']);
        if (configError) throw new Error('confidential settings');
        return { from: table => {
          calls.push(['table', table]);
          return { select: fields => {
            calls.push(['select', fields]);
            return { limit: count => {
              calls.push(['limit', count]);
              return { abortSignal: async signal => {
                assert.ok(signal instanceof AbortSignal);
                return { data: [], error: queryError };
              } };
            } };
          } };
        } };
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Missing mock ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return { ...module.exports, calls };
}

test('exige autenticação e permissão antes de acessar o Glass', async () => {
  const unauthenticated = route({ authenticated: false });
  assert.equal((await unauthenticated.GET(new Request('http://localhost'))).status, 401);
  assert.deepEqual(unauthenticated.calls, []);
  const denied = route({ permitted: false });
  assert.equal((await denied.GET(new Request('http://localhost'))).status, 403);
  assert.deepEqual(denied.calls, [['permission', 'admin@example.test', ['submenu.configuracoes.financeiro']]]);
});

test('verifica uma leitura limitada, inclusive quando não existem vidraçarias', async () => {
  const api = route();
  const response = await api.GET(new Request('http://localhost'));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.status, 'disponivel');
  assert.ok(Number.isFinite(result.tempoMs));
  assert.ok(Number.isFinite(Date.parse(result.verificadoEm)));
  assert.deepEqual(api.calls.slice(1), [['client'], ['table', 'vidracarias'], ['select', 'id'], ['limit', 1]]);
});

test('falhas de configuração ou consulta não são relatadas como sucesso nem expõem detalhes', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const options of [{ configError: true }, { queryError: new Error('confidential settings') }]) {
      const response = await route(options).GET(new Request('http://localhost'));
      const result = await response.json();
      assert.equal(response.status, 503);
      assert.equal(result.status, 'indisponivel');
      assert.equal(result.tempoMs, undefined);
      assert.doesNotMatch(JSON.stringify(result), /confidential settings/);
    }
  } finally {
    console.error = original;
  }
});

test('painel distingue a verificação de leitura de backup e exibe falhas no histórico', () => {
  const code = ts.transpileModule(readFileSync('src/app/configuracoes/monitoramento-glass/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const history = [
    { status: 'disponivel', verificadoEm: '2026-11-25T18:00:00.000Z', tempoMs: 42 },
    { status: 'indisponivel', verificadoEm: '2026-11-25T18:01:00.000Z' },
  ];
  const states = [history, 'Falha ao consultar o Glass.', false];
  const dependencies = {
    'react/jsx-runtime': jsxRuntime,
    react: {
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: () => [states.shift(), () => {}],
    },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/supabase-browser': { createSupabaseBrowser: () => ({}) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Missing mock ${id}`);
    return dependencies[id];
  }, module, module.exports);
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(html, /Consulta falhou/);
  assert.match(html, /42ms/);
  assert.match(html, /histórico não é salvo/);
  assert.match(html, /não confirma a existência ou restauração de backups/);
});
