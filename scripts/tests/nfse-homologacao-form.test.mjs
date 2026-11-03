import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('src/components/NfseHomologacaoNacional.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function load(react, fetch = async () => { throw new Error('Unexpected request'); }) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'react') return react;
    if (id === '@/lib/holding-auth-fetch') return { holdingAuthFetch: fetch };
    if (id === '@/components/CancelarNfseModal') return { default: () => null };
    return require(id);
  }, mod, mod.exports);
  return mod.exports.default;
}

function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}

function harness(fetch) {
  const states = [];
  let stateIndex = 0;
  const Component = load({
    useId: () => 'nfse-test',
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      }];
    },
  }, fetch);
  return () => {
    stateIndex = 0;
    return Component({ cnpj: '11222333000181' });
  };
}

test('each field has a separate block label linked only to its own input', () => {
  const tree = harness()();
  const fields = nodes(tree, node => node.type === 'div' && node.props.children?.[0]?.type === 'label');
  assert.equal(fields.length, 12);
  const ids = new Set();
  for (const field of fields) {
    const [label, input] = field.props.children;
    assert.equal(label.type, 'label');
    assert.equal(label.props.className, 'block');
    assert.equal(nodes(label, node => node.type === 'input').length, 0);
    assert.equal(input.type, 'input');
    assert.equal(label.props.htmlFor, input.props.id);
    assert.equal(input.props.id, `nfse-test-${input.props.name}`);
    assert.ok(!ids.has(input.props.id));
    ids.add(input.props.id);
  }
});

test('shows HTTP status for non-JSON Safari responses without retrying the request', async t => {
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  const render = harness(async () => {
    calls++;
    return new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  });
  const preview = nodes(render(), node => node.type === 'button' && node.props.children === 'Pré-visualizar DPS (não envia)')[0];
  await preview.props.onClick();
  const alert = nodes(render(), node => node.props?.role === 'alert')[0];
  assert.match(alert.props.children, /ler a resposta.*HTTP 502/);
  assert.match(alert.props.children, /text\/html/);
  assert.equal(calls, 1);
});

test('preserves current error while showing explicitly labeled historical results', async t => {
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  const render = harness(async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: 'Complete o endereço do cliente.' }, { status: 400 })
      : Response.json({ status: 'verificar_no_portal', dataEmissao: '2026-11-03T14:37:37-03:00' });
  });
  const fill = (name, value) => nodes(render(), node => node.type === 'input' && node.props.name === name)[0].props.onChange({ target: { value } });
  fill('municipioEmissao', '4216602'); fill('serie', '1'); fill('numero', '1');
  const button = text => nodes(render(), node => node.type === 'button' && node.props.children === text)[0];
  await button('Pré-visualizar DPS (não envia)').props.onClick();
  await button('Consultar resultado salvo').props.onClick();
  assert.match(nodes(render(), node => node.props?.role === 'alert')[0].props.children, /Complete o endereço/);
  assert.equal(nodes(render(), node => node.type === 'p' && typeof node.props.children === 'string' && node.props.children.startsWith('Resultado da última tentativa salva')).length, 1);
  assert.equal(calls, 2);
});

test('rejects malformed success shapes and reports request failures with their stage', async t => {
  t.mock.method(console, 'error', () => {});
  for (const fetch of [
    async () => Response.json({}),
    async () => Response.json([]),
    async () => { throw new Error('The string did not match the expected pattern.'); },
  ]) {
    const render = harness(fetch);
    await nodes(render(), node => node.type === 'button' && node.props.children === 'Pré-visualizar DPS (não envia)')[0].props.onClick();
    assert.equal(nodes(render(), node => node.props?.role === 'alert').length, 1);
    assert.equal(nodes(render(), node => node.type === 'pre').length, 0);
  }
});

test('input values remain independent when editing all fields', () => {
  const render = harness();
  const inputs = () => nodes(render(), node => node.type === 'input' && node.props.type !== 'checkbox');
  for (const input of inputs()) {
    input.props.onChange({ target: { value: `value-${input.props.name}` } });
  }
  for (const input of inputs()) assert.equal(input.props.value, `value-${input.props.name}`);
  const municipality = inputs().find(input => input.props.name === 'municipioPrestacao');
  municipality.props.onChange({ target: { value: '4216602' } });
  assert.equal(inputs().find(input => input.props.name === 'municipioPrestacao').props.value, '4216602');
  assert.equal(inputs().find(input => input.props.name === 'codigoTributacaoMunicipal').props.value, 'value-codigoTributacaoMunicipal');
});

test('multiple mounted forms have unique label and input IDs', () => {
  const Component = load(require('react'));
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(Component, { cnpj: '' }),
    createElement(Component, { cnpj: '' }),
  ));
  const ids = [...html.matchAll(/<input id="([^"]+)"/g)].map(match => match[1]);
  const labels = [...html.matchAll(/<label for="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, 24);
  assert.deepEqual(labels, ids);
});
