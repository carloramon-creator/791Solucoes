import { isUuid } from '@/lib/holding-customers';
import type { WebsiteFiscalConfig } from '@/lib/website-plans';
import type { WebsiteProjectType } from '@/lib/website-plans';

export const WEBSITE_PAYMENT_METHODS = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão de crédito' } as const;
export type WebsitePaymentMethod = keyof typeof WEBSITE_PAYMENT_METHODS;
export type WebsiteInstallment = {
  number: number;
  amount_cents: number;
  due_date: string;
  kind: 'deposit' | 'balance';
};
export type WebsiteContract = {
  designer_email?: string | null;
  designer_name?: string | null;
  project_type?: WebsiteProjectType | null;
  edit_revision?: number;
  updated_at?: string;
  bundled_subscription?: boolean;
  id: string;
  customer_id: string;
  plan_id: string;
  customer_snapshot: { name: string; document: string; email: string };
  plan_snapshot: {
    name: string; scope: string; fiscal_config: WebsiteFiscalConfig | null;
    invoice_policy: 'manual_project_total';
  };
  total_cents: number;
  payment_method: WebsitePaymentMethod;
  billing_state: 'local' | 'processing' | 'review' | 'issued';
  asaas_environment: 'sandbox' | 'production' | null;
  created_at: string;
  holding_website_invoices?: Array<{ id: string; status: 'preparing' | 'sending' | 'authorized' | 'review'; competence: string }>;
  holding_website_installments: Array<WebsiteInstallment & {
    id: string; asaas_payment_id: string | null; invoice_url: string | null; status: string;
  }>;
};

export function validDate(value: unknown): value is string {
  if (!(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '2020-01-01' && value <= '2100-12-31'
  )) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthDate(date: string, offset: number) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function buildWebsiteSchedule(input: {
  total_cents: number; count: number; first_due_date: string;
  deposit_cents: number; deposit_due_date: string;
}): WebsiteInstallment[] {
  const { total_cents: total, count, first_due_date: first, deposit_cents: deposit, deposit_due_date: depositDate } = input;
  if (!Number.isSafeInteger(total) || total < 1 || total > 999999999) throw new Error('Preço total inválido.');
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('Selecione de 1 a 12 parcelas do saldo.');
  if (!Number.isSafeInteger(deposit) || deposit < 0 || deposit >= total) throw new Error('A entrada deve ser menor que o valor total.');
  if (!validDate(first) || (deposit > 0 && (!validDate(depositDate) || depositDate >= first))) {
    throw new Error('Informe vencimentos válidos; a entrada deve vencer antes da primeira parcela do saldo.');
  }
  const balance = total - deposit;
  if (balance < count) throw new Error('Cada parcela deve ter pelo menos R$ 0,01.');
  const rows: WebsiteInstallment[] = deposit > 0
    ? [{ number: 1, amount_cents: deposit, due_date: depositDate, kind: 'deposit' }] : [];
  const base = Math.floor(balance / count);
  for (let i = 0; i < count; i++) {
    const due = monthDate(first, i);
    if (!validDate(due)) throw new Error('O cronograma ultrapassa o limite de datas permitido.');
    rows.push({ number: rows.length + 1, amount_cents: i === count - 1 ? balance - base * i : base, due_date: due, kind: 'balance' });
  }
  return rows;
}

export function validateWebsiteContract(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Informe a contratação.');
  const body = value as Record<string, unknown>;
  if (!isUuid(body.customer_id) || !isUuid(body.plan_id)) throw new Error('Selecione cliente e produto válidos.');
  if (!isUuid(body.request_id)) throw new Error('Identificador de contratação inválido. Abra uma nova contratação.');
  if (typeof body.payment_method !== 'string' || !Object.hasOwn(WEBSITE_PAYMENT_METHODS, body.payment_method)) {
    throw new Error('Forma de pagamento inválida.');
  }
  for (const key of ['total_cents', 'count', 'deposit_cents']) {
    if (typeof body[key] !== 'number') throw new Error('Valores e parcelas devem ser numéricos.');
  }
  const schedule = buildWebsiteSchedule({
    total_cents: body.total_cents as number, count: body.count as number,
    deposit_cents: body.deposit_cents as number, first_due_date: body.first_due_date as string,
    deposit_due_date: body.deposit_due_date as string,
  });
  return {
    request_id: body.request_id, customer_id: body.customer_id, plan_id: body.plan_id, total_cents: body.total_cents as number,
    payment_method: body.payment_method as WebsitePaymentMethod, schedule,
  };
}
