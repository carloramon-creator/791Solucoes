export const WEBSITE_CATEGORIES = {
  creation: 'Confecção de website',
  hosting: 'Hospedagem',
  maintenance: 'Manutenção',
  additional: 'Alterações adicionais',
} as const;

export const WEBSITE_BILLING_CYCLES = {
  one_time: 'Cobrança única',
  monthly: 'Mensal',
  annual: 'Anual',
} as const;

export type WebsiteCategory = keyof typeof WEBSITE_CATEGORIES;
export type WebsiteBillingCycle = keyof typeof WEBSITE_BILLING_CYCLES;

export type WebsitePlanInput = {
  name: string;
  description: string;
  scope: string;
  category: WebsiteCategory;
  billing_cycle: WebsiteBillingCycle;
  price_cents: number;
  active: boolean;
};

export type WebsitePlan = WebsitePlanInput & {
  id: string;
  created_at: string;
  updated_at: string;
};

export function websiteBillingCycles(category: WebsiteCategory): WebsiteBillingCycle[] {
  return category === 'creation' || category === 'additional'
    ? ['one_time']
    : ['monthly', 'annual'];
}

export function validateWebsitePlan(value: unknown):
  | { ok: true; data: WebsitePlanInput }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Informe os dados do produto.' };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {
    return { ok: false, error: 'Informe um nome com até 120 caracteres.' };
  }
  if (typeof body.description !== 'string' || body.description.trim().length > 2000) {
    return { ok: false, error: 'A descrição deve ter até 2.000 caracteres.' };
  }
  if (typeof body.scope !== 'string' || !body.scope.trim() || body.scope.trim().length > 5000) {
    return { ok: false, error: 'Informe o escopo do serviço com até 5.000 caracteres.' };
  }
  if (typeof body.category !== 'string' || !Object.hasOwn(WEBSITE_CATEGORIES, body.category)) {
    return { ok: false, error: 'Selecione uma categoria válida.' };
  }
  const category = body.category as WebsiteCategory;
  if (!websiteBillingCycles(category).some((cycle) => cycle === body.billing_cycle)) {
    return { ok: false, error: 'A modalidade de cobrança não corresponde à categoria do serviço.' };
  }
  if (typeof body.price_cents !== 'number' || !Number.isSafeInteger(body.price_cents)
    || body.price_cents <= 0 || body.price_cents > 999999999) {
    return { ok: false, error: 'Informe um preço entre R$ 0,01 e R$ 9.999.999,99.' };
  }
  if (typeof body.active !== 'boolean') {
    return { ok: false, error: 'Informe se o produto está ativo.' };
  }
  return {
    ok: true,
    data: {
      name: body.name.trim(),
      description: body.description.trim(),
      scope: body.scope.trim(),
      category,
      billing_cycle: body.billing_cycle as WebsiteBillingCycle,
      price_cents: body.price_cents,
      active: body.active,
    },
  };
}
