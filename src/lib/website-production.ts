export const WEBSITE_PRODUCTION_STAGES = {
  configuration: 'Configuração', briefing: 'Briefing', production: 'Produção',
  internal_review: 'Revisão interna', customer_review: 'Aprovação do cliente', completed: 'Concluído',
} as const;
export type WebsiteProductionStage = keyof typeof WEBSITE_PRODUCTION_STAGES;

export function productivityCents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim())) {
    throw new Error('Informe um valor positivo com até duas casas decimais.');
  }
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 999999999) throw new Error('Valor de produtividade inválido.');
  return cents;
}
