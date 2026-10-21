// Regras do evento nacional de cancelamento (e101101). Sem dependências de servidor:
// também é usado pela tela para validar antes de enviar.

export type MotivoCancelamento = 1 | 2 | 9;

export const MOTIVOS_CANCELAMENTO: Record<MotivoCancelamento, string> = {
  1: 'Erro na emissão',
  2: 'Serviço não prestado',
  9: 'Outros',
};

/** Prazo de cancelamento direto no sistema em São José (IPM). No Emissor Nacional o prazo é parametrizado pelo município. */
export const PRAZO_CANCELAMENTO_DIAS = 7;

export const URL_CANCELAMENTO_PREFEITURA = 'https://saojose.sc.gov.br/cancelamento-nota-fiscal/';

export const DOCUMENTOS_FORA_DO_PRAZO = [
  'Requerimento do prestador solicitando o cancelamento',
  'Declaração do tomador (tenant) concordando com o cancelamento',
  'RG/CPF de quem assina e termo de ciência',
  'Cópia da NFS-e a cancelar',
  'Se o serviço foi prestado: emitir nota substituta',
];

export function validarPedidoCancelamento(motivo: unknown, justificativa: unknown): string | null {
  if (motivo !== 1 && motivo !== 2 && motivo !== 9) return 'Escolha o motivo do cancelamento (1, 2 ou 9).';
  const texto = typeof justificativa === 'string' ? justificativa.trim() : '';
  if (texto.length < 15 || texto.length > 255) return 'A justificativa deve ter entre 15 e 255 caracteres.';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(texto)) return 'A justificativa contém caracteres inválidos.';
  return null;
}

export interface PrazoCancelamento {
  diasDesdeEmissao: number;
  limite: string;
  dentroDoPrazo: boolean;
}

export function calcularPrazoCancelamento(emitidaEm: string, agora: Date = new Date()): PrazoCancelamento | null {
  const emissao = Date.parse(emitidaEm);
  if (!Number.isFinite(emissao)) return null;
  const limite = emissao + PRAZO_CANCELAMENTO_DIAS * 24 * 60 * 60 * 1000;
  return {
    diasDesdeEmissao: Math.max(0, Math.floor((agora.getTime() - emissao) / (24 * 60 * 60 * 1000))),
    limite: new Date(limite).toISOString(),
    dentroDoPrazo: agora.getTime() <= limite,
  };
}

export interface DadosNfseNacional {
  chaveAcesso: string;
  ambiente: 1 | 2;
  emitidaEm: string | null;
}

/** Lê chave de acesso e ambiente do XML oficial do Emissor Nacional. Retorna null para notas IPM. */
export function extrairDadosNfseNacional(xml: unknown): DadosNfseNacional | null {
  if (typeof xml !== 'string' || xml.length > 2_000_000) return null;
  const chave = xml.match(/<(?:\w+:)?infNFSe\b[^>]*\bId="NFS(\d{50})"/)?.[1];
  const ambiente = xml.match(/<(?:\w+:)?infDPS\b[\s\S]*?<(?:\w+:)?tpAmb>\s*([12])\s*</)?.[1];
  if (!chave || !ambiente) return null;
  return {
    chaveAcesso: chave,
    ambiente: ambiente === '1' ? 1 : 2,
    emitidaEm: xml.match(/<(?:\w+:)?dhProc>\s*([^<\s]+)\s*</)?.[1] || null,
  };
}

/** Data/hora no formato exigido pelo leiaute (sem milissegundos, com fuso). */
export function dataHoraEvento(agora: Date = new Date()): string {
  // Pequena folga para não ser recusado por relógio adiantado em relação ao Sefin.
  return new Date(agora.getTime() - 30_000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
