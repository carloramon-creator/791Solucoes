import type { SupabaseClient } from '@supabase/supabase-js';
import { getGlassClient } from '@/lib/glass-client';
import type { DPSData } from '@/lib/nfse/types';
import { montarSnapshotDanfse } from './danfse-snapshot';
import { emitirNacionalProducao, usaNacional } from './emissao-nacional';
import { dataHoraNacional } from './data-hora';

function getLocalIsoTimestamp() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
}

/**
 * Emissão automática da NFS-e da assinatura 791glass a partir do pagamento confirmado no Asaas.
 * Idempotente em dois níveis: dedupe por asaas_payment_id em system_invoices e reserva de
 * operação fiscal (nfse_producao_asaas_<paymentId>) dentro de emitirNacionalProducao.
 */
export async function emitirNotaAssinatura({ supabase, vidracariaId, valor, descricao, asaasPaymentId }: {
  supabase: SupabaseClient;
  vidracariaId: string;
  valor: number;
  descricao?: string;
  asaasPaymentId: string;
}) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(asaasPaymentId)) throw new Error('Identificador de pagamento inválido.');
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('Valor da nota inválido.');

  const { data: existentes, error: dedupeError } = await supabase
    .from('system_invoices')
    .select('id, invoice_number, status')
    .contains('metadata', { asaas_payment_id: asaasPaymentId })
    .neq('status', 'cancelled')
    .limit(1);
  if (dedupeError) throw dedupeError;
  if (existentes?.length) {
    return { success: true, duplicada: true, invoiceNumber: existentes[0].invoice_number, status: existentes[0].status };
  }

  const glassSupabase = await getGlassClient();
  const { data: vidracaria, error: glassError } = await glassSupabase
    .from('vidracarias')
    .select('nome, cnpj, email, endereco, endereco_completo, complemento, numero, bairro, cep, cidade, estado, inscricao_municipal')
    .eq('id', vidracariaId)
    .single();
  if (glassError || !vidracaria) throw new Error('Vidraçaria não encontrada no sistema Glass: ' + glassError?.message);

  const { data: configData, error: configError } = await supabase
    .from('system_settings')
    .select('value')
    .eq('id', 'nfse_config')
    .single();
  if (configError || !configData?.value) throw new Error('Configurações de NFS-e não encontradas na Holding.');
  const config = configData.value;

  const competencia = dataHoraNacional().slice(0, 10);
  if (!usaNacional(competencia)) throw new Error('Emissão automática disponível somente no padrão nacional (competências desde 01/11/2026).');

  const dpsData: DPSData = {
    numero: `HOLD-${Date.now()}`,
    serie: '1',
    dataEmissao: getLocalIsoTimestamp(),
    prestador: {
      cnpj: config.prestador_cnpj,
      razaoSocial: config.razao_social,
      inscricaoMunicipal: config.inscricao_municipal,
      endereco: {
        logradouro: config.logradouro, numero: config.numero, bairro: config.bairro,
        cep: config.cep, cidade: config.cidade, uf: config.estado,
      },
    },
    tomador: {
      cnpj: vidracaria.cnpj,
      razaoSocial: vidracaria.nome,
      email: vidracaria.email,
      inscricaoMunicipal: vidracaria.inscricao_municipal,
      endereco: {
        logradouro: vidracaria.endereco, numero: vidracaria.numero, bairro: vidracaria.bairro,
        cep: vidracaria.cep, cidade: vidracaria.cidade, uf: vidracaria.estado,
      },
    },
    servico: {
      valorServicos: valor,
      codigoItemListaServico: config.tax_code || '01.01.01',
      discriminacao: descricao || `Assinatura 791glass - ${vidracaria.nome}`,
      aliquota: 0,
    },
  };
  if (!dpsData.prestador.cnpj) throw new Error('CNPJ do prestador não configurado.');
  if (!dpsData.tomador.cnpj) throw new Error('A vidraçaria (tomador) não possui CNPJ/CPF cadastrado.');
  if (!dpsData.tomador.endereco?.logradouro && !vidracaria.endereco_completo) throw new Error('O endereço da vidraçaria está incompleto.');

  const emissao = await emitirNacionalProducao({
    supabase, config, dados: dpsData, tenant: { ...vidracaria, id: vidracariaId },
    competencia, operacao: `asaas_${asaasPaymentId}`,
  });
  if (!emissao.result) throw new Error('A emissão nacional não retornou resultado.');
  const result = emissao.result;

  const { error: invoiceError } = await supabase
    .from('system_invoices')
    .insert([{
      invoice_number: result.invoiceId || dpsData.numero,
      status: result.status,
      client_name: vidracaria.nome,
      client_document: vidracaria.cnpj,
      client_email: vidracaria.email,
      value: valor,
      access_link: result.accessLink,
      error_message: result.success ? null : result.message,
      metadata: {
        vidracaria_id: vidracariaId,
        asaas_payment_id: asaasPaymentId,
        origem: 'webhook_asaas',
        xml: result.xml,
        danfse: montarSnapshotDanfse({ dpsData, config, retornoXml: result.xml, accessLink: result.accessLink }),
        ...emissao.metadata, competencia, mes_ref: competencia.slice(0, 7),
      },
    }]);
  if (invoiceError) {
    console.error('[NFS-e automática] Nota enviada ao emissor, mas falhou ao salvar histórico:', invoiceError);
    throw new Error('Nota enviada ao emissor fiscal, mas houve erro ao salvar histórico. Não reenvie: ' + invoiceError.message);
  }
  return { success: result.success, duplicada: false, invoiceNumber: result.invoiceId || dpsData.numero, status: result.status, accessLink: result.accessLink };
}
