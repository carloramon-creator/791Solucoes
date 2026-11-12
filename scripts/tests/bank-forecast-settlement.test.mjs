import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadBankSync({ pendingRecords = [], reviews = [], rpcResults = {} } = {}) {
  const rpcCalls = [];
  class Query {
    constructor(table) { this.table = table; }
    select() { return this; }
    eq() { return this; }
    or() { return this; }
    limit() { return this; }
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    }
    then(resolve, reject) {
      const data = this.table === 'system_bank_transactions' ? reviews : pendingRecords;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const code = ts.transpileModule(readFileSync('src/lib/bank-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/lib/supabase-server') return {
      supabaseServer: {
        from: (table) => new Query(table),
        rpc: (name, args) => {
          rpcCalls.push({ name, args });
          const result = rpcResults[name];
          return Promise.resolve(result || { data: null, error: null });
        },
      },
    };
    if (id === '@/lib/glass-tenant-billing') return {};
    if (id === '@/lib/inter-statement') return {};
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  return { ...mod.exports, rpcCalls };
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

const interReview = {
  id: 'tx-1', tx_date: '2026-11-12', amount: -150, tx_type: 'PIX',
  description: 'PIX ENVIADO', counterparty: 'CELESC DISTRIBUICAO', reference_id: null,
};

test('Inter: vincula e baixa a previsão única pelas funções do banco', async () => {
  const bankSync = loadBankSync({
    pendingRecords: [
      { id: 'forecast', value: 150, description: 'Celesc', status: 'pending', bank_account_id: null, metadata: {} },
    ],
    reviews: [interReview],
    rpcResults: {
      bank_inter_resolve_review: { data: { action: 'link', auto_classified: false }, error: null },
      bank_inter_settle_record: { data: { settledRecord: {} }, error: null },
    },
  });
  const result = { reconciled: 0, pendingSettlement: 0, pendingReview: 1 };
  await bankSync.autoSettleInterForecasts({ id: 'account' }, result);
  assert.deepEqual(bankSync.rpcCalls.map((call) => call.name), ['bank_inter_resolve_review', 'bank_inter_settle_record']);
  assert.equal(bankSync.rpcCalls[0].args.p_action, 'link');
  assert.equal(bankSync.rpcCalls[0].args.p_record_id, 'forecast');
  assert.equal(bankSync.rpcCalls[1].args.p_paid_amount, 150);
  assert.deepEqual(result, { reconciled: 1, pendingSettlement: 0, pendingReview: 0 });
});

test('Inter: sem correspondência de nome, a movimentação permanece na revisão manual', async () => {
  const bankSync = loadBankSync({
    pendingRecords: [
      { id: 'forecast', value: 150, description: 'Aluguel Escritorio', status: 'pending', bank_account_id: null, metadata: {} },
    ],
    reviews: [interReview],
  });
  const result = { reconciled: 0, pendingSettlement: 0, pendingReview: 1 };
  await bankSync.autoSettleInterForecasts({ id: 'account' }, result);
  assert.deepEqual(bankSync.rpcCalls, []);
  assert.deepEqual(result, { reconciled: 0, pendingSettlement: 0, pendingReview: 1 });
});

test('Inter: conflito no vínculo mantém a revisão e não tenta a baixa', async () => {
  const bankSync = loadBankSync({
    pendingRecords: [
      { id: 'forecast', value: 150, description: 'Celesc', status: 'pending', bank_account_id: null, metadata: {} },
    ],
    reviews: [interReview],
    rpcResults: {
      bank_inter_resolve_review: { data: null, error: { code: 'P0001', message: 'O lançamento não corresponde mais à movimentação.' } },
    },
  });
  const result = { reconciled: 0, pendingSettlement: 0, pendingReview: 1 };
  await bankSync.autoSettleInterForecasts({ id: 'account' }, result);
  assert.deepEqual(bankSync.rpcCalls.map((call) => call.name), ['bank_inter_resolve_review']);
  assert.deepEqual(result, { reconciled: 0, pendingSettlement: 0, pendingReview: 1 });
});
