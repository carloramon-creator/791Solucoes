import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { getGlassClient } from '@/lib/glass-client';
import xmlService, { type DPSData } from '@/services/nfse/xml-service';
import nationalProvider from '@/services/nfse/providers/national';
import { lerDocumentoOficial } from '@/services/nfse/documento-oficial';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^DPS\d{42}$/.test(id)) return NextResponse.json({ error: 'Identificador da DPS inválido.' }, { status: 400 });
  const { data, error } = await supabaseServer.from('system_settings').select('value')
    .eq('id', `nfse_homologacao_${id}`).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Teste não encontrado.' }, { status: 404 });
  return NextResponse.json(data.value, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    const json: unknown = await req.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Corpo inválido.');
    body = json as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo JSON inválido.' }, { status: 400 });
  }
  const texto = (campo: string) => typeof body[campo] === 'string' ? body[campo].trim() : '';
  if (!texto('vidracaria_id') || body.regimeConfirmado !== true) {
    return NextResponse.json({ error: 'Informe o tenant e confirme com o contador o regime ME/EPP, ISS no Simples, sem regime especial e operação tributável sem retenção.' }, { status: 400 });
  }
  try {
    const { data: settings, error: erroConfig } = await supabaseServer.from('system_settings')
      .select('value').eq('id', 'nfse_config').single();
    if (erroConfig) throw erroConfig;
    const config = settings.value;
    const glass = await getGlassClient();
    const { data: tenant, error: erroTenant } = await glass.from('vidracarias')
      .select('nome, cnpj, email').eq('id', texto('vidracaria_id')).single();
    if (erroTenant || !tenant) return NextResponse.json({ error: 'Tenant não encontrado.' }, { status: 404 });
    const documento = String(tenant.cnpj || '').replace(/\D/g, '');
    const data: DPSData = {
      numero: texto('numero'), serie: texto('serie'),
      dataEmissao: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      prestador: { cnpj: String(config.prestador_cnpj || '').replace(/\D/g, ''), inscricaoMunicipal: String(config.inscricao_municipal || '') },
      tomador: {
        ...(documento.length === 11 ? { cpf: documento } : { cnpj: documento }),
        razaoSocial: tenant.nome, email: tenant.email || undefined,
      },
      servico: {
        valorServicos: typeof body.valor === 'number' ? body.valor : NaN,
        discriminacao: texto('descricao'), codigoItemListaServico: texto('codigoTributacaoNacional'),
      },
      nacional: {
        municipioEmissao: texto('municipioEmissao'), municipioPrestacao: texto('municipioPrestacao'),
        competencia: texto('competencia'), codigoTributacaoNacional: texto('codigoTributacaoNacional'),
        codigoTributacaoMunicipal: texto('codigoTributacaoMunicipal') || undefined,
        codigoNbs: texto('codigoNbs') || undefined,
        percentualTributosSimples: typeof body.percentualTributosSimples === 'number' ? body.percentualTributosSimples : NaN,
        regimeConfirmado: 'simples-me-epp',
      },
    };
    let xml: string;
    try {
      xml = xmlService.generateDPS(data);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Dados fiscais inválidos.' }, { status: 400 });
    }
    if (body.confirmarHomologacao !== true) {
      return NextResponse.json({ ambiente: 'homologacao', enviado: false, xml }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (!config.pfxBase64 || !config.passphrase) {
      return NextResponse.json({ error: 'Cadastre o certificado A1 da holding e sua senha antes do teste.' }, { status: 422 });
    }
    const dpsId = xml.match(/Id="(DPS\d{42})"/)?.[1];
    if (!dpsId) throw new Error('DPS sem identificador.');
    const registroId = `nfse_homologacao_${dpsId}`;
    const { error: erroReserva } = await supabaseServer.from('system_settings').insert({
      id: registroId, value: { ambiente: 'homologacao', status: 'enviando', dpsId, xml, tenant_id: texto('vidracaria_id') },
      updated_at: new Date().toISOString(),
    });
    if (erroReserva?.code === '23505') {
      return NextResponse.json({ error: 'Esta DPS já foi enviada ou está em processamento. Consulte o resultado no portal nacional antes de qualquer nova tentativa; não troque o número apenas para repetir a mesma operação.' }, { status: 409 });
    }
    if (erroReserva) throw erroReserva;
    try {
      const result = await nationalProvider.emit(data, config.pfxBase64, config.passphrase);
      const oficial = result.xml ? lerDocumentoOficial(result.xml) : null;
      if (!oficial) throw new Error('Emissor não retornou documento oficial.');
      const value = { ambiente: 'homologacao', status: result.status, dpsId, result, documento_oficial: oficial };
      const { error: erroSalvar } = await supabaseServer.from('system_settings')
        .update({ value, updated_at: new Date().toISOString() }).eq('id', registroId);
      if (erroSalvar) throw new Error(`Teste enviado, mas retorno não foi salvo: ${erroSalvar.message}. Consulte a DPS ${dpsId} no portal.`);
      return NextResponse.json({ ...value, enviado: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Falha na homologação.';
      const { error: erroSalvar } = await supabaseServer.from('system_settings').update({
        value: { ambiente: 'homologacao', status: 'verificar_no_portal', dpsId, erro: mensagem },
        updated_at: new Date().toISOString(),
      }).eq('id', registroId);
      if (erroSalvar) console.error('[Homologação nacional] Falha ao registrar erro:', erroSalvar.message);
      throw err;
    }
  } catch (err) {
    console.error('[Homologação nacional]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha na homologação nacional.' }, { status: 502 });
  }
}
