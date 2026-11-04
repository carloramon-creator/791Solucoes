export const WEBSITE_CATEGORIES = {
  creation: 'Confecção de website',
  hosting: 'Hospedagem',
  maintenance: 'Manutenção',
  additional: 'Alterações adicionais',
} as const;

export const WEBSITE_BILLING_CYCLES = {
  one_time: 'Cobrança única',
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
} as const;

export type WebsiteCategory = keyof typeof WEBSITE_CATEGORIES;
export type WebsiteBillingCycle = keyof typeof WEBSITE_BILLING_CYCLES;
export type WebsiteRecurringCycle = Exclude<WebsiteBillingCycle, 'one_time'>;
export type WebsiteRecurringPrices = Partial<Record<WebsiteRecurringCycle, number>>;
export const WEBSITE_RECURRING_CYCLES: WebsiteRecurringCycle[] = ['monthly', 'quarterly', 'semiannual', 'annual'];
export function websiteRecurringPrices(plan: { billing_cycle: WebsiteBillingCycle; price_cents: number; recurring_prices?: WebsiteRecurringPrices }): WebsiteRecurringPrices {
  return plan.recurring_prices ?? (plan.billing_cycle === 'one_time' ? {} : { [plan.billing_cycle]: plan.price_cents });
}

export type WebsiteFiscalConfig = {
  national_code: string;
  municipal_code: string;
  nbs: string;
  service_description: string;
  accountant_confirmed: boolean;
  simples_percent: number | null;
};

export function websiteInvoicePolicy(cycle: WebsiteBillingCycle) {
  return cycle === 'one_time' ? 'manual_project_total' : 'automatic_after_payment';
}

export function validateWebsiteFiscalConfig(value: unknown):
  | { ok: true; data: WebsiteFiscalConfig | null }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, data: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Dados fiscais inválidos.' };
  const config = value as Record<string, unknown>;
  for (const [field, length] of [['national_code', 6], ['municipal_code', 3], ['nbs', 9]] as const) {
    if (typeof config[field] !== 'string' || (config[field].trim() && !new RegExp(`^\\d{${length}}$`).test(config[field].trim()))) {
      return { ok: false, error: `Informe ${length} dígitos em ${field}, ou deixe em branco enquanto estiver pendente.` };
    }
  }
  if (typeof config.service_description !== 'string' || config.service_description.trim().length > 2000) {
    return { ok: false, error: 'A descrição fiscal deve ter até 2.000 caracteres.' };
  }
  if (typeof config.accountant_confirmed !== 'boolean') return { ok: false, error: 'Informe a confirmação contábil.' };
  if (config.simples_percent !== null && config.simples_percent !== undefined
    && (typeof config.simples_percent !== 'number' || !Number.isFinite(config.simples_percent)
      || config.simples_percent < 0 || config.simples_percent > 100)) {
    return { ok: false, error: 'Informe o percentual aproximado de tributos do Simples entre 0 e 100.' };
  }
  const data: WebsiteFiscalConfig = {
    national_code: (config.national_code as string).trim(),
    municipal_code: (config.municipal_code as string).trim(),
    nbs: (config.nbs as string).trim(),
    service_description: config.service_description.trim(),
    accountant_confirmed: config.accountant_confirmed,
    simples_percent: typeof config.simples_percent === 'number' ? config.simples_percent : null,
  };
  if (data.accountant_confirmed && (!data.national_code || !data.nbs || !data.service_description || data.simples_percent === null)) {
    return { ok: false, error: 'Preencha tributação nacional, NBS, descrição e percentual de tributos antes de confirmar com a contabilidade.' };
  }
  return { ok: true, data };
}

export type WebsitePlanInput = {
  name: string;
  description: string;
  scope: string;
  category: WebsiteCategory;
  billing_cycle: WebsiteBillingCycle;
  price_cents: number;
  active: boolean;
  fiscal_config: WebsiteFiscalConfig | null;
  recurring_prices?: WebsiteRecurringPrices;
};

export type WebsitePlan = WebsitePlanInput & {
  id: string;
  created_at: string;
  updated_at: string;
};

export function websiteBillingCycles(category: WebsiteCategory): WebsiteBillingCycle[] {
  return category === 'creation' || category === 'additional'
    ? ['one_time']
    : [...WEBSITE_RECURRING_CYCLES];
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
  const fiscal = validateWebsiteFiscalConfig(body.fiscal_config);
  if (!fiscal.ok) return fiscal;
  let recurringPrices: WebsiteRecurringPrices | undefined = body.billing_cycle === 'one_time'
    ? undefined : { [body.billing_cycle as WebsiteRecurringCycle]: body.price_cents };
  if (body.recurring_prices !== undefined) {
    if (!body.recurring_prices || typeof body.recurring_prices !== 'object' || Array.isArray(body.recurring_prices)) {
      return { ok: false, error: 'Tabela de preços por ciclo inválida.' };
    }
    recurringPrices = {};
    for (const [cycle, price] of Object.entries(body.recurring_prices)) {
      if (!WEBSITE_RECURRING_CYCLES.some((key) => key === cycle) || typeof price !== 'number'
        || !Number.isSafeInteger(price) || price < 1 || price > 999999999) {
        return { ok: false, error: 'Cada ciclo habilitado deve ter um preço válido em centavos.' };
      }
      recurringPrices[cycle as WebsiteRecurringCycle] = price;
    }
    if (body.billing_cycle === 'one_time' ? Object.keys(recurringPrices).length !== 0
      : recurringPrices[body.billing_cycle as WebsiteRecurringCycle] !== body.price_cents) {
      return { ok: false, error: 'O preço do ciclo padrão deve corresponder à tabela de ciclos. Projetos não possuem ciclos recorrentes.' };
    }
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
      fiscal_config: fiscal.data,
      ...(recurringPrices ? { recurring_prices: recurringPrices } : {}),
    },
  };
}
