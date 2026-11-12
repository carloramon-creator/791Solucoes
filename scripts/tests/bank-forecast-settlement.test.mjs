import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadBankSync({ pendingRecords = [] } = {}) {
  class Query {
    constructor(table) { this.table = table; }
    select() { return this; }
    eq() { return this; }
    or() { return this; }
    limit() { return this; }
    then(resolve, reject) {
      return Promise.resolve({ data: pendingRecords, error: null }).then(resolve, reject);
    }
  }
  const code = ts.transpileModule(readFileSync('src/lib/bank-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/lib/supabase-server') return { supabaseServer: { from: (table) => new Query(table) } };
    if (id === '@/lib/glass-tenant-billing') return {};
    if (id === '@/lib/inter-statement') return {};
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  return mod.exports;
}

const debit = (description, counterparty = null) => ({
  externalId: 'tx', date: '2026-11-12', amount: -150, type: 'PIX',
  description, counterparty, referenceId: null, balanceAfter: null, raw: {},
});

test('casa pelo nome do favorecido contido na movimentação, sem acentos e caixa', () => {
  const { matchesForecastName } = loadBankSync();
  assert.equal(matchesForecastName('Celesc', { description: 'PIX ENVIADO - CELESC DISTRIBUICAO S.A.', counterparty: 'CELESC DISTRIBUICAO S.A.' }), true);
  assert.equal(matchesForecastName('Vidraçaria da Ju', { description: 'TED recebida', counterparty: 'VIDRACARIA DA JU LTDA' }), true);
});

test('casa quando todas as palavras relevantes da previsão aparecem na movimentação', () => {
  const { matchesForecastName } = loadBankSync();
  assert.equal(matchesForecastName('Imoveis Fulano', { description: 'PIX ENVIADO', counterparty: 'Fulano Imoveis Ltda' }), true);
});

test('não casa nomes diferentes nem descrições curtas demais', () => {
  const { matchesForecastName } = loadBankSync();
  assert.equal(matchesForecastName('Aluguel Escritorio', { description: 'PIX ENVIADO', counterparty: 'CELESC DISTRIBUICAO' }), false);
  assert.equal(matchesForecastName('ab', { description: 'ab', counterparty: null }), false);
});

test('baixa automática exige correspondência única', async () => {
  const one = loadBankSync({
    pendingRecords: [
      { id: 'a', value: 150, description: 'Celesc', status: 'pending', bank_account_id: null, metadata: {} },
    ],
  });
  const match = await one.findPendingForecast(debit('PIX ENVIADO', 'CELESC DISTRIBUICAO'), 'account');
  assert.equal(match?.id, 'a');

  const ambiguous = loadBankSync({
    pendingRecords: [
      { id: 'a', value: 150, description: 'Celesc', status: 'pending', bank_account_id: null, metadata: {} },
      { id: 'b', value: 150, description: 'Celesc Distribuicao', status: 'pending', bank_account_id: null, metadata: {} },
    ],
  });
  assert.equal(await ambiguous.findPendingForecast(debit('PIX ENVIADO', 'CELESC DISTRIBUICAO'), 'account'), null);
});

test('ignora lançamentos de cartão ou já vinculados a outra movimentação', async () => {
  const bankSync = loadBankSync({
    pendingRecords: [
      { id: 'card', value: 150, description: 'Celesc', status: 'pending', bank_account_id: null, metadata: { card_id: 'card-1' } },
      { id: 'linked', value: 150, description: 'Celesc', status: 'pending', bank_account_id: null, metadata: { bank_tx_id: 'tx-9' } },
    ],
  });
  assert.equal(await bankSync.findPendingForecast(debit('PIX ENVIADO', 'CELESC DISTRIBUICAO'), 'account'), null);
});
