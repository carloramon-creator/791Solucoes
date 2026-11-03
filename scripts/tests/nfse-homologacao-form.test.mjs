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

function load(react) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'react') return react;
    if (id === '@/lib/holding-auth-fetch') return {};
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

function harness() {
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
  });
  return () => {
    stateIndex = 0;
    return Component({ cnpj: '' });
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
