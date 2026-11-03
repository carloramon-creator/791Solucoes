import type { SupabaseClient } from '@supabase/supabase-js';
import type { DPSData as DadosIpm } from '@/lib/nfse/types';
import { dataHoraNacional } from './data-hora';
import { enderecoTomadorNacional } from './endereco-tomador';
import { calcularSimples, mesesAnteriores, type HistoricoFiscal } from './simples-nacional';
import nacional from './providers/national';
import { lerDocumentoOficial } from './documento-oficial';
import xmlService, { type DPSData } from './xml-service';

export interface ConfigNacional {
  enabled: boolean;
  enquadramentoConfirmado: boolean;
  municipioEmissao: string;
  serie: string;
  codigoTributacaoNacional: string;
  codigoNbs: string;
  historico: HistoricoFiscal;
}

export const usaNacional = (competencia: string) => competencia >= '2026-11-01';

export async function receitasFiscais(supabase: SupabaseClient, competencia?: string): Promise<Record<string, number>> {
  const totais: Record<string, number> = {};
  const janela = competencia ? new Set(mesesAnteriores(competencia)) : null;
  const chaves = new Set<string>();
  const incluidas = new Map<string, { mes: string; valor: number }>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('system_invoices').select('id, status, value, metadata')
      .order('id', { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`Não foi possível apurar a receita fiscal: ${error.message}`);
    for (const nota of data || []) {
      const meta = nota.metadata || {};
      if (nota.status === 'cancelled' && meta.operacao_nacional) {
        chaves.add(meta.operacao_nacional);
        const anterior = incluidas.get(meta.operacao_nacional);
        if (anterior) {
          totais[anterior.mes] -= anterior.valor;
          incluidas.delete(meta.operacao_nacional);
        }
      }
      if (nota.status !== 'authorized') continue;
      if (meta.ambiente === 'homologacao' || /<tpAmb>\s*2\s*<\/tpAmb>/.test(meta.nfse_oficial_xml || meta.xml || '')) continue;
      const mes = meta.competencia?.slice(0, 7) || meta.mes_ref;
      if (!/^\d{4}-\d{2}$/.test(mes || '')) throw new Error('Nota autorizada sem competência fiscal: revise o histórico antes de emitir.');
      const valor = typeof nota.value === 'number' ? nota.value
        : typeof nota.value === 'string' && nota.value.trim() ? Number(nota.value) : NaN;
      if (!Number.isFinite(valor) || valor < 0) throw new Error('Nota com valor fiscal inválido.');
      const chave = meta.operacao_nacional || meta.asaas_payment_id || nota.id;
      if (chaves.has(chave)) continue;
      chaves.add(chave);
      totais[mes] = (totais[mes] || 0) + valor;
      incluidas.set(chave, { mes, valor });
    }
    if (!data || data.length < 500) break;
  }
  // Recupera receitas autorizadas mesmo se a gravação do histórico visual falhou.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('system_settings').select('id, value')
      .like('id', 'nfse_producao_%').order('id', { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`Não foi possível ler o controle fiscal nacional: ${error.message}`);
    for (const registro of data || []) {
      const value = registro.value;
      if (janela?.has(value?.competencia?.slice(0, 7)) && ['enviando', 'verificar_no_portal'].includes(value?.status)) {
        throw new Error('Resultado nacional anterior incerto: consulte o emissor e reconcilie a receita antes de calcular o RBT12.');
      }
      if (value?.status !== 'authorized' || chaves.has(registro.id)) continue;
      const mes = value.competencia?.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(mes || '') || !Number.isFinite(value.valor)) throw new Error('Controle fiscal nacional inconsistente.');
      totais[mes] = (totais[mes] || 0) + value.valor;
    }
    if (!data || data.length < 500) break;
  }
  return totais;
}

async function proximoNumero(supabase: SupabaseClient, serie: string): Promise<string> {
  const id = `nfse_sequencia_producao_${serie}`;
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const { data, error } = await supabase.from('system_settings').select('value').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const { error: insertError } = await supabase.from('system_settings').insert({ id, value: { numero: 1 }, updated_at: new Date().toISOString() });
      if (!insertError) return '1';
      if (insertError.code !== '23505') throw insertError;
      continue;
    }
    const atual = data.value.numero;
    if (!Number.isSafeInteger(atual) || atual < 1 || atual >= 999999999999999) throw new Error('Sequência nacional inválida ou esgotada.');
    const { data: atualizado, error: updateError } = await supabase.from('system_settings')
      .update({ value: { numero: atual + 1 }, updated_at: new Date().toISOString() })
      .eq('id', id).eq('value', JSON.stringify(data.value)).select('id').maybeSingle();
    if (updateError) throw updateError;
    if (atualizado) return String(atual + 1);
  }
  throw new Error('Não foi possível reservar um número nacional devido a concorrência. Nenhuma DPS foi enviada.');
}

export async function emitirNacionalProducao({
  supabase, config, dados, tenant, competencia, operacao, previsualizar = false,
}: {
  supabase: SupabaseClient;
  config: Record<string, unknown>;
  dados: DadosIpm;
  tenant: Record<string, unknown>;
  competencia: string;
  operacao: string;
  previsualizar?: boolean;
}) {
  const parametros = config.nacional as ConfigNacional | undefined;
  if (!parametros?.enabled || config.environment !== 'producao') {
    throw new Error('Emissão nacional de produção não ativada. Competências desde 01/11/2026 não podem ser enviadas à IPM.');
  }
  if (!parametros.enquadramentoConfirmado) throw new Error('Enquadramento do Simples pendente de confirmação. Nenhuma nota real será enviada.');
  if (competencia.slice(0, 4) !== '2026') throw new Error('Revise a parametrização IBS/CBS para 2027 antes de emitir.');
  if (!/^\d{1,5}$/.test(parametros.serie) || Number(parametros.serie) < 1 || Number(parametros.serie) > 49999
    || !/^\d{7}$/.test(parametros.municipioEmissao)
    || parametros.codigoTributacaoNacional !== '010501' || parametros.codigoNbs !== '111032200') {
    throw new Error('Parametrização nacional de licenciamento inválida.');
  }
  const apuracao = calcularSimples(competencia.slice(0, 7), parametros.historico, await receitasFiscais(supabase, competencia.slice(0, 7)));
  const endereco = await enderecoTomadorNacional(tenant);
  const documento = String(tenant.cnpj || '').replace(/\D/g, '');
  if (typeof config.pfxBase64 !== 'string' || typeof config.passphrase !== 'string') throw new Error('Certificado A1 da holding não configurado.');
  const id = `nfse_producao_${operacao}`;
  const registro = { status: 'preparando', competencia, valor: dados.servico.valorServicos, operacao, tenant_id: tenant.id };
  if (!previsualizar) {
    const { error } = await supabase.from('system_settings').insert({ id, value: registro, updated_at: new Date().toISOString() });
    if (error?.code === '23505') throw new Error('Operação fiscal já reservada/enviada. Consulte o resultado antes de repetir; não altere a referência.');
    if (error) throw error;
  }
  const data: DPSData = {
    ambiente: 1, numero: previsualizar ? '1' : await proximoNumero(supabase, parametros.serie),
    serie: parametros.serie, dataEmissao: dataHoraNacional(),
    prestador: { cnpj: dados.prestador.cnpj.replace(/\D/g, ''), inscricaoMunicipal: dados.prestador.inscricaoMunicipal || '' },
    tomador: { ...(documento.length === 11 ? { cpf: documento } : { cnpj: documento }), razaoSocial: dados.tomador.razaoSocial, email: dados.tomador.email, endereco },
    servico: dados.servico,
    nacional: {
      municipioEmissao: parametros.municipioEmissao, municipioPrestacao: parametros.municipioEmissao,
      competencia, codigoTributacaoNacional: parametros.codigoTributacaoNacional,
      codigoNbs: parametros.codigoNbs, percentualTributosSimples: apuracao.percentual, regimeConfirmado: 'simples-me-epp',
    },
  };
  const xml = xmlService.generateDPS(data);
  const metadata = {
    ambiente: 'producao', competencia, provider: 'nacional', operacao_nacional: id,
    simples_nacional: apuracao, dps_xml: xml, numero_dps: data.numero, serie_dps: data.serie,
  };
  if (previsualizar) return { xml, apuracao, metadata };
  const pendente = { ...registro, status: 'enviando', ...metadata };
  const { error: erroGravar } = await supabase.from('system_settings')
    .update({ value: pendente, updated_at: new Date().toISOString() }).eq('id', id).select('id').single();
  if (erroGravar) throw erroGravar;
  let resultadoAutorizado: Awaited<ReturnType<typeof nacional.emit>> | undefined;
  try {
    const result = await nacional.emit(data, config.pfxBase64, config.passphrase);
    resultadoAutorizado = result;
    if (!result.xml) throw new Error('NFS-e nacional sem XML oficial.');
    const documentoOficial = lerDocumentoOficial(result.xml);
    const { error } = await supabase.from('system_settings').update({
      value: { ...pendente, status: 'authorized', result }, updated_at: new Date().toISOString(),
    }).eq('id', id).select('id').single();
    if (error) throw new Error(`Nota autorizada, mas falhou a persistência do resultado: ${error.message}. Não reenvie.`);
    return { result, metadata: { ...metadata, nfse_oficial_xml: result.xml, documento_oficial: documentoOficial } };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    const { error } = await supabase.from('system_settings').update({
      value: { ...pendente, status: resultadoAutorizado ? 'authorized' : 'verificar_no_portal',
        ...(resultadoAutorizado ? { result: resultadoAutorizado } : {}), erro: mensagem }, updated_at: new Date().toISOString(),
    }).eq('id', id).select('id').single();
    if (error) console.error('[NFS-e produção] Falha ao persistir erro:', error.message);
    throw err;
  }
}
