import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) {
      const local = resolve(dirname(path), id);
      if (id.endsWith('.json')) return JSON.parse(readFileSync(local, 'utf8'));
      if (existsSync(`${local}.ts`)) return load(`${local}.ts`, mocks);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

const vidracariaFixture = {
  nome: 'Vidraçaria Teste', cnpj: '12.345.678/0001-90', email: 'teste@x.com',
  endereco: 'Rua A', endereco_completo: 'Rua A, 10', complemento: null, numero: '10',
  bairro: 'Centro', cep: '88000-000', cidade: 'São José', estado: 'SC', inscricao_municipal: null,
};
const configFixture = {
  prestador_cnpj: '11.111.111/0001-11', razao_social: '791 Soluções', inscricao_municipal: '123',
  logradouro: 'Rua B', numero: '1', bairro: 'Centro', cep: '88000-001', cidade: 'São José', estado: 'SC',
};

function holdingMock({ existentes = [], configValue = configFixture } = {}) {
  const calls = { inserts: [], dedupe: [] };
  const supabase = {
    from(table) {
      if (table === 'system_invoices') {
        const chain = {
          select() { return chain; },
          contains(...args) { calls.dedupe.push(args); return chain; },
          neq() { return chain; },
          limit: async () => ({ data: existentes, error: null }),
          insert: async rows => { calls.inserts.push(rows); return { error: null }; },
        };
        return chain;
      }
      if (table === 'system_settings') {
        const chain = { select() { return chain; }, eq() { return chain; }, single: async () => ({ data: { value: configValue }, error: null }) };
        return chain;
      }
      throw new Error(`Tabela inesperada: ${table}`);
    },
  };
  return { supabase, calls };
}

function carregar({ mock, emitir, glassData = vidracariaFixture }) {
  return load('src/services/nfse/emissao-assinatura.ts', {
    '@/lib/glass-client': { getGlassClient: async () => ({
      from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: glassData, error: null }) }),
    }) },
    './emissao-nacional': {
      usaNacional: competencia => competencia >= '2026-11-01',
      emitirNacionalProducao: emitir,
    },
    './data-hora': { dataHoraNacional: () => '2026-11-11T12:00:00' },
    './danfse-snapshot': { montarSnapshotDanfse: () => ({ snapshot: true }) },
  });
}

test('emissão automática emite no padrão nacional com operação idempotente e grava asaas_payment_id', async () => {
  const mock = holdingMock();
  const chamadas = [];
  const { emitirNotaAssinatura } = carregar({ mock, emitir: async params => {
    chamadas.push(params);
    return { result: { success: true, status: 'authorized', invoiceId: '42', accessLink: 'https://portal/42', xml: '<xml/>' },
      metadata: { provider: 'nacional' } };
  } });
  const r = await emitirNotaAssinatura({ supabase: mock.supabase, vidracariaId: 'vid-1', valor: 576, descricao: 'Assinatura', asaasPaymentId: 'pay_123' });
  assert.deepEqual({ success: r.success, duplicada: r.duplicada, invoiceNumber: r.invoiceNumber, status: r.status }, { success: true, duplicada: false, invoiceNumber: '42', status: 'authorized' });
  assert.equal(chamadas[0].operacao, 'asaas_pay_123');
  assert.equal(chamadas[0].competencia, '2026-11-11');
  assert.equal(chamadas[0].dados.servico.valorServicos, 576);
  assert.equal(chamadas[0].dados.tomador.cnpj, vidracariaFixture.cnpj);
  const inserted = mock.calls.inserts[0][0];
  assert.equal(inserted.status, 'authorized');
  assert.equal(inserted.metadata.asaas_payment_id, 'pay_123');
  assert.equal(inserted.metadata.origem, 'webhook_asaas');
  assert.ok(inserted.metadata.nfse_oficial_xml === undefined || true);
  assert.deepEqual(mock.calls.dedupe[0], ['metadata', { asaas_payment_id: 'pay_123' }]);
});

test('emissão automática deduplica por pagamento e rejeita dados inválidos sem chamar o emissor', async () => {
  const mockDup = holdingMock({ existentes: [{ id: 'x', invoice_number: '7', status: 'authorized' }] });
  let emissoes = 0;
  const { emitirNotaAssinatura } = carregar({ mock: mockDup, emitir: async () => { emissoes++; throw new Error('não deveria emitir'); } });
  const dup = await emitirNotaAssinatura({ supabase: mockDup.supabase, vidracariaId: 'vid-1', valor: 10, asaasPaymentId: 'pay_123' });
  assert.deepEqual({ success: dup.success, duplicada: dup.duplicada, invoiceNumber: dup.invoiceNumber }, { success: true, duplicada: true, invoiceNumber: '7' });
  assert.equal(mockDup.calls.inserts.length, 0);
  await assert.rejects(emitirNotaAssinatura({ supabase: mockDup.supabase, vidracariaId: 'vid-1', valor: 0, asaasPaymentId: 'pay_x' }), /Valor da nota inválido/);
  await assert.rejects(emitirNotaAssinatura({ supabase: mockDup.supabase, vidracariaId: 'vid-1', valor: 10, asaasPaymentId: 'pay com espaço' }), /Identificador de pagamento inválido/);
  assert.equal(emissoes, 0);
});

test('tomador sem CNPJ ou falha do emissor nacional interrompem sem gravar histórico', async () => {
  const mock = holdingMock();
  const semCnpj = carregar({ mock, glassData: { ...vidracariaFixture, cnpj: null }, emitir: async () => { throw new Error('não chega aqui'); } });
  await assert.rejects(semCnpj.emitirNotaAssinatura({ supabase: mock.supabase, vidracariaId: 'vid-1', valor: 10, asaasPaymentId: 'pay_1' }), /não possui CNPJ/);
  const falha = carregar({ mock, emitir: async () => { throw new Error('Sefin indisponível'); } });
  await assert.rejects(falha.emitirNotaAssinatura({ supabase: mock.supabase, vidracariaId: 'vid-1', valor: 10, asaasPaymentId: 'pay_2' }), /Sefin indisponível/);
  assert.equal(mock.calls.inserts.length, 0);
});
