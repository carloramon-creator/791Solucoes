export const funcoesConsumoIA: Record<string, string> = {
  'credito.validacao': 'Validação da IA de crédito',
  'credito.analise': 'Análise de crédito',
  'estoque.analise': 'Análise de compras / estoque',
  'financeiro.custos': 'Análise de custos / DRE',
};

export type TenantConsumoIA = {
  tenant_id: string;
  nome: string;
  chamadas: number;
  chamadas_com_consumo: number;
  erros: number;
  pendentes: number;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_total: number;
};

export type EventoConsumoIA = {
  id: string;
  tenant_id: string;
  usuario_id: string;
  funcao: string;
  referencia_id: string | null;
  prompt_chave: string | null;
  prompt_versao: number | null;
  provider: string;
  model: string;
  tentativa: number;
  status: 'em_andamento' | 'concluida' | 'erro';
  tokens_entrada: number | null;
  tokens_saida: number | null;
  tokens_total: number | null;
  tokens_cache: number | null;
  http_status: number | null;
  erro_codigo: string | null;
  created_at: string;
};

export type RelatorioConsumoIA = {
  total: number;
  pagina: number;
  tenants: TenantConsumoIA[];
  eventos: EventoConsumoIA[];
};

export function parametrosConsumoIA(params: URLSearchParams) {
  const inicio = params.get('inicio') || '';
  const fim = params.get('fim') || '';
  const tenant = params.get('tenant') || null;
  const funcao = params.get('funcao') || null;
  const paginaTexto = params.get('pagina') || '1';
  const dataValida = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!dataValida(inicio) || !dataValida(fim) || inicio > fim) throw new Error('Informe um intervalo de datas válido.');
  const start = new Date(`${inicio}T00:00:00-03:00`);
  const end = new Date(Date.parse(`${fim}T00:00:00-03:00`) + 86400000);
  if (end.getTime() - start.getTime() > 366 * 86400000) throw new Error('Selecione no máximo 366 dias por relatório.');
  if (tenant && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) throw new Error('Tenant inválido.');
  if (funcao && !Object.hasOwn(funcoesConsumoIA, funcao)) throw new Error('Função de IA inválida.');
  if (!/^[1-9]\d{0,5}$/.test(paginaTexto)) throw new Error('Página inválida.');
  return { p_inicio: start.toISOString(), p_fim: end.toISOString(), p_tenant: tenant, p_funcao: funcao, p_pagina: Number(paginaTexto) };
}
