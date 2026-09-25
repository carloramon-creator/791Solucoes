type TenantSubscription = {
  ativa?: boolean | null;
  status_assinatura?: string | null;
  vencimento_assinatura?: string | null;
};

const BLOCK_AFTER_DAYS = 5;

export function isTenantChatEnabled(tenant: TenantSubscription) {
  if (tenant.ativa === false) return false;

  const subscriptionStatus = String(tenant.status_assinatura || '').trim().toLowerCase();
  if (['bloqueada', 'inativa', 'cancelada'].includes(subscriptionStatus)) return false;

  const expiration = tenant.vencimento_assinatura ? new Date(tenant.vencimento_assinatura) : null;
  if (!expiration || !Number.isFinite(expiration.getTime())) return true;
  expiration.setHours(23, 59, 59, 999);
  return Date.now() <= expiration.getTime() + BLOCK_AFTER_DAYS * 24 * 60 * 60 * 1000;
}