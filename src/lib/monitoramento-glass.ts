export type TabelaMetrica = {
  nome: string;
  bytes: number;
  linhas_vivas_estimadas: number | null;
  linhas_mortas_estimadas: number | null;
  ultimo_autovacuum: string | null;
};
export type TabelaAtual = Omit<TabelaMetrica, 'bytes'> & {
  bytes: number | null;
  tipo: 'tabela' | 'particionada' | 'externa' | 'materializada';
};
export type ListaTabelas = { consultado_em: string; tabelas: TabelaAtual[] };

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
export type AmostraStorage = { coletado_em: string; bytes_conhecidos: number; objetos: number; objetos_sem_tamanho: number };
export type TabelaIntegridade = {
  nome: string;
  status: 'sem_problemas_detectados' | 'problemas' | 'erro_verificacao';
  ocorrencias_primeiro_bloco?: number;
  codigo?: string;
};
export type ResultadoIntegridade = { iniciado_em: string; concluido_em: string; tabelas: TabelaIntegridade[] };
export type IndiceIntegridade = {
  nome: string;
  status: 'sem_problemas_detectados' | 'problemas' | 'erro_verificacao' | 'indice_invalido';
  codigo?: string;
};
export type ResultadoIndices = { iniciado_em: string; concluido_em: string; indices: IndiceIntegridade[] };
export type RelacionamentoVerificado = {
  tabela: string;
  restricao: string;
} & ({ status: 'sem_ocorrencias' | 'possivel_violacao' } | { status: 'erro_verificacao'; codigo: string });
export type ArquivosVerificados = {
  tabela: string;
} & ({ status: 'verificado'; registros: number; sem_metadados: number } | { status: 'erro_verificacao'; codigo: string });
export type RegraVerificada = {
  nome: string;
} & ({ status: 'sem_ocorrencias' | 'possivel_violacao' } | { status: 'erro_verificacao'; codigo: string });
export type ResultadoReferencias = {
  iniciado_em: string;
  concluido_em: string;
  relacionamentos: RelacionamentoVerificado[];
  arquivos: ArquivosVerificados[];
  regras: RegraVerificada[];
};

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

function validarTabela(value: unknown): value is TabelaMetrica {
  return objeto(value) && typeof value.nome === 'string' && numero(value.bytes)
    && numeroOuNulo(value.linhas_vivas_estimadas) && numeroOuNulo(value.linhas_mortas_estimadas)
    && (value.ultimo_autovacuum === null || data(value.ultimo_autovacuum));
}

export function validarListaTabelas(value: unknown): value is ListaTabelas {
  return objeto(value) && data(value.consultado_em) && Array.isArray(value.tabelas)
    && value.tabelas.every((t: unknown) => objeto(t) && typeof t.nome === 'string'
      && (t.tipo === 'tabela' || t.tipo === 'particionada' || t.tipo === 'externa' || t.tipo === 'materializada')
      && numeroOuNulo(t.bytes) && numeroOuNulo(t.linhas_vivas_estimadas)
      && numeroOuNulo(t.linhas_mortas_estimadas) && (t.ultimo_autovacuum === null || data(t.ultimo_autovacuum)))
    && new Set(value.tabelas.map((t: unknown) => objeto(t) ? t.nome : null)).size === value.tabelas.length;
}

export function validarStorage(value: unknown): value is AmostraStorage | null {
  return value === null || (objeto(value) && data(value.coletado_em)
    && Number.isSafeInteger(value.bytes_conhecidos) && numero(value.bytes_conhecidos)
    && Number.isSafeInteger(value.objetos) && numero(value.objetos)
    && Number.isSafeInteger(value.objetos_sem_tamanho) && numero(value.objetos_sem_tamanho)
    && value.objetos_sem_tamanho <= value.objetos);
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
      && Array.isArray(m.maiores_tabelas) && m.maiores_tabelas.every(validarTabela);
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

export function validarIndices(value: unknown): value is ResultadoIndices | null {
  return value === null || (objeto(value) && data(value.iniciado_em) && data(value.concluido_em)
    && Array.isArray(value.indices) && value.indices.every((i: unknown) => objeto(i)
      && typeof i.nome === 'string'
      && (i.status === 'sem_problemas_detectados' || i.status === 'indice_invalido'
        || ((i.status === 'problemas' || i.status === 'erro_verificacao')
          && typeof i.codigo === 'string' && /^[0-9A-Z]{5}$/.test(i.codigo)))));
}

export function validarReferencias(value: unknown): value is ResultadoReferencias | null {
  return value === null || (objeto(value) && data(value.iniciado_em) && data(value.concluido_em)
    && Array.isArray(value.relacionamentos) && value.relacionamentos.every((r: unknown) => objeto(r)
      && typeof r.tabela === 'string' && typeof r.restricao === 'string'
      && (r.status === 'sem_ocorrencias' || r.status === 'possivel_violacao'
        || (r.status === 'erro_verificacao' && typeof r.codigo === 'string' && /^[0-9A-Z]{5}$/.test(r.codigo))))
    && Array.isArray(value.arquivos) && value.arquivos.length === 4
    && new Set(value.arquivos.map((a: unknown) => objeto(a) ? a.tabela : null)).size === 4
    && value.arquivos.every((a: unknown) => objeto(a)
      && typeof a.tabela === 'string'
      && ['orcamento_anexos', 'os_anexos', 'fin_lancamentos_anexos', 'internal_chat_attachments'].includes(a.tabela)
      && ((a.status === 'verificado' && numero(a.registros) && Number.isSafeInteger(a.registros)
        && numero(a.sem_metadados) && Number.isSafeInteger(a.sem_metadados) && a.sem_metadados <= a.registros)
        || (a.status === 'erro_verificacao' && typeof a.codigo === 'string' && /^[0-9A-Z]{5}$/.test(a.codigo))))
    && Array.isArray(value.regras) && value.regras.length === 4
    && new Set(value.regras.map((r: unknown) => objeto(r) ? r.nome : null)).size === 4
    && value.regras.every((r: unknown) => objeto(r) && typeof r.nome === 'string'
      && ['orcamento_anexo_empresa', 'orcamento_historico_empresa', 'financeiro_anexo_empresa', 'financeiro_anexo_baixa'].includes(r.nome)
      && (r.status === 'sem_ocorrencias' || r.status === 'possivel_violacao'
        || (r.status === 'erro_verificacao' && typeof r.codigo === 'string' && /^[0-9A-Z]{5}$/.test(r.codigo)))));
}
