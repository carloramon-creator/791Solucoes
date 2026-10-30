import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadBankSync({ provider, updateError = null }) {
  const writes = [];
  const record = {
    id: 'record', type: 'expense', description: 'Teste', bank_account_id: 'account',
    metadata: { provider, bank_tx_id: 'bank-transaction', needs_classification: true },
  };
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; }
    select() { return this; }
    eq() { return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    async single() { return { data: record, error: null }; }
    then(resolve, reject) {
      if (this.action === 'update') {
        writes.push({ table: this.table, value: this.value });
        return Promise.resolve({ data: null, error: updateError }).then(resolve, reject);
      }
      const data = this.table === 'system_finance_categories'
        ? [{ id: 'category', name: 'Compras', type: 'expense', parent_id: null }]
        : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
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
  return { classify: mod.exports.classifyImportedRecord, writes };
}

test('lets the Inter trigger atomically maintain the linked transaction status', async () => {
  const bankSync = loadBankSync({ provider: 'inter' });
  assert.deepEqual(await bankSync.classify({ recordId: 'record', categoryId: 'category' }), { similarApplied: 0 });
  assert.deepEqual(bankSync.writes.map((write) => write.table), ['system_finance_records']);
  assert.equal(bankSync.writes[0].value.metadata.needs_classification, false);
});

test('preserves the existing status update for Asaas', async () => {
  const bankSync = loadBankSync({ provider: 'asaas' });
  await bankSync.classify({ recordId: 'record', categoryId: 'category' });
  assert.deepEqual(bankSync.writes.map((write) => write.table), [
    'system_finance_records', 'system_bank_transactions',
  ]);
  assert.equal(bankSync.writes[1].value.status, 'classificado');
});

test('reports a classification write failure before updating the transaction', async () => {
  const bankSync = loadBankSync({ provider: 'inter', updateError: { message: 'Banco indisponível.' } });
  await assert.rejects(bankSync.classify({ recordId: 'record', categoryId: 'category' }), /Banco indisponível/);
  assert.deepEqual(bankSync.writes.map((write) => write.table), ['system_finance_records']);
});
