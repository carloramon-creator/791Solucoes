import https from 'https';
import { createHash } from 'crypto';
import { readFinanceConfig } from '@/lib/finance-config-server';

const INTER_HOST = 'cdpj.partners.bancointer.com.br';
const MAX_WINDOW_DAYS = 90;
const PAGE_SIZE = 1000;

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

async function loadCreds(): Promise<InterCreds> {
  const cfg = await readFinanceConfig();
  const creds = {
    clientId: String(cfg.interClientId || '').trim(),
    clientSecret: String(cfg.interClientSecret || '').trim(),
    cert: normalizePem(cfg.interCertCrt),
    key: normalizePem(cfg.interCertKey),
    account: String(cfg.interAccountNumber || '').replace(/\D/g, ''),
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
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao consultar o Inter.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function interError(status: number, body: string) {
  if (status === 401 || status === 403) {
    return new Error(`Inter recusou o acesso (${status}). Verifique se a integração está ativa e vinculada à conta no Internet Banking PJ.`);
  }
  return new Error(`Inter ${status}: ${body.slice(0, 200)}`);
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
  if (res.status !== 200) throw interError(res.status, res.body);
  const token = JSON.parse(res.body)?.access_token;
  if (!token) throw new Error('Inter não devolveu o token de acesso.');
  return String(token);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pickName(detalhes: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = detalhes[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return null;
}

const SAFE_ID = /^[A-Za-z0-9_\-:.]{1,120}$/;

type InterRawTx = {
  idTransacao?: string;
  dataTransacao?: string;
  dataInclusao?: string;
  tipoTransacao?: string;
  tipoOperacao?: string;
  valor?: string | number;
  titulo?: string;
  descricao?: string;
  detalhes?: Record<string, unknown> | null;
};

/** Converte as transações do extrato enriquecido do Inter para o formato do bank-sync. */
export function normalizeInterTransactions(items: InterRawTx[]): InterStatementTx[] {
  const seen = new Map<string, number>();
  const out: InterStatementTx[] = [];
  for (const t of items) {
    const date = String(t?.dataTransacao || t?.dataInclusao || '').slice(0, 10);
    const value = Math.round(Math.abs(Number(t?.valor)) * 100) / 100;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value === 0) continue;
    const isDebit = String(t?.tipoOperacao || '').toUpperCase() === 'D';
    const detalhes = (t?.detalhes && typeof t.detalhes === 'object') ? t.detalhes as Record<string, unknown> : {};
    const titulo = String(t?.titulo || '').trim();
    const descricao = String(t?.descricao || '').trim();
    const description = [titulo, descricao && descricao !== titulo ? descricao : ''].filter(Boolean).join(' - ') || String(t?.tipoTransacao || 'Inter');
    const counterparty = isDebit
      ? pickName(detalhes, ['nomeRecebedor', 'nomeFavorecido', 'nomeBeneficiario', 'nomeEmpresa', 'nomePagador'])
      : pickName(detalhes, ['nomePagador', 'nomeRemetente', 'nomeEmpresa', 'nomeRecebedor']);
    const reference = pickName(detalhes, ['endToEndId', 'codigoSolicitacao', 'nossoNumero', 'codigoBarras']);

    let externalId = String(t?.idTransacao || '').trim();
    if (!SAFE_ID.test(externalId)) {
      // Sem id do banco: hash estável + ordem de ocorrência para lançamentos idênticos no mesmo dia.
      const base = createHash('sha1')
        .update([date, t?.tipoOperacao, value.toFixed(2), titulo, descricao, reference || ''].join('|'))
        .digest('hex').slice(0, 32);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      externalId = `h:${base}:${n}`;
    }

    out.push({
      externalId,
      date,
      amount: isDebit ? -value : value,
      type: String(t?.tipoTransacao || (isDebit ? 'DEBITO' : 'CREDITO')),
      description,
      counterparty,
      referenceId: reference,
      balanceAfter: null,
      raw: t,
    });
  }
  return out;
}

export async function fetchInterTransactions(startDate: string, finishDate: string) {
  const creds = await loadCreds();
  const token = await getToken(creds);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (creds.account) headers['x-conta-corrente'] = creds.account;

  const items: InterRawTx[] = [];
  for (let from = startDate; from <= finishDate; from = addDays(from, MAX_WINDOW_DAYS)) {
    const windowEnd = addDays(from, MAX_WINDOW_DAYS - 1);
    const to = windowEnd < finishDate ? windowEnd : finishDate;
    for (let page = 0; page < 50; page++) {
      const qs = new URLSearchParams({ dataInicio: from, dataFim: to, pagina: String(page), tamanhoPagina: String(PAGE_SIZE) });
      const res = await request(creds, 'GET', `/banking/v2/extrato/completo?${qs}`, headers);
      if (res.status !== 200) throw interError(res.status, res.body);
      const data = JSON.parse(res.body || '{}');
      const list = Array.isArray(data?.transacoes) ? data.transacoes : [];
      items.push(...list);
      const totalPages = Number(data?.totalPaginas);
      if (data?.ultimaPagina === true || list.length < PAGE_SIZE || (Number.isFinite(totalPages) && page + 1 >= totalPages)) break;
    }
  }

  let balance: number | null = null;
  try {
    const res = await request(creds, 'GET', '/banking/v2/saldo', headers);
    if (res.status === 200) {
      const value = Number(JSON.parse(res.body)?.disponivel);
      balance = Number.isFinite(value) ? value : null;
    }
  } catch {
    balance = null;
  }

  return { transactions: normalizeInterTransactions(items), balance };
}
