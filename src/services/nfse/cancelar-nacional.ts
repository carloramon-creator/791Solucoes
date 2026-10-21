import { supabaseServer } from '@/lib/supabase-server';
import nationalProvider, { NfseJaCanceladaError } from './providers/national';
import {
  MOTIVOS_CANCELAMENTO, dataHoraEvento, extrairDadosNfseNacional, validarPedidoCancelamento,
  type MotivoCancelamento,
} from './cancelamento';

export class CancelamentoError extends Error {
  constructor(message: string, public readonly status: number, public readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface RegistroCancelamento {
  status: 'registrado' | 'ja_cancelada_no_portal';
  motivo: MotivoCancelamento;
  motivo_descricao: string;
  justificativa: string;
  solicitado_por: string | null;
  solicitado_em: string;
  chave_acesso: string;
  ambiente: 1 | 2;
  evento_id?: string;
  processado_em?: string | null;
  evento_xml?: string;
  detalhe?: string;
}

/** Lê e valida o corpo `{ motivo, justificativa }` enviado pela tela. */
export async function lerPedido(req: Request): Promise<{ motivo: MotivoCancelamento; justificativa: string }> {
  let body: Record<string, unknown>;
  try {
    const json: unknown = await req.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error();
    body = json as Record<string, unknown>;
  } catch {
    throw new CancelamentoError('Corpo JSON inválido.', 400);
  }
  const erro = validarPedidoCancelamento(body.motivo, body.justificativa);
  if (erro) throw new CancelamentoError(erro, 400);
  return { motivo: body.motivo as MotivoCancelamento, justificativa: String(body.justificativa).trim() };
}

/**
 * Envia o evento e101101 ao Emissor Nacional. Não mexe em cobrança/Asaas:
 * o estorno financeiro, se houver, é decidido à parte pelo administrador.
 */
export async function cancelarNoEmissorNacional(params: {
  xmlOficial: unknown;
  motivo: MotivoCancelamento;
  justificativa: string;
  usuario: string | null;
  ambienteEsperado?: 1 | 2;
}): Promise<RegistroCancelamento> {
  const nacional = extrairDadosNfseNacional(params.xmlOficial);
  if (!nacional) {
    throw new CancelamentoError(
      'Esta nota não foi emitida pelo Emissor Nacional (não há chave de acesso de 50 dígitos). Notas da IPM são canceladas no portal da prefeitura.',
      422, { ipm: true },
    );
  }
  if (params.ambienteEsperado && nacional.ambiente !== params.ambienteEsperado) {
    throw new CancelamentoError('O ambiente da nota (produção/homologação) não corresponde a esta operação.', 422);
  }
  const { data: cfg, error } = await supabaseServer.from('system_settings').select('value').eq('id', 'nfse_config').single();
  if (error) throw new CancelamentoError(`Configuração NFS-e indisponível: ${error.message}`, 500);
  const config = (cfg?.value || {}) as Record<string, unknown>;
  const cnpjAutor = String(config.prestador_cnpj || '').replace(/\D/g, '');
  if (!config.pfxBase64 || !config.passphrase) {
    throw new CancelamentoError('Cadastre o certificado A1 da holding e sua senha antes de cancelar.', 422);
  }
  if (!/^\d{14}$/.test(cnpjAutor)) throw new CancelamentoError('CNPJ do prestador não configurado em Configurações NFS-e.', 422);
  const base = {
    motivo: params.motivo,
    motivo_descricao: MOTIVOS_CANCELAMENTO[params.motivo],
    justificativa: params.justificativa,
    solicitado_por: params.usuario,
    solicitado_em: new Date().toISOString(),
    chave_acesso: nacional.chaveAcesso,
    ambiente: nacional.ambiente,
  };
  try {
    const result = await nationalProvider.cancelar({
      chaveAcesso: nacional.chaveAcesso, cnpjAutor, ambiente: nacional.ambiente,
      dataEvento: dataHoraEvento(), motivo: params.motivo, justificativa: params.justificativa,
    }, String(config.pfxBase64), String(config.passphrase));
    return { ...base, status: 'registrado', evento_id: result.idEvento, processado_em: result.processadoEm, evento_xml: result.eventoXml };
  } catch (err) {
    if (err instanceof NfseJaCanceladaError) return { ...base, status: 'ja_cancelada_no_portal', detalhe: err.detalhe };
    throw new CancelamentoError(err instanceof Error ? err.message : 'Falha no cancelamento nacional.', 502);
  }
}
