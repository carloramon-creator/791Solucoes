import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const config = {
  interClientId: 'client',
  interClientSecret: 'secret',
  interCertCrt: 'certificate',
  interCertKey: 'key',
  interAccountNumber: '123456789',
};

function loadInter(respond = () => { throw new Error('Unexpected request'); }) {
  const calls = [];
  const https = {
    request(options, callback) {
      let body = '';
      const request = new EventEmitter();
      request.write = (chunk) => { body += chunk; };
      request.destroy = (error) => request.emit('error', error);
      request.end = () => {
        queueMicrotask(() => {
          calls.push({ options, body });
          try {
            const result = respond(options, body);
            const response = new EventEmitter();
            response.statusCode = result.status ?? 200;
            callback(response);
            const responseBytes = Buffer.from(JSON.stringify(result.body));
            const split = result.splitAt ?? responseBytes.length;
            response.emit('data', responseBytes.subarray(0, split));
            response.emit('data', responseBytes.subarray(split));
            if (result.aborted) response.emit('aborted');
            else response.emit('end');
          } catch (error) {
            request.emit('error', error);
          }
        });
      };
      return request;
    },
  };
  const code = ts.transpileModule(readFileSync('src/lib/inter-statement.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'https') return https;
    if (id === '@/lib/finance-config-server') return { readFinanceConfig: async () => config };
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  return { ...mod.exports, calls };
}

function transaction(id, date = '2026-10-01', operation = 'C') {
  return {
    idTransacao: id,
    dataTransacao: date,
    tipoOperacao: operation,
    tipoTransacao: 'PIX',
    valor: '12.34',
    titulo: 'Pix',
    detalhes: { nomePagador: 'Cliente', endToEndId: `E-${id}` },
  };
}

function page(transactions, { total = transactions.length, page = 0, pages = 1 } = {}) {
  return {
    transacoes: transactions,
    totalElementos: total,
    numeroDeElementos: transactions.length,
    totalPaginas: pages,
    ultimaPagina: page + 1 >= pages,
  };
}

function authenticateOrBalance(options) {
  if (options.path === '/oauth/v2/token') {
    return { body: { access_token: 'test-token', token_type: 'Bearer', scope: 'extrato.read' } };
  }
  if (options.path === '/banking/v2/saldo') return { body: { disponivel: 0 } };
  return null;
}

test('normalizes credits and debits with stable Inter IDs and references', () => {
  const { normalizeInterTransactions } = loadInter();
  const result = normalizeInterTransactions([
    transaction('credit'),
    { ...transaction('debit', '2026-10-02', 'D'), detalhes: { nomeRecebedor: 'Fornecedor', codBarras: '123' } },
  ]);
  assert.deepEqual(result.map(({ externalId, date, amount, counterparty, referenceId }) => ({
    externalId, date, amount, counterparty, referenceId,
  })), [
    { externalId: 'credit', date: '2026-10-01', amount: 12.34, counterparty: 'Cliente', referenceId: 'E-credit' },
    { externalId: 'debit', date: '2026-10-02', amount: -12.34, counterparty: 'Fornecedor', referenceId: '123' },
  ]);
});

test('rejects missing or duplicate IDs and invalid amounts, dates or operation types', () => {
  const { normalizeInterTransactions } = loadInter();
  for (const invalid of [
    { ...transaction('id'), idTransacao: '' },
    { ...transaction('id'), dataTransacao: '2026-02-30' },
    { ...transaction('id'), tipoOperacao: 'unknown' },
    { ...transaction('id'), valor: '' },
    { ...transaction('id'), valor: '0' },
    { ...transaction('id'), valor: '12.345' },
    { ...transaction('id'), valor: 12.345 },
    { ...transaction('id'), valor: '-12.34' },
    null,
  ]) {
    assert.throws(() => normalizeInterTransactions([invalid]));
  }
  assert.throws(() => normalizeInterTransactions([transaction('same'), transaction('same')]), /repetido/);
});

test('reads all declared pages, uses the account digit and obtains balance', async () => {
  const inter = loadInter((options) => {
    const usual = authenticateOrBalance(options);
    if (usual) return usual;
    const query = new URL(options.path, 'https://inter.example').searchParams;
    const currentPage = Number(query.get('pagina'));
    return { body: page([transaction(`id-${currentPage}`)], { total: 2, page: currentPage, pages: 2 }) };
  });
  const result = await inter.fetchInterTransactions('2026-10-01', '2026-10-02', '0098765432-1');
  assert.deepEqual(result.transactions.map((item) => item.externalId), ['id-0', 'id-1']);
  assert.equal(result.balance, 0);
  const statementCalls = inter.calls.filter(({ options }) => options.path.includes('/extrato/completo'));
  assert.equal(statementCalls.length, 2);
  assert.ok(statementCalls.every(({ options }) => options.headers['x-conta-corrente'] === '987654321'));
  const balanceCall = inter.calls.find(({ options }) => options.path === '/banking/v2/saldo');
  assert.equal(balanceCall.options.headers['x-conta-corrente'], '987654321');
  assert.equal(new URL(statementCalls[1].options.path, 'https://inter.example').searchParams.get('pagina'), '1');
});

test('uses the complete configured account when no bank account is supplied', async () => {
  const inter = loadInter((options) => authenticateOrBalance(options) || { body: page([]) });
  await inter.fetchInterTransactions('2026-10-01', '2026-10-02');
  const bankCalls = inter.calls.filter(({ options }) => options.path.startsWith('/banking/v2/'));
  assert.equal(bankCalls.length, 2);
  assert.ok(bankCalls.every(({ options }) => options.headers['x-conta-corrente'] === '123456789'));
});

test('rejects malformed, inconsistent or incomplete pages instead of reporting success', async () => {
  for (const response of [
    {},
    { transacoes: [], numeroDeElementos: 1, ultimaPagina: true },
    { transacoes: [transaction('id')], totalElementos: 2, ultimaPagina: true },
    { transacoes: [transaction('id')], totalPaginas: 2, ultimaPagina: true },
    { transacoes: [], ultimaPagina: false },
  ]) {
    const inter = loadInter((options) => authenticateOrBalance(options) || { body: response });
    await assert.rejects(inter.fetchInterTransactions('2026-10-01', '2026-10-02'));
    assert.equal(inter.calls.some(({ options }) => options.path === '/banking/v2/saldo'), false);
  }
});

test('fails explicitly when the balance API or OAuth permission fails', async () => {
  const noBalance = loadInter((options) => {
    if (options.path === '/banking/v2/saldo') return { status: 403, body: {} };
    return authenticateOrBalance(options) || { body: page([]) };
  });
  await assert.rejects(noBalance.fetchInterTransactions('2026-10-01', '2026-10-02'), /403/);

  const noScope = loadInter(() => ({ body: { access_token: 'test-token', scope: 'boleto-cobranca.read' } }));
  await assert.rejects(noScope.fetchInterTransactions('2026-10-01', '2026-10-02'), /permissão/);
  assert.equal(noScope.calls.length, 1);
});

test('preserves UTF-8 across response chunks and rejects an interrupted response', async () => {
  const record = { ...transaction('accent'), titulo: 'Transferência' };
  const data = page([record]);
  const splitAt = Buffer.from(JSON.stringify(data)).indexOf(Buffer.from('ê')) + 1;
  const inter = loadInter((options) => authenticateOrBalance(options) || { body: data, splitAt });
  const result = await inter.fetchInterTransactions('2026-10-01', '2026-10-01');
  assert.equal(result.transactions[0].description, 'Transferência');

  const aborted = loadInter((options) => authenticateOrBalance(options) || { body: data, aborted: true });
  await assert.rejects(aborted.fetchInterTransactions('2026-10-01', '2026-10-01'), /interrompida/);
});

test('splits requests into windows of at most 90 days', async () => {
  const inter = loadInter((options) => authenticateOrBalance(options) || { body: page([]) });
  await inter.fetchInterTransactions('2026-01-01', '2026-04-01');
  const windows = inter.calls
    .filter(({ options }) => options.path.includes('/extrato/completo'))
    .map(({ options }) => {
      const query = new URL(options.path, 'https://inter.example').searchParams;
      return [query.get('dataInicio'), query.get('dataFim')];
    });
  assert.deepEqual(windows, [['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-04-01']]);
});

test('splits a period above the traditional 10,000-transaction limit', async () => {
  const inter = loadInter((options) => {
    const usual = authenticateOrBalance(options);
    if (usual) return usual;
    const query = new URL(options.path, 'https://inter.example').searchParams;
    const from = query.get('dataInicio');
    const to = query.get('dataFim');
    if (from !== to) return { body: { transacoes: [transaction('root')], totalElementos: 10001 } };
    return { body: page([transaction(`day-${from}`, from)]) };
  });
  const result = await inter.fetchInterTransactions('2026-10-01', '2026-10-02');
  assert.deepEqual(result.transactions.map((item) => item.externalId), ['day-2026-10-01', 'day-2026-10-02']);
  assert.equal(inter.calls.filter(({ options }) => options.path.includes('/extrato/completo')).length, 3);
});

test('uses scroll when a single day contains more than 10,000 transactions', async () => {
  const inter = loadInter((options) => {
    const usual = authenticateOrBalance(options);
    if (usual) return usual;
    const query = new URL(options.path, 'https://inter.example').searchParams;
    if (query.get('scrollEnabled') === 'true') {
      return { body: {
        transacoes: Array.from({ length: 10000 }, (_, index) => transaction(`id-${index}`)),
        totalElementos: 10001,
        hasMore: true,
        scrollId: '550e8400-e29b-41d4-a716-446655440000',
      } };
    }
    if (query.has('scrollId')) {
      return { body: { transacoes: [transaction('id-10000')], totalElementos: 10001, hasMore: false, scrollId: null } };
    }
    return { body: { transacoes: [transaction('root')], totalElementos: 10001 } };
  });
  const result = await inter.fetchInterTransactions('2026-10-01', '2026-10-01');
  assert.equal(result.transactions.length, 10001);
  assert.equal(new Set(result.transactions.map((item) => item.externalId)).size, 10001);
});

test('never treats exhausted pagination or an invalid period as a successful import', async () => {
  const inter = loadInter((options) => {
    const usual = authenticateOrBalance(options);
    if (usual) return usual;
    const currentPage = Number(new URL(options.path, 'https://inter.example').searchParams.get('pagina'));
    return { body: { transacoes: [transaction(`id-${currentPage}`)], ultimaPagina: false } };
  });
  await assert.rejects(inter.fetchInterTransactions('2026-10-01', '2026-10-01'), /limite de páginas/);
  assert.equal(inter.calls.some(({ options }) => options.path === '/banking/v2/saldo'), false);
  await assert.rejects(inter.fetchInterTransactions('2026-02-30', '2026-03-01'), /Período inválido/);
});

test('keeps Inter imports blocked until real reconciliation is validated', async (t) => {
  const previous = process.env.BANK_INTER_IMPORT_ENABLED;
  delete process.env.BANK_INTER_IMPORT_ENABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.BANK_INTER_IMPORT_ENABLED;
    else process.env.BANK_INTER_IMPORT_ENABLED = previous;
  });
  const calls = [];
  const account = {
    id: 'account', name: 'Inter', provider: 'inter', account_number: '123-4',
    sync_enabled: true, sync_start_date: '2026-10-01',
  };
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; }
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    then(resolve, reject) {
      calls.push({ table: this.table, action: this.action, value: this.value });
      let data = [];
      if (this.table === 'system_bank_accounts' && this.action === 'select') data = [account];
      if (this.table === 'system_bank_accounts' && this.action === 'update' && this.value.sync_lock_until) data = [{ id: 'account' }];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const code = ts.transpileModule(readFileSync('src/lib/bank-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const fetchCalls = [];
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/lib/supabase-server') return { supabaseServer: { from: (table) => new Query(table) } };
    if (id === '@/lib/glass-tenant-billing') return { todayBrt: () => '2026-10-30' };
    if (id === '@/lib/inter-statement') return {
      fetchInterTransactions: async (...args) => {
        fetchCalls.push(args);
        return { transactions: [{ externalId: 'id-1', amount: 12.34 }], balance: 0 };
      },
    };
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  const result = await mod.exports.syncBankAccounts();
  assert.match(result[0].skipped, /bloqueada até a validação/);
  assert.deepEqual(fetchCalls, []);
  assert.equal(calls.some(({ table }) => table === 'system_finance_records'), false);
  assert.equal(calls.some(({ table, action }) => table === 'system_bank_transactions' && action !== 'select'), false);
  assert.equal(calls.some(({ table, action }) => table === 'system_bank_accounts' && action === 'update'), false);
});

test('sends Inter transactions in bounded batches and reports review items', async (t) => {
  const previous = process.env.BANK_INTER_IMPORT_ENABLED;
  process.env.BANK_INTER_IMPORT_ENABLED = 'true';
  t.after(() => {
    if (previous === undefined) delete process.env.BANK_INTER_IMPORT_ENABLED;
    else process.env.BANK_INTER_IMPORT_ENABLED = previous;
  });
  const account = {
    id: 'account', name: 'Inter', provider: 'inter', account_number: '123-4',
    sync_enabled: true, sync_start_date: '2026-10-01',
  };
  const rule = {
    id: 'rule', pattern: 'fornecedor', record_type: 'expense', category_id: null,
    category_name: 'Compras', bank_account_id: 'account', hits: 0,
  };
  const batches = [];
  const updates = [];
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; }
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    then(resolve, reject) {
      let data = [];
      if (this.table === 'system_bank_accounts' && this.action === 'select') data = [account];
      if (this.table === 'system_bank_classification_rules') data = [rule];
      if (this.table === 'system_bank_accounts' && this.action === 'update') {
        updates.push(this.value);
        if (this.value.sync_lock_until) data = [{ id: 'account' }];
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const transactions = Array.from({ length: 201 }, (_, index) => ({
    externalId: `id-${index}`, date: '2026-10-30', amount: -10, type: 'PIX',
    description: 'Fornecedor', counterparty: null, referenceId: null, balanceAfter: null, raw: {},
  }));
  const code = ts.transpileModule(readFileSync('src/lib/bank-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/lib/supabase-server') return { supabaseServer: {
      from: (table) => new Query(table),
      rpc: async (name, args) => {
        assert.equal(name, 'bank_inter_import_batch');
        batches.push(args);
        return { data: batches.length === 1
          ? { imported: 199, pending_review: 1, auto_classified: 1, existing: 0, rule_counts: { rule: 1 } }
          : { imported: 1, pending_review: 0, auto_classified: 0, existing: 0, rule_counts: {} }, error: null };
      },
    } };
    if (id === '@/lib/glass-tenant-billing') return { todayBrt: () => '2026-10-30' };
    if (id === '@/lib/inter-statement') return {
      fetchInterTransactions: async (...args) => {
        assert.deepEqual(args, ['2026-10-01', '2026-10-30', '123-4']);
        return { transactions, balance: 42 };
      },
    };
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  const result = await mod.exports.syncBankAccounts();
  assert.equal(result[0].error, undefined);
  assert.equal(result[0].imported, 201);
  assert.equal(result[0].pendingReview, 1);
  assert.equal(result[0].autoClassified, 1);
  assert.deepEqual(batches.map((batch) => batch.p_transactions.length), [200, 1]);
  assert.equal(batches[0].p_transactions[0].rule.id, 'rule');
  assert.equal(rule.hits, 1);
  assert.ok(updates.some((value) => value.sync_lock_until === null && value.provider_balance === 42));
});

test('preserves Asaas synchronization while the Inter safety gate is active', async () => {
  const calls = [];
  const account = {
    id: 'asaas-account', name: 'Asaas', provider: 'asaas', account_number: null,
    sync_enabled: true, sync_start_date: '2026-10-01',
  };
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; }
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    gte() { return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    then(resolve, reject) {
      calls.push({ table: this.table, action: this.action, value: this.value });
      let data = [];
      if (this.table === 'system_bank_accounts' && this.action === 'select') data = [account];
      if (this.table === 'system_bank_accounts' && this.action === 'update' && this.value.sync_lock_until) data = [{ id: 'asaas-account' }];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const asaasCalls = [];
  const code = ts.transpileModule(readFileSync('src/lib/bank-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/lib/supabase-server') return { supabaseServer: { from: (table) => new Query(table) } };
    if (id === '@/lib/glass-tenant-billing') return {
      todayBrt: () => '2026-10-30',
      getAsaasClient: async () => ({
        listFinancialTransactions: async (params) => { asaasCalls.push(params); return { data: [], hasMore: false }; },
        getBalance: async () => 0,
      }),
    };
    if (id === '@/lib/inter-statement') return {
      fetchInterTransactions: () => { throw new Error('Inter must not be called'); },
    };
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  const result = await mod.exports.syncBankAccounts();
  assert.equal(result[0].error, undefined);
  assert.equal(result[0].providerBalance, 0);
  assert.deepEqual(asaasCalls, [{ startDate: '2026-10-01', finishDate: '2026-10-30', offset: 0, limit: 100 }]);
  assert.ok(calls.some(({ table, value }) =>
    table === 'system_bank_accounts' && value?.sync_lock_until === null && value?.provider_balance === 0));
});

test('preserves Asaas payment matching and creation of an unmatched expense', async () => {
  const account = {
    id: 'asaas-account', name: 'Asaas', provider: 'asaas', account_number: null,
    sync_enabled: true, sync_start_date: '2026-10-01',
  };
  const writes = [];
  let insertedBankTransactions = 0;
  class Query {
    constructor(table) { this.table = table; this.action = 'select'; }
    select(value) { this.selection = value; return this; }
    eq() { return this; }
    not() { return this; }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    gte() { return this; }
    update(value) { this.action = 'update'; this.value = value; return this; }
    insert(value) { this.action = 'insert'; this.value = value; return this; }
    upsert(value) { this.action = 'upsert'; this.value = value; return this; }
    single() { this.singleResult = true; return this; }
    then(resolve, reject) {
      let data = [];
      if (this.action !== 'select') writes.push({ table: this.table, action: this.action, value: this.value });
      if (this.table === 'system_bank_accounts' && this.action === 'select') data = [account];
      if (this.table === 'system_bank_accounts' && this.action === 'update' && this.value.sync_lock_until) data = [{ id: 'asaas-account' }];
      if (this.table === 'system_bank_transactions' && this.action === 'upsert') {
        insertedBankTransactions += 1;
        data = [{ id: `tx-${insertedBankTransactions}` }];
      }
      if (this.table === 'system_finance_records' && this.action === 'select') {
        data = [{ id: 'existing-payment', status: 'paid', bank_account_id: null, metadata: { origin: 'webhook' } }];
      }
      if (this.table === 'system_finance_records' && this.action === 'insert' && this.singleResult) data = { id: 'new-expense' };
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const code = ts.transpileModule(readFileSync('src/lib/bank-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/lib/supabase-server') return { supabaseServer: { from: (table) => new Query(table) } };
    if (id === '@/lib/glass-tenant-billing') return {
      todayBrt: () => '2026-10-30',
      getAsaasClient: async () => ({
        listFinancialTransactions: async () => ({
          data: [
            { id: 'payment-tx', date: '2026-10-29', value: 100, type: 'PAYMENT', description: 'Recebimento', paymentId: 'pay_123' },
            { id: 'expense-tx', date: '2026-10-30', value: -7, type: 'FEE', description: 'Tarifa' },
          ],
          hasMore: false,
        }),
        getBalance: async () => 93,
      }),
    };
    if (id === '@/lib/inter-statement') return { fetchInterTransactions: () => { throw new Error('Inter must not be called'); } };
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  const [result] = await mod.exports.syncBankAccounts();
  assert.equal(result.error, undefined);
  assert.equal(result.imported, 2);
  assert.equal(result.reconciled, 1);
  const linked = writes.find((write) => write.table === 'system_finance_records' && write.action === 'update');
  assert.equal(linked.value.bank_account_id, 'asaas-account');
  assert.equal(linked.value.metadata.bank_tx_id, 'tx-1');
  const created = writes.find((write) => write.table === 'system_finance_records' && write.action === 'insert');
  assert.equal(created.value.type, 'expense');
  assert.equal(created.value.value, 7);
  assert.equal(created.value.status, 'paid');
  assert.equal(created.value.category, 'A classificar');
  assert.equal(created.value.metadata.provider, 'asaas');
  assert.ok(writes.some((write) => write.table === 'system_bank_transactions' && write.value?.status === 'conciliado'));
});
