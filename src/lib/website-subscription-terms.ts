import { isUuid } from '@/lib/holding-customers';
import { validDate, WEBSITE_PAYMENT_METHODS, type WebsitePaymentMethod } from '@/lib/website-contracts';
import { WEBSITE_RECURRING_CYCLES, type WebsiteFiscalConfig, type WebsiteRecurringCycle } from '@/lib/website-plans';

export type WebsiteSubscription = {
  id: string; customer_id: string; plan_id: string;
  customer_snapshot: Record<string, unknown> & { name: string };
  plan_snapshot: {
    name: string; scope: string; billing_cycle: WebsiteRecurringCycle;
    fiscal_config: WebsiteFiscalConfig | null; invoice_policy: 'automatic_after_payment';
  };
  amount_cents: number; payment_method: WebsitePaymentMethod; first_due_date: string;
  billing_state: 'local' | 'processing' | 'review' | 'issued';
  asaas_environment: 'sandbox' | 'production' | null;
  asaas_subscription_id: string | null; asaas_customer_id: string | null; remote_status: string | null;
  last_error: string | null;
  holding_website_subscription_payments: Array<{
    id: string; asaas_payment_id: string; status: string; amount_cents: number; due_date: string;
    paid_on: string | null; invoice_url: string; fiscal_error: string | null;
    holding_website_invoices: Array<{ status: string; system_invoice_id: string | null }>;
  }>;
};

export const websiteSubscriptionReference = (id: string) => `website-subscription|${id}`;

export function validateWebsiteSubscription(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Informe os dados da assinatura.');
  const input = value as Record<string, unknown>;
  if (!isUuid(input.request_id) || !isUuid(input.customer_id) || !isUuid(input.plan_id)) {
    throw new Error('Selecione cliente e produto válidos. Abra uma nova assinatura para obter a chave de tentativa.');
  }
  if (typeof input.amount_cents !== 'number' || !Number.isSafeInteger(input.amount_cents)
    || input.amount_cents < 1 || input.amount_cents > 999999999) throw new Error('Valor por período inválido.');
  if (typeof input.payment_method !== 'string' || !Object.hasOwn(WEBSITE_PAYMENT_METHODS, input.payment_method)) {
    throw new Error('Forma de pagamento inválida.');
  }
  if (!validDate(input.first_due_date)) throw new Error('Primeiro vencimento inválido.');
  if (!WEBSITE_RECURRING_CYCLES.some((cycle) => cycle === input.billing_cycle)) throw new Error('Ciclo recorrente inválido.');
  if (input.fiscal_confirmed !== true) throw new Error('Confirme a emissão automática após o pagamento e as condições tributárias.');
  return {
    request_id: input.request_id, customer_id: input.customer_id, plan_id: input.plan_id,
    amount_cents: input.amount_cents, payment_method: input.payment_method as WebsitePaymentMethod,
    first_due_date: input.first_due_date,
    billing_cycle: input.billing_cycle as WebsiteRecurringCycle,
  };
}
