export type GlassModule = { id: string; slug?: string | null; nome: string; parent_slug?: string | null };

export type GlassPlan = {
  base_price?: number | null;
  included_modules?: string[] | null;
  optional_modules_pricing?: Record<string, number> | null;
  bundle_prices?: Record<string, number> | null;
  user_limit?: number | null;
  discount_semestral?: number | null;
  discount_anual?: number | null;
  system_limits?: Record<string, number> | null;
};

export type GlassTenantPricingInput = {
  modulos_ativos?: string[] | null;
  limite_usuarios?: number | null;
  limite_usuarios_whats?: number | null;
  ciclo_pagamento?: string | null;
};

/** Combos cobrados, definidos pelos módulos principais (raiz). Menus filhos seguem o módulo pai. */
export const GLASS_COMBOS: Array<{ id: string; nome: string; roots: string[] }> = [
  { id: 'financeiro', nome: 'Financeiro', roots: ['financeiro', 'agendamentos'] },
  { id: 'producao', nome: 'Produção & Engenharia', roots: ['producao', 'os', 'relatorios', 'estoque'] },
  { id: 'comunicacao', nome: 'Comunicação', roots: ['chat', 'crm'] },
  { id: 'rh', nome: 'Recursos Humanos', roots: ['rh'] },
  { id: 'fiscal', nome: 'Notas Fiscais (NF-e)', roots: ['notas-fiscais'] },
];

// Slugs antigos que não existem mais na tabela de módulos, mas ainda aparecem em alguns tenants.
const LEGACY_SLUG_ROOT: Record<string, string> = {
  bancos: 'financeiro',
  'ordens-servico': 'os',
  ordens_servico: 'os',
  fiscal: 'notas-fiscais',
  comunicacao: 'chat',
  whatsapp: 'chat',
};

export function comboOfRoot(rootSlug: string) {
  return GLASS_COMBOS.find((combo) => combo.roots.includes(rootSlug)) || null;
}

/** Módulo raiz de um slug (o próprio, o pai ou o equivalente legado). */
export function rootOfSlug(slug: string, modules: GlassModule[]) {
  const mod = modules.find((m) => m.slug === slug || m.id === slug);
  if (mod) return mod.parent_slug || mod.slug || slug;
  return LEGACY_SLUG_ROOT[slug] || slug;
}

export function activeRoots(modulosAtivos: string[] | null | undefined, modules: GlassModule[]) {
  return new Set((modulosAtivos || []).map((slug) => rootOfSlug(slug, modules)));
}

export function comboPrice(plan: GlassPlan | null | undefined, comboId: string) {
  if (plan?.bundle_prices?.[comboId] !== undefined) return Number(plan.bundle_prices[comboId]);
  return Number(plan?.optional_modules_pricing?.[comboId] || 0);
}

/** Valor do ciclo da assinatura do 791glass (mesma regra da lista de assinaturas). */
export function computeGlassSubscription(params: {
  tenant: GlassTenantPricingInput;
  plan: GlassPlan | null | undefined;
  modules: GlassModule[];
  sponsored?: boolean;
}) {
  const { tenant, plan, modules, sponsored } = params;
  const roots = activeRoots(tenant.modulos_ativos, modules);
  const base = sponsored ? 0 : Number(plan?.base_price || 0);

  const combos = GLASS_COMBOS.map((combo) => ({
    id: combo.id,
    nome: combo.nome,
    active: combo.roots.some((root) => roots.has(root)),
    price: comboPrice(plan, combo.id),
  }));
  const combosTotal = combos.reduce((sum, combo) => sum + (combo.active ? combo.price : 0), 0);

  const limits = plan?.system_limits || {};
  const baseUsers = Number(plan?.user_limit || limits.usersIncluded || 0);
  const extraUsers = Math.max(0, Number(tenant.limite_usuarios || 0) - baseUsers);
  const extraWpp = Math.max(0, Number(tenant.limite_usuarios_whats || 0) - Number(limits.wppDevices || 0));
  const extras = extraUsers * Number(limits.extraUserPrice || 0) + extraWpp * Number(limits.extraDevicePrice || 0);

  const subtotal = base + combosTotal + extras;
  let discountPercent = 0;
  if (tenant.ciclo_pagamento === 'semiannual') discountPercent = Number(plan?.discount_semestral || 5);
  else if (tenant.ciclo_pagamento === 'annual') discountPercent = Number(plan?.discount_anual || 15);
  const total = Number((subtotal * (1 - discountPercent / 100)).toFixed(2));

  return { base, combos, combosTotal, extras, extraUsers, extraWpp, subtotal, discountPercent, total };
}
