import https from 'https';
import { readFinanceConfig } from '@/lib/finance-config-server';

const INTER_HOST = 'cdpj.partners.bancointer.com.br';
const MAX_WINDOW_DAYS = 90;
const MAX_TRADITIONAL_TRANSACTIONS = 10000;
const PAGE_SIZE = MAX_TRADITIONAL_TRANSACTIONS;
const MAX_PAGES = 50;

export type InterStatementTx = {
  externalId: string;
  date: string;
  amount: number;
  type: string;
  description: string;
  counterparty: string | null;
  referenceId: string | null;
  balanceAfter: number | null;
  raw: unknown;
};

type InterCreds = { clientId: string; clientSecret: string; cert: string; key: string; account: string };

function normalizePem(pem: string) {
  return String(pem || '').trim().replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

async function loadCreds(accountNumber?: string | null): Promise<InterCreds> {
  const cfg = await readFinanceConfig();
  const creds = {
    clientId: String(cfg.interClientId || '').trim(),
    clientSecret: String(cfg.interClientSecret || '').trim(),
    cert: normalizePem(cfg.interCertCrt),
    key: normalizePem(cfg.interCertKey),
    account: String(accountNumber || cfg.interAccountNumber || '').replace(/\D/g, '').replace(/^0+(?=\d)/, ''),
  };
  if (!creds.clientId || !creds.clientSecret || !creds.cert || !creds.key) {
    throw new Error('Credenciais do Inter (client id/secret e certificado) não configuradas.');
  }
  return creds;
}

function request(creds: InterCreds, method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.request({
      hostname: INTER_HOST, port: 443, path, method, headers,
      cert: creds.cert, key: creds.key, family: 4, timeout: 30000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('aborted', () => reject(new Error('A resposta do Inter foi interrompida.')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao consultar o Inter.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function interError(status: number) {
  if (status === 401 || status === 403) {
    return new Error(`Inter recusou o acesso (${status}). Confira a integração, a conta e as permissões no Internet Banking PJ.`);
  }
  return new Error(`Inter recusou a consulta (HTTP ${status}).`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResponse(body: string, context: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(`Inter retornou uma resposta inválida para ${context}.`);
  }
  if (!isObject(value)) throw new Error(`Inter retornou uma resposta inválida para ${context}.`);
  return value;
}

async function getToken(creds: InterCreds) {
  const form = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'extrato.read',
    grant_type: 'client_credentials',
  }).toString();
  const res = await request(creds, 'POST', '/oauth/v2/token', {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': String(Buffer.byteLength(form)),
  }, form);
  if (res.status !== 200) throw interError(res.status);
  const data = parseResponse(res.body, 'autenticação');
  if (typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new Error('Inter não devolveu o token de acesso.');
  }
  if (typeof data.scope === 'string' && !data.scope.split(/\s+/).includes('extrato.read')) {
    throw new Error('O token do Inter não possui permissão para consultar o extrato.');
  }
  return data.access_token;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function pickName(detalhes: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = detalhes[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return null;
}

/** Converte as transações do extrato enriquecido do Inter para o formato do bank-sync. */
export function normalizeInterTransactions(items: unknown[]): InterStatementTx[] {
  const seen = new Set<string>();
  const out: InterStatementTx[] = [];
  for (const t of items) {
    if (!isObject(t)) throw new Error('Inter retornou uma transação inválida.');
    const externalId = typeof t.idTransacao === 'string' ? t.idTransacao.trim() : '';
    if (!externalId) throw new Error('Inter retornou uma transação sem identificador. Importação interrompida para evitar duplicidades.');
    if (seen.has(externalId)) throw new Error('Inter retornou um identificador de transação repetido. Importação interrompida.');
    seen.add(externalId);

    const rawDate = typeof t.dataTransacao === 'string' && t.dataTransacao.trim()
      ? t.dataTransacao
      : typeof t.dataInclusao === 'string' ? t.dataInclusao : '';
    const date = rawDate.slice(0, 10);
    if (!validDate(date)) throw new Error('Inter retornou uma transação com data inválida.');

    const operation = typeof t.tipoOperacao === 'string' ? t.tipoOperacao.trim().toUpperCase() : '';
    if (operation !== 'C' && operation !== 'D') {
      throw new Error('Inter retornou uma transação sem indicação válida de crédito ou débito.');
    }
    const rawValue = t.valor;
    if ((typeof rawValue !== 'string' && typeof rawValue !== 'number') ||
        (typeof rawValue === 'string' && !/^-?\d+(?:\.\d{1,2})?$/.test(rawValue.trim()))) {
      throw new Error('Inter retornou uma transação com valor inválido.');
    }
    const numericValue = Number(rawValue);
    const cents = Math.round(Math.abs(numericValue) * 100);
    if (!Number.isFinite(numericValue) || cents === 0 || cents > 99999999999999 ||
        Math.abs(Math.abs(numericValue) * 100 - cents) > 0.000001 ||
        (operation === 'C' && numericValue < 0)) {
      throw new Error('Inter retornou uma transação com valor inválido.');
    }
    const value = cents / 100;

    const isDebit = operation === 'D';
    const detalhes = isObject(t.detalhes) ? t.detalhes : {};
    const titulo = typeof t.titulo === 'string' ? t.titulo.trim() : '';
    const descricao = typeof t.descricao === 'string' ? t.descricao.trim() : '';
    const type = typeof t.tipoTransacao === 'string' && t.tipoTransacao.trim()
      ? t.tipoTransacao.trim()
      : isDebit ? 'DEBITO' : 'CREDITO';
    const description = [titulo, descricao && descricao !== titulo ? descricao : ''].filter(Boolean).join(' - ') || type;
    const counterparty = isDebit
      ? pickName(detalhes, ['nomeRecebedor', 'nomeFavorecido', 'nomeBeneficiario', 'nomeEmpresa', 'nomePagador'])
      : pickName(detalhes, ['nomePagador', 'nomeRemetente', 'nomeEmpresa', 'nomeRecebedor']);
    const reference = pickName(detalhes, ['endToEndId', 'codigoSolicitacao', 'nossoNumero', 'codBarras', 'txId']);

    out.push({
      externalId,
      date,
      amount: isDebit ? -value : value,
      type,
      description,
      counterparty,
      referenceId: reference,
      balanceAfter: null,
      raw: t,
    });
  }
  return out;
}

function optionalCount(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Inter retornou paginação inválida (${key}).`);
  }
  return value;
}

async function statementPage(
  creds: InterCreds, headers: Record<string, string>, params: URLSearchParams,
) {
  const res = await request(creds, 'GET', `/banking/v2/extrato/completo?${params}`, headers);
  if (res.status !== 200) throw interError(res.status);
  const data = parseResponse(res.body, 'extrato');
  if (!Array.isArray(data.transacoes)) throw new Error('Inter retornou um extrato sem a lista de transações.');
  const count = optionalCount(data, 'numeroDeElementos');
  if (count !== null && count !== data.transacoes.length) {
    throw new Error('Inter retornou uma quantidade inconsistente de transações.');
  }
  return data;
}

async function fetchScrollWindow(creds: InterCreds, headers: Record<string, string>, from: string, to: string) {
  const items: unknown[] = [];
  let scrollId: string | null = null;
  let expectedTotal: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ dataInicio: from, dataFim: to, tamanhoPagina: String(MAX_TRADITIONAL_TRANSACTIONS) });
    if (scrollId) qs.set('scrollId', scrollId); else qs.set('scrollEnabled', 'true');
    const data = await statementPage(creds, headers, qs);
    const list = data.transacoes as unknown[];
    const total = optionalCount(data, 'totalElementos');
    if (expectedTotal !== null && total !== null && total !== expectedTotal) {
      throw new Error('O total do extrato do Inter mudou durante a consulta. Tente sincronizar novamente.');
    }
    if (total !== null) expectedTotal = total;
    if (typeof data.hasMore !== 'boolean') throw new Error('Inter retornou paginação de extrato inválida.');
    for (const item of list) items.push(item);
    if (!data.hasMore) {
      if (expectedTotal !== null && items.length !== expectedTotal) {
        throw new Error('Inter retornou um extrato incompleto. Tente sincronizar novamente.');
      }
      return items;
    }
    if (!list.length || typeof data.scrollId !== 'string' || !data.scrollId.trim()) {
      throw new Error('Inter não informou a próxima página do extrato.');
    }
    scrollId = data.scrollId;
  }
  throw new Error('O extrato do Inter excedeu o limite de páginas; nenhuma movimentação foi importada.');
}

async function fetchWindow(creds: InterCreds, headers: Record<string, string>, from: string, to: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let expectedTotal: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ dataInicio: from, dataFim: to, pagina: String(page), tamanhoPagina: String(PAGE_SIZE) });
    const data = await statementPage(creds, headers, qs);
    const list = data.transacoes as unknown[];
    const total = optionalCount(data, 'totalElementos');
    if (total !== null && total > MAX_TRADITIONAL_TRANSACTIONS) {
      if (from === to) return fetchScrollWindow(creds, headers, from, to);
      const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
      const middle = addDays(from, Math.floor(days / 2));
      const before = await fetchWindow(creds, headers, from, middle);
      const after = await fetchWindow(creds, headers, addDays(middle, 1), to);
      return [...before, ...after];
    }
    if (expectedTotal !== null && total !== null && total !== expectedTotal) {
      throw new Error('O total do extrato do Inter mudou durante a consulta. Tente sincronizar novamente.');
    }
    if (total !== null) expectedTotal = total;
    const totalPages = optionalCount(data, 'totalPaginas');
    if (data.ultimaPagina !== undefined && typeof data.ultimaPagina !== 'boolean') {
      throw new Error('Inter retornou paginação de extrato inválida.');
    }
    if (totalPages === 0 && list.length > 0) throw new Error('Inter retornou paginação de extrato inconsistente.');
    const lastByTotal = totalPages !== null ? page + 1 >= totalPages : null;
    if (typeof data.ultimaPagina === 'boolean' && lastByTotal !== null && data.ultimaPagina !== lastByTotal) {
      throw new Error('Inter retornou paginação de extrato inconsistente.');
    }
    const last = typeof data.ultimaPagina === 'boolean'
      ? data.ultimaPagina
      : lastByTotal ?? list.length < PAGE_SIZE;
    for (const item of list) items.push(item);
    if (last) {
      if (expectedTotal !== null && items.length !== expectedTotal) {
        throw new Error('Inter retornou um extrato incompleto. Tente sincronizar novamente.');
      }
      return items;
    }
    if (!list.length) throw new Error('Inter retornou uma página vazia antes do fim do extrato.');
  }
  throw new Error('O extrato do Inter excedeu o limite de páginas; nenhuma movimentação foi importada.');
}

export async function fetchInterTransactions(startDate: string, finishDate: string, accountNumber?: string | null) {
  if (!validDate(startDate) || !validDate(finishDate) || startDate > finishDate) {
    throw new Error('Período inválido para consultar o extrato do Inter.');
  }
  const creds = await loadCreds(accountNumber);
  const token = await getToken(creds);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (creds.account) headers['x-conta-corrente'] = creds.account;

  const items: unknown[] = [];
  for (let from = startDate; from <= finishDate; from = addDays(from, MAX_WINDOW_DAYS)) {
    const windowEnd = addDays(from, MAX_WINDOW_DAYS - 1);
    const to = windowEnd < finishDate ? windowEnd : finishDate;
    for (const item of await fetchWindow(creds, headers, from, to)) items.push(item);
  }

  const res = await request(creds, 'GET', '/banking/v2/saldo', headers);
  if (res.status !== 200) throw interError(res.status);
  const data = parseResponse(res.body, 'saldo');
  if ((typeof data.disponivel !== 'number' && typeof data.disponivel !== 'string') ||
      (typeof data.disponivel === 'string' && !data.disponivel.trim())) {
    throw new Error('Inter retornou um saldo inválido.');
  }
  const balance = Number(data.disponivel);
  if (!Number.isFinite(balance)) throw new Error('Inter retornou um saldo inválido.');

  const transactions = normalizeInterTransactions(items);
  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
  return { transactions, balance };
}
