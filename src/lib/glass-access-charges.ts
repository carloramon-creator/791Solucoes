export type GlassAccessOrder = {
  id: string;
  vidracaria_id: string;
  kind: 'system' | 'whatsapp';
  quantity: number;
  unit_cents: number;
  cycle: string;
  status: string;
  billing_from: string;
  billing_until: string | null;
};

export function glassAccessChargesForMonth(orders: GlassAccessOrder[], refMonth: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(refMonth)) throw new Error('Competencia de acessos invalida.');
  const items = orders.filter((order) => order.status === 'confirmed' && ['semiannual', 'annual'].includes(order.cycle)
    && order.billing_from.slice(0, 7) <= refMonth && order.billing_until !== null && refMonth < order.billing_until.slice(0, 7));
  const totalCents = items.reduce((sum, order) => {
    if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0 || !Number.isSafeInteger(order.unit_cents) || order.unit_cents <= 0) {
      throw new Error('Contratacao de acessos inconsistente. Revise antes de faturar.');
    }
    return sum + order.quantity * order.unit_cents;
  }, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('Total de acessos invalido.');
  return { total: totalCents / 100, items };
}
