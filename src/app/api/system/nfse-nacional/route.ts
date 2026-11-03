import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { calcularSimples, mesesAnteriores } from '@/services/nfse/simples-nacional';
import { receitasFiscais, type ConfigNacional } from '@/services/nfse/emissao-nacional';
import { dataHoraNacional } from '@/services/nfse/data-hora';

function objeto(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuração fiscal inválida.');
  return value as Record<string, unknown>;
}

function valoresMensais(value: unknown): Record<string, number> {
  const resultado: Record<string, number> = {};
  for (const [mes, valor] of Object.entries(objeto(value))) {
    mesesAnteriores(mes);
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) throw new Error(`Valor mensal inválido em ${mes}.`);
    resultado[mes] = valor;
  }
  return resultado;
}

function validar(value: unknown): ConfigNacional {
  const config = objeto(value);
  const historico = objeto(config.historico);
  if (typeof config.enabled !== 'boolean' || typeof config.enquadramentoConfirmado !== 'boolean' || typeof historico.semFolha !== 'boolean' || typeof historico.semReceitasExternas !== 'boolean'
    || typeof historico.inicioAtividade !== 'string' || historico.apuracao !== 'competencia'
    || typeof historico.historicoConfirmadoAte !== 'string'
    || typeof config.serie !== 'string' || !/^\d{1,5}$/.test(config.serie)
    || Number(config.serie) < 1 || Number(config.serie) > 49999
    || typeof config.municipioEmissao !== 'string' || !/^\d{7}$/.test(config.municipioEmissao)
    || config.codigoTributacaoNacional !== '010501' || config.codigoNbs !== '111032200') {
    throw new Error('Configure licenciamento (010501/111032200), série de 1 a 49999, município IBGE e histórico por competência.');
  }
  mesesAnteriores(historico.historicoConfirmadoAte);
  if (config.enabled && !config.enquadramentoConfirmado) throw new Error('Confirme o enquadramento e a base fiscal antes de ativar produção.');
  return {
    enabled: config.enabled, enquadramentoConfirmado: config.enquadramentoConfirmado, serie: config.serie, municipioEmissao: config.municipioEmissao,
    codigoTributacaoNacional: config.codigoTributacaoNacional, codigoNbs: config.codigoNbs,
    historico: {
      inicioAtividade: historico.inicioAtividade, apuracao: 'competencia', semFolha: historico.semFolha,
      semReceitasExternas: historico.semReceitasExternas,
      historicoConfirmadoAte: historico.historicoConfirmadoAte,
      receitasExternas: valoresMensais(historico.receitasExternas), folha: valoresMensais(historico.folha),
    },
  };
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { data, error } = await supabaseServer.from('system_settings').select('value, updated_at').eq('id', 'nfse_config').single();
    if (error) throw error;
    const competencia = dataHoraNacional().slice(0, 7);
    const config = data.value.nacional ? validar(data.value.nacional) : null;
    const receitas = await receitasFiscais(supabaseServer, competencia);
    let apuracao = null, apuracaoErro = '';
    if (config) {
      try { apuracao = calcularSimples(competencia, config.historico, receitas); }
      catch (err) { apuracaoErro = err instanceof Error ? err.message : String(err); }
    }
    return NextResponse.json({
      config, competencia, receitasSistema: receitas,
      apuracao, apuracaoErro,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[NFS-e configuração nacional]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const config = validar(await req.json());
    const competencia = dataHoraNacional().slice(0, 7);
    const apuracao = calcularSimples(competencia, config.historico, await receitasFiscais(supabaseServer, competencia));
    const { data, error } = await supabaseServer.from('system_settings').select('value, updated_at').eq('id', 'nfse_config').single();
    if (error) throw error;
    if (config.enabled && (data.value.environment !== 'producao' || !data.value.pfxBase64 || !data.value.passphrase)) {
      throw new Error('Produção e certificado A1 precisam estar configurados antes de ativar.');
    }
    const query = supabaseServer.from('system_settings').update({
      value: { ...data.value, nacional: config }, updated_at: new Date().toISOString(),
    }).eq('id', 'nfse_config');
    const versionada = data.updated_at == null
      ? query.is('updated_at', null) : query.eq('updated_at', data.updated_at);
    const { error: saveError } = await versionada.select('id').single();
    if (saveError) throw new Error(`Configuração não salva; recarregue e tente novamente: ${saveError.message}`);
    return NextResponse.json({ success: true, config, apuracao });
  } catch (err) {
    console.error('[NFS-e configuração nacional]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
