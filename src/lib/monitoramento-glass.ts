export type TabelaMetrica = {
  nome: string;
  bytes: number;
  linhas_vivas_estimadas: number | null;
  linhas_mortas_estimadas: number | null;
  ultimo_autovacuum: string | null;
};

export type MetricasBanco = {
  banco_bytes: number;
  tabelas_publicas: number;
  restricoes_nao_validadas: number;
  conexoes: number;
  conexoes_ativas: number | null;
  aguardando_bloqueio: number | null;
  limite_conexoes_servidor: number;
  cache_percentual: number | null;
  estatisticas_ativas: boolean;
  linhas_mortas_estimadas: number | null;
  maiores_tabelas: TabelaMetrica[];
};

export type AmostraBanco = { coletado_em: string; metricas: MetricasBanco };
export type TabelaIntegridade = {
  nome: string;
  status: 'sem_problemas_detectados' | 'problemas' | 'erro_verificacao';
  ocorrencias_primeiro_bloco?: number;
  codigo?: string;
};
export type ResultadoIntegridade = { iniciado_em: string; concluido_em: string; tabelas: TabelaIntegridade[] };

function objeto(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numero(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function data(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function numeroOuNulo(value: unknown): value is number | null {
  return value === null || numero(value);
}

export function validarHistorico(value: unknown): value is AmostraBanco[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (!objeto(item) || !data(item.coletado_em) || !objeto(item.metricas)) return false;
    const m = item.metricas;
    return numero(m.banco_bytes) && numero(m.tabelas_publicas) && numero(m.restricoes_nao_validadas)
      && numero(m.conexoes) && numeroOuNulo(m.conexoes_ativas) && numeroOuNulo(m.aguardando_bloqueio)
      && numero(m.limite_conexoes_servidor) && numeroOuNulo(m.cache_percentual)
      && (m.cache_percentual === null || m.cache_percentual <= 100)
      && typeof m.estatisticas_ativas === 'boolean' && numeroOuNulo(m.linhas_mortas_estimadas)
      && Array.isArray(m.maiores_tabelas) && m.maiores_tabelas.every((t: unknown) => objeto(t)
        && typeof t.nome === 'string' && numero(t.bytes) && numeroOuNulo(t.linhas_vivas_estimadas)
        && numeroOuNulo(t.linhas_mortas_estimadas) && (t.ultimo_autovacuum === null || data(t.ultimo_autovacuum)));
  });
}

export function validarIntegridade(value: unknown): value is ResultadoIntegridade | null {
  return value === null || (objeto(value) && data(value.iniciado_em) && data(value.concluido_em)
    && Array.isArray(value.tabelas) && value.tabelas.every((t: unknown) => objeto(t)
      && typeof t.nome === 'string'
      && ((t.status === 'sem_problemas_detectados' && numero(t.ocorrencias_primeiro_bloco) && t.ocorrencias_primeiro_bloco === 0)
        || (t.status === 'problemas' && numero(t.ocorrencias_primeiro_bloco) && t.ocorrencias_primeiro_bloco > 0)
        || (t.status === 'erro_verificacao' && typeof t.codigo === 'string'))));
}
