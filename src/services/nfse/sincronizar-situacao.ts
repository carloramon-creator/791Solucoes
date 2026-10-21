import { supabaseServer } from '@/lib/supabase-server';
import ipmProvider from '@/lib/nfse/providers/ipm';
import { lerRetornoIpm } from './danfse-snapshot';
import { lerDocumentoOficial } from './documento-oficial';

// Confere na prefeitura a situação das NFS-e autorizadas e marca como canceladas
// as que foram canceladas lá (ex.: cancelamento feito direto no portal).

export interface ResultadoSincronizacao {
  executado_em: string;
  verificadas: number;
  canceladas: string[];
  erro: string | null;
}

const INTERVALO_AUTOMATICO_MS = 10 * 60 * 1000;
let ultimo: ResultadoSincronizacao | null = null;
let emAndamento: Promise<ResultadoSincronizacao> | null = null;

type Dados = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function codigoAutenticidade(inv: Dados): string | null {
  const candidatos = [
    inv.metadata?.danfse?.retorno?.codigo_verificacao,
    lerRetornoIpm(inv.metadata?.xml).codigo_verificacao,
    String(inv.access_link || '').split('/').pop(),
  ];
  return candidatos.map(c => String(c || '').replace(/\D/g, '')).find(c => c.length >= 30) || null;
}

async function executar(): Promise<ResultadoSincronizacao> {
  const resultado: ResultadoSincronizacao = { executado_em: new Date().toISOString(), verificadas: 0, canceladas: [], erro: null };

  const { data: cfg } = await supabaseServer.from('system_settings').select('value').eq('id', 'nfse_config').single();
  const config = cfg?.value as Dados | undefined;
  if (!config?.ipm_username || !config?.ipm_password || !config?.municipal_code) {
    resultado.erro = 'Credenciais da IPM não configuradas em Configurações NFS-e.';
    return resultado;
  }

  const { data: notas, error } = await supabaseServer
    .from('system_invoices')
    .select('id, invoice_number, status, access_link, metadata')
    .eq('status', 'authorized');
  if (error) {
    resultado.erro = `Erro ao ler notas: ${error.message}`;
    return resultado;
  }

  const credentials = { username: config.ipm_username, password: config.ipm_password, municipal_code: config.municipal_code };

  for (const inv of notas || []) {
    const codigo = codigoAutenticidade(inv);
    if (!codigo) continue;

    const consulta = await ipmProvider.consultar(codigo, credentials);
    if (!consulta.ok) {
      // Para no primeiro erro para não bloquear o usuário da IPM com tentativas repetidas.
      resultado.erro = consulta.httpStatus === 401
        ? `A prefeitura recusou o acesso (401 – ${consulta.erro}). Confira usuário/senha IPM em Configurações NFS-e.`
        : `Prefeitura respondeu com erro na nota ${inv.invoice_number}: ${consulta.erro}`;
      break;
    }

    resultado.verificadas++;
    const situacao_prefeitura = {
      situacao: consulta.situacao,
      codigo: consulta.codigo,
      consultado_em: new Date().toISOString(),
    };
    const cancelada = /cancel/i.test(consulta.situacao);
    let documento;
    try {
      documento = lerDocumentoOficial(consulta.xml);
    } catch (err) {
      resultado.erro = `A consulta da nota ${inv.invoice_number} não retornou o documento completo: ${err instanceof Error ? err.message : String(err)}`;
    }
    const { error: erroUpdate } = await supabaseServer
      .from('system_invoices')
      .update({
        ...(cancelada ? { status: 'cancelled' } : {}),
        metadata: {
          ...inv.metadata, situacao_prefeitura,
          ...(documento ? { nfse_oficial_xml: consulta.xml, documento_oficial: documento } : {}),
        },
      })
      .eq('id', inv.id)
      .eq('status', 'authorized');
    if (erroUpdate) {
      resultado.erro = `Erro ao gravar a situação da nota ${inv.invoice_number}: ${erroUpdate.message}`;
      break;
    }
    if (cancelada) resultado.canceladas.push(inv.invoice_number);
    if (resultado.erro) break;
  }

  return resultado;
}

/** Sincroniza com a prefeitura. Chamadas automáticas reaproveitam o resultado dos últimos 10 minutos. */
export async function sincronizarSituacaoNfse({ forcar = false } = {}): Promise<ResultadoSincronizacao> {
  if (emAndamento) return emAndamento;
  if (!forcar && ultimo && Date.now() - Date.parse(ultimo.executado_em) < INTERVALO_AUTOMATICO_MS) return ultimo;
  emAndamento = executar()
    .then(r => (ultimo = r))
    .finally(() => { emAndamento = null; });
  return emAndamento;
}
