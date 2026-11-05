export const SUBSCRIPTION_GRACE_DAYS = 10;

export function isSubscriptionDueDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2020-01-01' || value > '2100-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function subscriptionToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function subscriptionDaysUntilDue(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!isSubscriptionDueDate(day)) throw new Error('Vencimento da assinatura inválido.');
  return (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${subscriptionToday(now)}T00:00:00Z`)) / 86400000;
}

export function subscriptionDueBlocked(value: string | null | undefined, now = new Date()) {
  const days = subscriptionDaysUntilDue(value, now);
  return days !== null && days < -SUBSCRIPTION_GRACE_DAYS;
}

export function subscriptionBlockDeadline(now = new Date()) {
  return new Date(Date.parse(`${subscriptionToday(now)}T00:00:00Z`) - SUBSCRIPTION_GRACE_DAYS * 86400000).toISOString().slice(0, 10);
}

export function glassSubscriptionLabel(tenant: { ativa?: boolean; status_assinatura?: string; vencimento_assinatura?: string | null }, now = new Date()) {
  if (tenant.status_assinatura === 'inativa' || tenant.status_assinatura === 'cancelada'
    || (tenant.ativa === false && tenant.status_assinatura !== 'bloqueada')) return 'INATIVA';
  if (tenant.status_assinatura === 'bloqueada' || subscriptionDueBlocked(tenant.vencimento_assinatura, now)) return 'BLOQUEADA';
  const days = subscriptionDaysUntilDue(tenant.vencimento_assinatura, now);
  return days !== null && days < 0 ? 'ATRASADA' : 'ATIVA';
}
