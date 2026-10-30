import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync('src/components/BankImportPanel.tsx', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

function renderPanel(interImportEnabled, accounts, capture = () => {}) {
  const states = [true, false, false, null, accounts, interImportEnabled, [], [], [], 0, 0, {}, [], {}];
  const effects = [];
  let index = 0;
  const hooks = {
    useState: () => {
      const position = index++;
      return [states[position], (value) => { states[position] = value; }];
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => { effects.push(effect); },
    useRef: (value) => ({ current: value }),
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'react') return hooks;
    if (id === '@/lib/holding-auth-fetch') return { holdingAuthFetch: async () => { throw new Error('Unexpected request'); } };
    return require(id);
  }, mod, mod.exports);
  const html = renderToStaticMarkup(mod.exports.default({ categories: [], systemBalances: {}, onChanged: () => {} }));
  assert.equal(index, states.length);
  capture({ states, effects });
  return html;
}

const lastSync = '2026-10-30T14:00:00-03:00';
const formattedLastSync = new Date(lastSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const inter = { id: 'inter', name: 'Inter', provider: 'inter', sync_enabled: true, last_sync_at: lastSync, provider_balance: 10 };
const asaas = { id: 'asaas', name: 'Asaas', provider: 'asaas', sync_enabled: true, last_sync_at: lastSync };

test('shows a blocked Inter and its last sync while preserving Asaas status', () => {
  const html = renderPanel(false, [inter, asaas]);
  assert.match(html, /Bloqueado/);
  assert.match(html, /Importação do Inter bloqueada no servidor/);
  assert.ok(html.includes(`Última: ${formattedLastSync}`));
  assert.match(html, /Asaas ativo/);
});

test('does not claim Inter is active when the server state is unavailable', () => {
  const html = renderPanel(null, [inter]);
  assert.match(html, /Estado desconhecido/);
  assert.match(html, /Não foi possível confirmar a liberação do Inter no servidor/);
  assert.ok(html.includes(`Última: ${formattedLastSync}`));
  assert.doesNotMatch(html, /Inter ativo/);
});

test('requires both the account and server gate to show Inter as active', () => {
  assert.match(renderPanel(true, [inter]), /Inter ativo/);
  const html = renderPanel(true, [{ ...inter, sync_enabled: false }]);
  assert.match(html, /Não habilitado/);
  assert.match(html, /Sincronização do Inter não habilitada para esta conta/);
  assert.ok(html.includes(`Última: ${formattedLastSync}`));
});

test('marks the Inter server state unknown when a refresh fails', async () => {
  let context;
  renderPanel(true, [inter], (value) => { context = value; });
  context.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.states[5], null);
  assert.match(context.states[3], /Unexpected request/);
});
