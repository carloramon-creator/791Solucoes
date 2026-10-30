import { readFinanceConfig } from '@/lib/finance-config-server';

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

export type VerifiedAsaasPayment =
  | { ok: true; payment: Record<string, any> }
  | { ok: false; retry: boolean; reason: string };

/**
 * O corpo do webhook não é confiável (a URL é pública). Reconsulta o pagamento
 * na API do Asaas com a nossa chave e só aceita o que o Asaas confirmar como pago.
 */
export async function fetchVerifiedAsaasPayment(paymentId: unknown): Promise<VerifiedAsaasPayment> {
  const id = typeof paymentId === 'string' ? paymentId.trim() : '';
  if (!/^pay_[A-Za-z0-9]+$/.test(id)) return { ok: false, retry: false, reason: 'invalid_payment_id' };

  const config = await readFinanceConfig();
  const apiKey = String(config.asaasApiKey || '');
  if (!apiKey) return { ok: false, retry: true, reason: 'asaas_not_configured' };
  const baseUrl = config.asaasEnv === 'production' ? 'https://www.asaas.com/api/v3' : 'https://sandbox.asaas.com/api/v3';

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/payments/${encodeURIComponent(id)}`, {
      headers: { access_token: apiKey, 'User-Agent': '791holding' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, retry: true, reason: 'asaas_unreachable' };
  }
  if (res.status === 404 || res.status === 400) return { ok: false, retry: false, reason: 'payment_not_found' };
  if (!res.ok) return { ok: false, retry: true, reason: `asaas_http_${res.status}` };

  const payment = (await res.json()) as Record<string, any>;
  if (payment.deleted || !PAID_STATUSES.has(String(payment.status))) {
    return { ok: false, retry: false, reason: `status_${payment.status}` };
  }
  return { ok: true, payment };
}
