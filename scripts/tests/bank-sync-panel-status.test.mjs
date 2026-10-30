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

function renderPanel(interImportEnabled, accounts, capture = () => {}, pending = [], categories = []) {
  const states = [true, false, false, null, accounts, interImportEnabled, pending, [], [], 0, 0, {}, [], {}, null, null];
  const effects = [];
  const createdCalls = [];
  const refs = [];
  const CategoryDialogStub = () => null;
  let refIndex = 0, changed = 0;
  let index = 0;
  const hooks = {
    useState: () => {
      const position = index++;
      return [states[position], (value) => { states[position] = typeof value === 'function' ? value(states[position]) : value; }];
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => { effects.push(effect); },
    useRef: (value) => { const position = refIndex++; return refs[position] ||= { current: value }; },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'react') return hooks;
    if (id === '@/lib/holding-auth-fetch') return { holdingAuthFetch: async () => { throw new Error('Unexpected request'); } };
    if (id === '@/components/FinanceCategoryDialog') return { __esModule: true, default: CategoryDialogStub };
    return require(id);
  }, mod, mod.exports);
  const props = {
    categories, systemBalances: {}, onChanged: () => { changed++; },
    onCategoriesCreated: (created) => { createdCalls.push(created); props.categories = [...props.categories, ...created]; },
  };
  const render = () => {
    index = 0; refIndex = 0;
    const element = mod.exports.default(props);
    assert.equal(index, states.length);
    return element;
  };
  const html = renderToStaticMarkup(render());
  capture({ states, effects, render, createdCalls, CategoryDialogStub, get changed() { return changed; } });
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

test('enlarges the statement text and keeps classification controls scrollable', () => {
  const pending = [{
    id: 'item', type: 'expense', value: 10, description: 'Movimento de teste',
    date: '2026-10-30', bank_account_id: 'inter', suggested_pattern: 'Teste',
  }];
  const html = renderPanel(true, [inter], undefined, pending);
  assert.match(html, /<h2 class="text-\[calc\(1\.125rem\+2pt\)\]/);
  assert.match(html, /<h3 class="text-\[calc\(10px\+2pt\)\][^"]*">Contas<\/h3>/);
  assert.match(html, /<table class="w-full min-w-\[900px\] table-fixed text-\[calc\(0\.75rem\+2pt\)\]">/);
  assert.match(html, /<section class="overflow-x-auto"><h3[^>]*>A classificar \(1\)<\/h3>/);
  assert.match(html, /<table class="w-full min-w-\[1240px\] text-\[calc\(0\.75rem\+2pt\)\]">/);
  assert.match(html, /<select[^>]*>/);
  assert.match(html, /<button[^>]*>Salvar<\/button>/);
});

test('shows selectable classes once with indented children, without repeated parent labels', () => {
  const pending = [{
    id: 'item', type: 'expense', value: 10, description: 'Movimento de teste',
    date: '2026-10-30', suggested_pattern: 'Teste',
  }];
  const categories = [
    { id: 'cards', name: 'Cartões de Crédito', type: 'expense', parent_id: null },
    { id: 'cora', name: 'Cora', type: 'expense', parent_id: 'cards' },
    { id: 'inter', name: 'Inter', type: 'expense', parent_id: 'cards' },
    { id: 'income', name: 'Receitas', type: 'revenue', parent_id: null },
  ];
  const html = renderPanel(true, [inter], undefined, pending, categories);
  assert.match(html, /<option value="__new_category__">\+ Nova classe \/ subclasse…<\/option>/);
  assert.match(html, /<option value="cards">Cartões de Crédito<\/option>/);
  assert.match(html, /<option value="cora"[^>]*>    • Cora<\/option>/);
  assert.match(html, /<option value="inter"[^>]*>    • Inter<\/option>/);
  assert.equal((html.match(/>Cartões de Crédito<\/option>/g) || []).length, 1);
  assert.doesNotMatch(html, /<optgroup|Cartões de Crédito ›|value="income"/);
});

function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}

test('opens one popup, keeps drafts on cancel, and selects new categories without classifying', () => {
  const pending = ['first', 'second'].map((id) => ({
    id, type: 'expense', value: 10, description: id, date: '2026-10-30', suggested_pattern: id,
  }));
  const root = { id: 'root', name: 'Classe', type: 'expense', parent_id: null };
  const child = { id: 'child', name: 'Filha', type: 'expense', parent_id: root.id };
  let ui;
  renderPanel(true, [inter], (value) => { ui = value; }, pending, [root, child]);
  const originalDrafts = {
    first: { categoryId: child.id, createRule: false, pattern: 'Meu padrão' },
    second: { categoryId: root.id, createRule: true, pattern: 'Não alterar' },
  };
  ui.states[13] = structuredClone(originalDrafts);
  let select = nodes(ui.render(), (node) => node.type === 'select')[0];
  select.props.onChange({ target: { value: '__new_category__' } });
  let popups = nodes(ui.render(), (node) => node.type === ui.CategoryDialogStub);
  assert.equal(popups.length, 1);
  assert.equal(popups[0].props.type, 'expense');
  assert.equal(popups[0].props.initialParentId, root.id);
  assert.deepEqual(ui.states[13], originalDrafts);
  assert.equal(ui.states[0], true);
  assert.equal(nodes(ui.render(), (node) => node.props?.inert === true).length, 1);
  popups[0].props.onClose();
  assert.equal(ui.states[14], null);
  assert.deepEqual(ui.states[13], originalDrafts);
  select = nodes(ui.render(), (node) => node.type === 'select')[0];
  select.props.onChange({ target: { value: '__new_category__' } });
  popups = nodes(ui.render(), (node) => node.type === ui.CategoryDialogStub);
  const createdRoot = { id: 'new-root', name: 'Nova classe', type: 'expense', parent_id: null };
  const createdChild = { id: 'new-child', name: 'Nova filha', type: 'expense', parent_id: createdRoot.id };
  popups[0].props.onCreated([createdRoot, createdChild], createdChild.id);
  assert.equal(ui.states[14], null);
  assert.equal(ui.states[13].first.categoryId, createdChild.id);
  assert.equal(ui.states[13].first.createRule, false);
  assert.equal(ui.states[13].first.pattern, 'Meu padrão');
  assert.deepEqual(ui.states[13].second, originalDrafts.second);
  assert.equal(ui.changed, 0);
  assert.deepEqual(ui.createdCalls, [[createdRoot, createdChild]]);
  const html = renderToStaticMarkup(ui.render());
  assert.match(html, /<option value="new-child"[^>]*selected=""[^>]*>    • Nova filha<\/option>/);
  assert.equal(ui.states[6].length, 2);
});

test('keeps statement columns and rule text on one line in a wider modal', () => {
  const pending = [{
    id: 'item', type: 'expense', value: 10, description: 'Pix enviado - Ifoodcom Agencia De Restaurantes Online Sa',
    date: '2026-10-30', bank_account_id: 'inter', counterparty: 'Ifoodcom Agencia', suggested_pattern: 'Ifoodcom Agencia De Restaurantes Online Sa',
  }];
  const html = renderPanel(true, [{ ...inter, name: 'Banco Inter Empresas' }], undefined, pending);
  assert.match(html, /max-w-\[1480px\]/);
  assert.match(html, /<td class="pr-3 whitespace-nowrap">Banco Inter Empresas<\/td>/);
  assert.match(html, /<td class="pr-3 text-slate-700 whitespace-nowrap">Pix enviado - Ifoodcom/);
  assert.match(html, /title="Sempre que contiver: Ifoodcom Agencia De Restaurantes Online Sa"/);
  assert.match(html, /Aplicar sempre a este nome/);
  assert.doesNotMatch(html, /value="Ifoodcom Agencia De Restaurantes Online Sa"/);
  assert.doesNotMatch(html, /<span class="block text-slate-400">Ifoodcom Agencia<\/span>/);
  assert.match(html, /<select[^>]*class="h-9 w-full appearance-none/);
  assert.doesNotMatch(html, /Transferência entre contas/);
});

test('identifies transfers to or from 791 Soluções Empresariais and preselects the matching transfer class', () => {
  const pending = [
    { id: 'out', type: 'expense', value: 50, description: 'Pix enviado - 791 Solucoes Empresariais Ltda', date: '2026-10-28', counterparty: '791 Solucoes Empresariais Ltda', suggested_pattern: '791 Solucoes Empresariais Ltda' },
    { id: 'in', type: 'revenue', value: 50, description: 'Pix recebido', date: '2026-10-28', counterparty: '791 SOLUÇÕES EMPRESARIAIS', suggested_pattern: '791 SOLUÇÕES EMPRESARIAIS' },
  ];
  const categories = [{ id: 'transfer-out', name: 'Transferência entre contas', type: 'expense', parent_id: null }];
  let ui;
  const html = renderPanel(true, [inter], (value) => { ui = value; }, pending, categories);
  assert.equal((html.match(/⇄ Transferência entre contas/g) || []).length, 2);
  assert.match(html, /<option value="transfer-out" selected="">Transferência entre contas<\/option>/);
  assert.equal((html.match(/Criar classe \(receita\)/g) || []).length, 1);
  assert.doesNotMatch(html, /\(despesa\)/);
  const create = nodes(ui.render(), (node) => node.type === 'button' && node.props.type === 'button' && [].concat(node.props.children).includes('Criar classe '));
  assert.equal(create.length, 1);
  create[0].props.onClick();
  const popup = nodes(ui.render(), (node) => node.type === ui.CategoryDialogStub)[0];
  assert.equal(popup.props.type, 'revenue');
  assert.equal(popup.props.initialParentId, '');
  assert.equal(popup.props.initialName, 'Transferência entre contas');
  assert.deepEqual(ui.states[13], {});
});

test('shows the counterparty only when the description does not already contain it', () => {
  const pending = [
    { id: 'a', type: 'revenue', value: 1, description: 'Pix recebido - Tcr Group Ltda', counterparty: 'TCR GROUP LTDA', date: '2026-10-24', suggested_pattern: 'Tcr Group Ltda' },
    { id: 'b', type: 'revenue', value: 1, description: 'Pix recebido', counterparty: 'Outro Pagador', date: '2026-10-24', suggested_pattern: 'Outro Pagador' },
  ];
  const html = renderPanel(true, [inter], undefined, pending);
  assert.doesNotMatch(html, /TCR GROUP LTDA/);
  assert.match(html, /<span class="block text-slate-400">Outro Pagador<\/span>/);
});

test('edits the rule text in a popup without touching other rows', () => {
  const pending = ['first', 'second'].map((id) => ({
    id, type: 'expense', value: 10, description: `Pix enviado - ${id} Ltda`, date: '2026-10-30', suggested_pattern: `${id} Ltda`,
  }));
  let ui;
  renderPanel(true, [inter], (value) => { ui = value; }, pending);
  const edit = nodes(ui.render(), (node) => node.type === 'button' && node.props['aria-label']?.startsWith('Editar regra'));
  assert.equal(edit.length, 2);
  edit[0].props.onClick();
  assert.equal(ui.states[15].value, 'first Ltda');
  let html = renderToStaticMarkup(ui.render());
  assert.match(html, /Editar regra/);
  assert.equal(nodes(ui.render(), (node) => node.props?.inert === true).length, 1);
  let form = nodes(ui.render(), (node) => node.type === 'form')[0];
  ui.states[15] = { ...ui.states[15], value: ' x ' };
  form = nodes(ui.render(), (node) => node.type === 'form')[0];
  form.props.onSubmit({ preventDefault() {} });
  assert.match(ui.states[15].error, /pelo menos 3/);
  assert.deepEqual(ui.states[13], {});
  ui.states[15] = { ...ui.states[15], value: '  Primeira Empresa  ', error: undefined };
  form = nodes(ui.render(), (node) => node.type === 'form')[0];
  form.props.onSubmit({ preventDefault() {} });
  assert.equal(ui.states[15], null);
  assert.equal(ui.states[13].first.pattern, 'Primeira Empresa');
  assert.equal(ui.states[13].first.createRule, true);
  assert.equal(ui.states[13].second, undefined);
  html = renderToStaticMarkup(ui.render());
  assert.match(html, /title="Sempre que contiver: Primeira Empresa"/);
  assert.doesNotMatch(html, /Editar regra<\/h3>/);
});
