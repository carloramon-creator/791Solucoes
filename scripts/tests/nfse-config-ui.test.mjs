import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function component(path, seeds, mocks = {}) {
  let index = 0;
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'react') return { useEffect() {}, useId: () => 'fiscal', useState(initial) { const i = index++; return [i in seeds ? seeds[i] : initial, () => {}]; } };
    if (id in mocks) return mocks[id];
    if (id === '@/lib/holding-auth-fetch') return { holdingAuthFetch: () => { throw new Error('Unexpected request'); } };
    if (id === '@/services/nfse/simples-nacional') return { mesesAnteriores: () => ['2026-10'] };
    return require(id);
  }, mod, mod.exports);
  return mod.exports.default();
}
const config = {
  enabled: true, enquadramentoConfirmado: true, serie: '1', municipioEmissao: '4216602',
  codigoTributacaoNacional: '010501', codigoNbs: '111032200',
  historico: { inicioAtividade: '2024-01-01', folhaCategoriaId: 'folha', semFolha: false, semReceitasExternas: true, folha: {}, receitasExternas: {}, historicoConfirmadoAte: '2026-10' },
};
test('payroll selector matches date field height, border and spacing; automatic mode hides manual declaration', () => {
  const tree = component('src/components/NfseProducaoNacional.tsx', [config, null, '2026-11']);
  const input = nodes(tree, n => n.props?.id === 'fiscal-inicio')[0];
  const select = nodes(tree, n => n.props?.id === 'fiscal-classe-folha')[0];
  for (const token of ['h-11', 'rounded-lg', 'border', 'border-slate-200', 'bg-slate-50', 'px-3', 'text-sm']) {
    assert.ok(input.props.className.split(' ').includes(token));
    assert.ok(select.props.className.split(' ').includes(token));
  }
  assert.equal(nodes(tree, n => n.props?.id === 'fiscal-folha').length, 0);
  const advanced = nodes(tree, n => n.type === 'details')[0];
  assert.ok(!advanced.props.open);
  assert.equal(nodes(advanced, n => n.props?.id === 'fiscal-enquadramento').length, 1);
});
test('manual payroll remains accessible; IPM and homologation are collapsed and company CNPJ stays outside legacy', () => {
  const manual = { ...config, historico: { ...config.historico, folhaCategoriaId: undefined } };
  assert.equal(nodes(component('src/components/NfseProducaoNacional.tsx', [manual, null, '2026-11']), n => n.props?.id === 'fiscal-folha').length, 1);
  const Homologacao = () => null;
  const tree = component('src/app/configuracoes/nfs/page.tsx', [false], {
    '@/components/ConfigTabs': { ConfigTabs: () => null },
    '@/components/NfseProducaoNacional': { __esModule: true, default: () => null },
    '@/components/NfseHomologacaoNacional': { __esModule: true, default: Homologacao },
  });
  const details = nodes(tree, n => n.type === 'details');
  assert.equal(details.length, 2);
  assert.ok(details.every(n => !n.props.open));
  assert.equal(nodes(details[0], n => n.type === 'input' && n.props.value === '').length > 0, true);
  assert.equal(nodes(details[0], n => n.props?.id === 'nfse-prestador-cnpj').length, 0);
  assert.equal(nodes(tree, n => n.props?.id === 'nfse-prestador-cnpj').length, 1);
  assert.equal(nodes(tree, n => n.type === Homologacao).length, 0);
});
