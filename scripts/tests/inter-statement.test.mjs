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
  interAccountNumber: '12345678',
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
  const result = await inter.fetchInterTransactions('2026-10-01', '2026-10-02', '0046411099-8');
  assert.deepEqual(result.transactions.map((item) => item.externalId), ['id-0', 'id-1']);
  assert.equal(result.balance, 0);
  const statementCalls = inter.calls.filter(({ options }) => options.path.includes('/extrato/completo'));
  assert.equal(statementCalls.length, 2);
  assert.equal(statementCalls[0].options.headers['x-conta-corrente'], '464110998');
  assert.equal(new URL(statementCalls[1].options.path, 'https://inter.example').searchParams.get('pagina'), '1');
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

test('keeps Inter imports blocked until existing ledger reconciliation is validated', async () => {
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
  assert.match(result[0].error, /Conciliação do Inter ainda não implementada e validada/);
  assert.deepEqual(fetchCalls, [['2026-10-01', '2026-10-30', '123-4']]);
  assert.equal(calls.some(({ table }) => table === 'system_finance_records'), false);
  assert.equal(calls.some(({ table, action }) => table === 'system_bank_transactions' && action !== 'select'), false);
  assert.ok(calls.some(({ table, value }) =>
    table === 'system_bank_accounts' && value?.sync_lock_until === null && value?.last_sync_error));
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
