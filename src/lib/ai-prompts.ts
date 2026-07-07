import 'server-only';

import { supabaseServer } from '@/lib/supabase-server';

export const CREDIT_AI_PROMPT_KEY = 'credito_analise';

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

export type CreditAiPromptConfig = {
  chave: string;
  titulo: string;
  descricao: string | null;
  system_prompt: string;
  user_prompt_template: string;
  ativo: boolean;
  versao: number;
  updated_by: string | null;
  updated_at: string | null;
};

export type CreditAiPromptInput = Pick<CreditAiPromptConfig, 'titulo' | 'descricao' | 'system_prompt' | 'user_prompt_template' | 'ativo'>;

const fallbackConfig = (): CreditAiPromptConfig => ({
  chave: CREDIT_AI_PROMPT_KEY,
  titulo: 'Análise de crédito',
  descricao: 'Prompt usado na análise financeira de crédito',
  system_prompt: DEFAULT_CREDIT_AI_SYSTEM_PROMPT,
  user_prompt_template: DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE,
  ativo: true,
  versao: 1,
  updated_by: null,
  updated_at: null,
});

const normalizeRow = (row: any): CreditAiPromptConfig => ({
  chave: String(row?.chave || CREDIT_AI_PROMPT_KEY).trim(),
  titulo: String(row?.titulo || fallbackConfig().titulo).trim(),
  descricao: row?.descricao === null || row?.descricao === undefined ? fallbackConfig().descricao : String(row.descricao),
  system_prompt: String(row?.system_prompt || DEFAULT_CREDIT_AI_SYSTEM_PROMPT).trim() || DEFAULT_CREDIT_AI_SYSTEM_PROMPT,
  user_prompt_template: String(row?.user_prompt_template || DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE).trim() || DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE,
  ativo: row?.ativo === undefined ? true : Boolean(row.ativo),
  versao: Number.isFinite(Number(row?.versao)) ? Number(row.versao) : 1,
  updated_by: row?.updated_by ? String(row.updated_by) : null,
  updated_at: row?.updated_at ? String(row.updated_at) : null,
});

export function getCreditAiPromptDefaultConfig(): CreditAiPromptConfig {
  return fallbackConfig();
}

export function renderCreditAiUserPrompt(template: string, contexto: unknown) {
  const rawTemplate = String(template || '').trim() || DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE;
  const contextoJson = JSON.stringify(contexto, null, 2);
  return rawTemplate.includes('{{contexto_json}}')
    ? rawTemplate.replace(/\{\{contexto_json\}\}/g, contextoJson)
    : `${rawTemplate}\n\n${contextoJson}`;
}

export async function getCreditAiPromptConfig(): Promise<CreditAiPromptConfig> {
  const { data, error } = await supabaseServer
    .from('ai_prompt_configs')
    .select('chave, titulo, descricao, system_prompt, user_prompt_template, ativo, versao, updated_by, updated_at')
    .eq('chave', CREDIT_AI_PROMPT_KEY)
    .maybeSingle();

  if (error || !data) {
    return fallbackConfig();
  }

  return normalizeRow(data);
}

export async function saveCreditAiPromptConfig(input: CreditAiPromptInput, updatedBy?: string | null) {
  const current = await getCreditAiPromptConfig();
  const payload = {
    chave: CREDIT_AI_PROMPT_KEY,
    titulo: String(input.titulo || fallbackConfig().titulo).trim(),
    descricao: input.descricao === null ? null : String(input.descricao || '').trim() || null,
    system_prompt: String(input.system_prompt || DEFAULT_CREDIT_AI_SYSTEM_PROMPT).trim(),
    user_prompt_template: String(input.user_prompt_template || DEFAULT_CREDIT_AI_USER_PROMPT_TEMPLATE).trim(),
    ativo: Boolean(input.ativo),
    versao: current.versao + 1,
    updated_by: updatedBy ? String(updatedBy) : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseServer
    .from('ai_prompt_configs')
    .upsert(payload, { onConflict: 'chave' })
    .select('chave, titulo, descricao, system_prompt, user_prompt_template, ativo, versao, updated_by, updated_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Nao foi possivel salvar o prompt de IA');
  }

  return normalizeRow(data);
}