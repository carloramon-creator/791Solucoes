import 'server-only';

import { supabaseServer } from '@/lib/supabase-server';

export const CREDIT_AI_PROMPT_KEY = 'credito_analise';
export const COST_AI_PROMPT_KEY = 'custos_analise';
export const STOCK_AI_PROMPT_KEY = 'estoque_analise';

export const DEFAULT_CREDIT_AI_SYSTEM_PROMPT = [
  'Você é um analista de risco de crédito para orçamento comercial no Brasil.',
  'Responda APENAS com JSON válido, sem markdown.',
  'Campos obrigatórios no JSON:',
  'risco_pontos (0-100 number), risco_faixa (baixo|medio|alto), confianca (0-100 number),',
  'recomendacao_limite (number >= 0), recomendacao_percentual_sobre_pedido (number >= 0),',
  'aprovar_sinalizado (boolean), resumo_executivo (string curta), narrativa (string), alertas (string[]).',
  'Considere postura conservadora quando houver sinais negativos ou baixa confiança nos dados.',
].join(' ');

export const DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE = [
  'Analise o contexto abaixo e responda somente com JSON válido, sem markdown.',
  '',
  'Contexto:',
  '{{contexto_json}}',
].join('\n');

export const DEFAULT_COST_AI_SYSTEM_PROMPT = [
  'Você é um analista financeiro especializado em custos operacionais e margem.',
  'Responda APENAS com JSON válido, sem markdown.',
  'Campos obrigatórios no JSON:',
  'resumo_executivo (string curta), riscos (string[]), desperdicios (string[]),',
  'economia_potencial (number >= 0), prioridade_acao (baixo|medio|alto),',
  'plano_acao (string[]), confianca (0-100 number).',
  'Mantenha foco prático e orientado a redução de custos sem comprometer qualidade.',
].join(' ');

export const DEFAULT_COST_AI_USER_PROMPT_TEMPLATE = [
  'Analise o contexto de custos abaixo e responda somente com JSON válido, sem markdown.',
  '',
  'Contexto:',
  '{{contexto_json}}',
].join('\n');

export const DEFAULT_STOCK_AI_SYSTEM_PROMPT = [
  'Você é um analista de estoque e reposição para operação comercial.',
  'Responda APENAS com JSON válido, sem markdown.',
  'Campos obrigatórios no JSON:',
  'itens_criticos (string[]), itens_parados (string[]), sugestao_compra (array de objetos),',
  'risco_ruptura (baixo|medio|alto), recomendacoes (string[]), confianca (0-100 number).',
  'Priorize equilíbrio entre disponibilidade, giro e capital imobilizado.',
].join(' ');

export const DEFAULT_STOCK_AI_USER_PROMPT_TEMPLATE = [
  'Analise o contexto de estoque abaixo e responda somente com JSON válido, sem markdown.',
  '',
  'Contexto:',
  '{{contexto_json}}',
].join('\n');

export type AiPromptConfig = {
  chave: string;
  titulo: string;
  descricao: string | null;
  uso_em: string[];
  system_prompt: string;
  user_prompt_template: string;
  ativo: boolean;
  versao: number;
  updated_by: string | null;
  updated_at: string | null;
};

export type AiPromptInput = Pick<AiPromptConfig, 'titulo' | 'descricao' | 'uso_em' | 'system_prompt' | 'user_prompt_template' | 'ativo'>;

const DEFAULT_PROMPTS: Record<string, Omit<AiPromptConfig, 'versao' | 'updated_by' | 'updated_at'>> = {
  [CREDIT_AI_PROMPT_KEY]: {
    chave: CREDIT_AI_PROMPT_KEY,
    titulo: 'Análise de crédito',
    descricao: 'Prompt usado na análise financeira de crédito',
    uso_em: ['orcamentos.credito'],
    system_prompt: DEFAULT_CREDIT_AI_SYSTEM_PROMPT,
    user_prompt_template: DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE,
    ativo: true,
  },
  [COST_AI_PROMPT_KEY]: {
    chave: COST_AI_PROMPT_KEY,
    titulo: 'Análise de custos',
    descricao: 'Prompt usado para avaliação e otimização de custos',
    uso_em: ['financeiro.custos'],
    system_prompt: DEFAULT_COST_AI_SYSTEM_PROMPT,
    user_prompt_template: DEFAULT_COST_AI_USER_PROMPT_TEMPLATE,
    ativo: true,
  },
  [STOCK_AI_PROMPT_KEY]: {
    chave: STOCK_AI_PROMPT_KEY,
    titulo: 'Análise de estoque',
    descricao: 'Prompt usado para leitura de risco e reposição de estoque',
    uso_em: ['estoque.analise'],
    system_prompt: DEFAULT_STOCK_AI_SYSTEM_PROMPT,
    user_prompt_template: DEFAULT_STOCK_AI_USER_PROMPT_TEMPLATE,
    ativo: true,
  },
};

function normalizeUsoEm(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => /^[a-z0-9._-]+$/.test(item))
    )
  );
}

function defaultForKey(chave: string): AiPromptConfig {
  const cleanKey = String(chave || '').trim() || CREDIT_AI_PROMPT_KEY;
  const preset = DEFAULT_PROMPTS[cleanKey];
  const fallback = {
    chave: cleanKey,
    titulo: cleanKey.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    descricao: 'Prompt personalizado da Holding',
    uso_em: [],
    system_prompt: DEFAULT_CREDIT_AI_SYSTEM_PROMPT,
    user_prompt_template: DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE,
    ativo: true,
  };
  const base = preset || fallback;

  return {
    ...base,
    versao: 1,
    updated_by: null,
    updated_at: null,
  };
}

const normalizeRow = (row: any): AiPromptConfig => {
  const base = defaultForKey(String(row?.chave || CREDIT_AI_PROMPT_KEY).trim());
  return {
  chave: String(row?.chave || base.chave).trim(),
  titulo: String(row?.titulo || base.titulo).trim(),
  descricao: row?.descricao === null || row?.descricao === undefined ? base.descricao : String(row.descricao),
  uso_em: normalizeUsoEm(row?.uso_em).length > 0 ? normalizeUsoEm(row?.uso_em) : base.uso_em,
  system_prompt: String(row?.system_prompt || base.system_prompt).trim() || base.system_prompt,
  user_prompt_template: String(row?.user_prompt_template || base.user_prompt_template).trim() || base.user_prompt_template,
  ativo: row?.ativo === undefined ? true : Boolean(row.ativo),
  versao: Number.isFinite(Number(row?.versao)) ? Number(row.versao) : 1,
  updated_by: row?.updated_by ? String(row.updated_by) : null,
  updated_at: row?.updated_at ? String(row.updated_at) : null,
  };
};

export function getAllAiPromptDefaultConfigs(): AiPromptConfig[] {
  return Object.keys(DEFAULT_PROMPTS).map((key) => defaultForKey(key));
}

export function getAiPromptDefaultConfig(chave: string): AiPromptConfig {
  return defaultForKey(chave);
}

export function renderAiUserPrompt(template: string, contexto: unknown) {
  const rawTemplate = String(template || '').trim() || DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE;
  const contextoJson = JSON.stringify(contexto, null, 2);
  return rawTemplate.includes('{{contexto_json}}')
    ? rawTemplate.replace(/\{\{contexto_json\}\}/g, contextoJson)
    : `${rawTemplate}\n\n${contextoJson}`;
}

export async function getAiPromptConfig(chave: string): Promise<AiPromptConfig> {
  const cleanKey = String(chave || '').trim() || CREDIT_AI_PROMPT_KEY;
  const { data, error } = await supabaseServer
    .from('ai_prompt_configs')
    .select('chave, titulo, descricao, uso_em, system_prompt, user_prompt_template, ativo, versao, updated_by, updated_at')
    .eq('chave', cleanKey)
    .maybeSingle();

  if (error || !data) {
    return defaultForKey(cleanKey);
  }

  return normalizeRow(data);
}

export async function listAiPromptConfigs(): Promise<AiPromptConfig[]> {
  const { data, error } = await supabaseServer
    .from('ai_prompt_configs')
    .select('chave, titulo, descricao, uso_em, system_prompt, user_prompt_template, ativo, versao, updated_by, updated_at')
    .order('updated_at', { ascending: false });

  const defaults = getAllAiPromptDefaultConfigs();
  const byKey = new Map<string, AiPromptConfig>();

  defaults.forEach((item) => byKey.set(item.chave, item));

  if (!error && Array.isArray(data)) {
    data.forEach((row) => {
      const normalized = normalizeRow(row);
      byKey.set(normalized.chave, normalized);
    });
  }

  return Array.from(byKey.values()).sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

export async function saveAiPromptConfig(chave: string, input: AiPromptInput, updatedBy?: string | null) {
  const cleanKey = String(chave || '').trim() || CREDIT_AI_PROMPT_KEY;
  const defaults = defaultForKey(cleanKey);
  const current = await getAiPromptConfig(cleanKey);
  const payload = {
    chave: cleanKey,
    titulo: String(input.titulo || defaults.titulo).trim(),
    descricao: input.descricao === null ? null : String(input.descricao || '').trim() || null,
    uso_em: normalizeUsoEm(input.uso_em).length > 0 ? normalizeUsoEm(input.uso_em) : defaults.uso_em,
    system_prompt: String(input.system_prompt || defaults.system_prompt).trim(),
    user_prompt_template: String(input.user_prompt_template || defaults.user_prompt_template).trim(),
    ativo: Boolean(input.ativo),
    versao: current.versao + 1,
    updated_by: updatedBy ? String(updatedBy) : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseServer
    .from('ai_prompt_configs')
    .upsert(payload, { onConflict: 'chave' })
    .select('chave, titulo, descricao, uso_em, system_prompt, user_prompt_template, ativo, versao, updated_by, updated_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Nao foi possivel salvar o prompt de IA');
  }

  return normalizeRow(data);
}

export function getCreditAiPromptDefaultConfig(): AiPromptConfig {
  return getAiPromptDefaultConfig(CREDIT_AI_PROMPT_KEY);
}

export async function getCreditAiPromptConfig(): Promise<AiPromptConfig> {
  return getAiPromptConfig(CREDIT_AI_PROMPT_KEY);
}

export async function saveCreditAiPromptConfig(input: AiPromptInput, updatedBy?: string | null) {
  return saveAiPromptConfig(CREDIT_AI_PROMPT_KEY, input, updatedBy);
}

export function renderCreditAiUserPrompt(template: string, contexto: unknown) {
  return renderAiUserPrompt(template, contexto);
}