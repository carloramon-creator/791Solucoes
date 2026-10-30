import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('src/components/FinanceCategoryDialog.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const expenseRoot = { id: 'expense', name: 'Despesas', type: 'expense', parent_id: null };
const revenueRoot = { id: 'revenue', name: 'Receitas', type: 'revenue', parent_id: null };

function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}

function harness({ type = 'expense', initialParentId = '', request = async (payload) => ({
  id: 'new', ...payload,
}), categories = [expenseRoot, revenueRoot] } = {}) {
  const states = [], refs = [], calls = [], created = [];
  let stateIndex = 0, refIndex = 0, closed = 0;
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useEffect() {},
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'react') return hooks;
    if (id === '@/lib/holding-auth-fetch') return {
      holdingAuthFetch: async (url, init) => {
        assert.equal(url, '/api/system/categories');
        assert.equal(init.method, 'POST');
        const payload = JSON.parse(init.body);
        calls.push(payload);
        const result = await request(payload);
        return result instanceof Response ? result : Response.json(result);
      },
    };
    return require(id);
  }, mod, mod.exports);
  const render = () => {
    stateIndex = 0; refIndex = 0;
    return mod.exports.default({
      type, initialParentId, categories, onClose: () => { closed++; },
      onCreated: (...args) => { created.push(args); },
    });
  };
  const inputs = () => nodes(render(), (node) => node.type === 'input');
  const fillName = (value) => inputs()[0].props.onChange({ target: { value } });
  const fillChild = (value) => inputs()[1].props.onChange({ target: { value } });
  const submit = () => nodes(render(), (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  const button = (text) => nodes(render(), (node) => node.type === 'button' && node.props.children === text)[0];
  return { render, inputs, fillName, fillChild, submit, button, calls, created, states, get closed() { return closed; } };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

for (const type of ['expense', 'revenue']) {
  test(`creates and selects a ${type} class without enabling webhooks`, async () => {
    const ui = harness({ type });
    ui.fillName('  Nova classe  ');
    ui.submit();
    await settle();
    assert.deepEqual(ui.calls, [{ name: 'Nova classe', type, parent_id: null, use_webhook: false }]);
    assert.equal(ui.created.length, 1);
    assert.equal(ui.created[0][1], 'new');
    assert.equal(ui.created[0][0][0].name, 'Nova classe');
  });

  test(`creates a ${type} child with its existing parent preselected`, async () => {
    const root = type === 'expense' ? expenseRoot : revenueRoot;
    const ui = harness({ type, initialParentId: root.id });
    const select = nodes(ui.render(), (node) => node.type === 'select')[0];
    assert.equal(select.props.value, root.id);
    const options = nodes(select, (node) => node.type === 'option');
    assert.deepEqual(options.map((node) => node.props.value), ['', root.id]);
    ui.fillName('Filha');
    ui.submit();
    await settle();
    assert.equal(ui.calls[0].parent_id, root.id);
    assert.equal(ui.created[0][1], 'new');
  });

  test(`creates a ${type} class and child together and selects the child`, async () => {
    const ui = harness({
      type, request: async (payload) => ({ categories: [
        { id: 'child', name: payload.subcategory_name, type, parent_id: 'root' },
        { id: 'root', name: payload.name, type, parent_id: null },
      ] }),
    });
    ui.fillName('Classe'); ui.fillChild('Filha');
    ui.submit();
    await settle();
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].subcategory_name, 'Filha');
    assert.equal(ui.created[0][0].length, 2);
    assert.equal(ui.created[0][1], 'child');
  });
}

test('validates blank names and missing or wrong-type parents before sending', async () => {
  const ui = harness();
  ui.fillName('  ');
  ui.submit();
  assert.equal(nodes(ui.render(), (node) => node.props?.role === 'alert').length, 1);
  ui.fillName('Filha');
  ui.button('Nova subclasse').props.onClick();
  ui.submit();
  assert.equal(ui.calls.length, 0);
  const wrongParent = harness({ initialParentId: revenueRoot.id });
  wrongParent.fillName('Filha');
  wrongParent.submit();
  assert.equal(wrongParent.calls.length, 0);
});

test('retains form values on failures, displays errors, and allows cancellation', async () => {
  for (const request of [
    async () => Response.json({ error: 'Nome indisponível.' }, { status: 400 }),
    async () => { throw new Error('Rede indisponível.'); },
    async () => Response.json({ id: 'broken' }),
    async () => ({ id: 'wrong', name: 'Classe', type: 'revenue', parent_id: null }),
    async () => ({ categories: [{ id: 'root', name: 'Classe', type: 'expense', parent_id: null }] }),
  ]) {
    const ui = harness({ request });
    ui.fillName('Classe'); ui.fillChild('Filha');
    ui.submit();
    await settle();
    assert.equal(ui.created.length, 0);
    assert.equal(ui.inputs()[0].props.value, 'Classe');
    assert.equal(ui.inputs()[1].props.value, 'Filha');
    assert.equal(ui.inputs()[0].props.disabled, false);
    assert.equal(nodes(ui.render(), (node) => node.props?.role === 'alert').length, 1);
    ui.button('Cancelar').props.onClick();
    assert.equal(ui.closed, 1);
  }
});

test('prevents simultaneous submissions and closing with Escape while saving', async () => {
  let finish;
  const ui = harness({ request: (payload) => new Promise((resolve) => {
    finish = () => resolve({ id: 'new', ...payload });
  }) });
  ui.fillName('Classe');
  ui.submit(); ui.submit();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.button('Cancelar').props.disabled, true);
  ui.render().props.onKeyDown({ key: 'Escape', stopPropagation() {} });
  assert.equal(ui.closed, 0);
  finish();
  await settle();
  assert.equal(ui.created.length, 1);
});

test('cancels without any request, and can create a class and child when no roots exist', async () => {
  const ui = harness({ categories: [] });
  ui.fillName('Não salvar');
  ui.render().props.onKeyDown({ key: 'Escape', stopPropagation() {} });
  assert.equal(ui.closed, 1);
  assert.equal(ui.calls.length, 0);
  ui.button('Nova subclasse').props.onClick();
  ui.submit();
  assert.equal(ui.calls.length, 0);
  ui.button('Nova classe').props.onClick();
  assert.equal(ui.inputs().length, 2);
});
