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
export const WEBSITE_PROJECT_TYPES = {
  landing: 'Landing page',
  institutional: 'Institucional',
  portfolio: 'Portfólio',
  catalog: 'Catálogo',
  store: 'Loja virtual',
} as const;
export type WebsiteProjectType = keyof typeof WEBSITE_PROJECT_TYPES;

export const WEBSITE_FEATURES = {
  configuration: { label: 'Configuração do projeto', description: 'Nome e informações gerais do website.', available: true, required: true },
  briefing: { label: 'Briefing', description: 'Objetivo, identidade, referências e orientações para a equipe.', available: true, required: true },
  templates: { label: 'Modelos prontos', description: 'Biblioteca de bases de conteúdo compatíveis com o tipo de site.', available: true },
  content: { label: 'Personalização de conteúdo', description: 'Textos, layout, seções e prévia privada.', available: true },
  images: { label: 'Fotos e imagens', description: 'Logo, imagem de destaque e imagens de conteúdo.', available: true },
  catalog: { label: 'Catálogo de produtos e serviços', description: 'Cadastro de itens e modo de apresentação ou contato.', available: true, projectTypes: ['catalog', 'store'] },
  domain_managed: { label: 'Domínio administrado pela 791', description: 'Registro e configuração do domínio contratado pela 791 para o cliente.', available: true },
  customer_dns: { label: 'Domínio do cliente com DNS assistido', description: 'A equipe orienta os registros; o cliente aplica ou concede acesso delegado.', available: true },
  email_setup: { label: 'Configuração de e-mail profissional', description: 'Configuração assistida de contas e servidores de e-mail do domínio.', available: true },
  forms: { label: 'Formulários do site', description: 'Receber solicitações enviadas pelos visitantes.', available: false },
  publications: { label: 'Publicações e blog', description: 'Criar e organizar artigos e novidades.', available: false },
  services: { label: 'Serviços', description: 'Área própria para cadastro e apresentação de serviços.', available: false },
  albums: { label: 'Álbuns de fotos', description: 'Galerias e coleções de imagens.', available: false },
  social: { label: 'Redes sociais', description: 'Links para os perfis oficiais e WhatsApp do cliente.', available: true },
  translation: { label: 'Tradução PT/EN/ES', description: 'Traduções salvas com Microsoft Azure e seletor de idiomas por bandeiras.', available: true },
  audio_library: { label: 'Biblioteca de áudio', description: 'Envio e organização de arquivos de áudio.', available: false },
  video_library: { label: 'Biblioteca de vídeo', description: 'Envio e organização de vídeos.', available: false },
  webmail: { label: 'Webmail integrado', description: 'Acesso a e-mail pelo painel do website.', available: false },
  online_checkout: { label: 'Loja com checkout e pagamentos', description: 'Pedidos e pagamentos online integrados.', available: false },
} as const;
export type WebsiteFeature = keyof typeof WEBSITE_FEATURES;
export const WEBSITE_FEATURE_GROUPS = {
  essential: ['configuration', 'briefing', 'templates', 'content', 'images'],
  commerce: ['catalog', 'online_checkout'],
  delivery: ['domain_managed', 'customer_dns', 'email_setup', 'webmail'],
  presence: ['social', 'translation'],
  future: ['forms', 'publications', 'services', 'albums', 'audio_library', 'video_library'],
} as const satisfies Record<string, readonly WebsiteFeature[]>;
export const WEBSITE_FEATURE_GROUP_LABELS = {
  essential: 'Etapas e ferramentas do projeto',
  commerce: 'Catálogo e comércio',
  delivery: 'Domínio e e-mail',
  presence: 'Presença digital',
  future: 'Outros módulos do painel WM',
} as const satisfies Record<keyof typeof WEBSITE_FEATURE_GROUPS, string>;

export function websiteDefaultFeatures(projectType: WebsiteProjectType): WebsiteFeature[] {
  return [
    'configuration', 'briefing', 'templates', 'content', 'images',
    ...(projectType === 'catalog' || projectType === 'store' ? ['catalog' as const] : []),
  ];
}

export function isWebsiteFeature(value: unknown): value is WebsiteFeature {
  return typeof value === 'string' && Object.hasOwn(WEBSITE_FEATURES, value);
}

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
  project_type: WebsiteProjectType | null;
  name: string;
  description: string;
  scope: string;
  category: WebsiteCategory;
  billing_cycle: WebsiteBillingCycle;
  price_cents: number;
  active: boolean;
  fiscal_config: WebsiteFiscalConfig | null;
  website_features: WebsiteFeature[];
  translation_monthly_characters?: number;
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
  const projectType = body.project_type ?? null;
  if ((category === 'creation' && projectType === null)
    || (projectType !== null && (typeof projectType !== 'string' || !Object.hasOwn(WEBSITE_PROJECT_TYPES, projectType)))) {
    return { ok: false, error: 'Selecione o tipo de projeto contratado.' };
  }
  const projectFeatures = body.website_features === undefined
    ? category === 'creation' && projectType ? websiteDefaultFeatures(projectType as WebsiteProjectType) : []
    : body.website_features;
  if (!Array.isArray(projectFeatures) || projectFeatures.some((feature) => !isWebsiteFeature(feature)
    || !WEBSITE_FEATURES[feature].available) || new Set(projectFeatures).size !== projectFeatures.length) {
    return { ok: false, error: 'Revise os recursos selecionados para este plano.' };
  }
  if (category !== 'creation' && projectFeatures.length) {
    return { ok: false, error: 'Somente produtos de confecção podem definir recursos do painel do projeto.' };
  }
  if (category === 'creation' && (!projectFeatures.includes('configuration') || !projectFeatures.includes('briefing'))) {
    return { ok: false, error: 'Configuração e briefing são etapas essenciais e devem permanecer incluídas.' };
  }
  if (projectFeatures.includes('catalog') && projectType !== 'catalog' && projectType !== 'store') {
    return { ok: false, error: 'O catálogo só pode ser incluído em projetos de catálogo ou loja virtual.' };
  }
  const translationLimit = body.translation_monthly_characters ?? 0;
  if (!Number.isSafeInteger(translationLimit) || typeof translationLimit !== 'number'
    || (projectFeatures.includes('translation') ? translationLimit < 1 || translationLimit > 1800000 : translationLimit !== 0)) {
    return { ok: false, error: 'Tradução exige uma franquia mensal de 1 a 1.800.000 caracteres. Sem o recurso, use zero.' };
  }
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
      project_type: projectType as WebsiteProjectType | null,
      name: body.name.trim(),
      description: body.description.trim(),
      scope: body.scope.trim(),
      category,
      billing_cycle: body.billing_cycle as WebsiteBillingCycle,
      price_cents: body.price_cents,
      active: body.active,
      fiscal_config: fiscal.data,
      website_features: projectFeatures as WebsiteFeature[],
      ...(projectFeatures.includes('translation') ? { translation_monthly_characters: translationLimit } : { translation_monthly_characters: 0 }),
      ...(recurringPrices ? { recurring_prices: recurringPrices } : {}),
    },
  };
}
