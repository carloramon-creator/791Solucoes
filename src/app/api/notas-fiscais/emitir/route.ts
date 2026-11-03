import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getGlassClient } from '@/lib/glass-client';
import ipmProvider from '@/lib/nfse/providers/ipm';
import { DPSData } from '@/lib/nfse/types';
import { montarSnapshotDanfse } from '@/services/nfse/danfse-snapshot';
import { emitirNacionalProducao, usaNacional } from '@/services/nfse/emissao-nacional';
import { dataHoraNacional } from '@/services/nfse/data-hora';

function getLocalIsoTimestamp() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  try {
    const { vidracaria_id, valor, descricao, competencia: competenciaInformada, referencia, previsualizar } = await req.json();
    if (previsualizar !== undefined && typeof previsualizar !== 'boolean') throw new Error('Pré-visualização deve ser um valor booleano.');
    const competencia = competenciaInformada ?? dataHoraNacional().slice(0, 10);
    if (typeof competencia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(competencia)
      || !Number.isFinite(Date.parse(competencia))
      || new Date(competencia).toISOString().slice(0, 10) !== competencia) throw new Error('Competência inválida.');

    if (!vidracaria_id || typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'ID da vidraçaria e valor são obrigatórios.' }, { status: 400 });
    }

    // 1. Buscar dados da Vidraçaria no 791glass (Tomador)
    const glassSupabase = await getGlassClient();
    const { data: vidracaria, error: glassError } = await glassSupabase
      .from('vidracarias')
      .select('nome, cnpj, email, endereco, endereco_completo, complemento, numero, bairro, cep, cidade, estado, inscricao_municipal')
      .eq('id', vidracaria_id)
      .single();

    if (glassError || !vidracaria) {
      throw new Error('Vidraçaria não encontrada no sistema Glass: ' + glassError?.message);
    }

    // 2. Buscar configurações de NFS-e na Holding (Prestador)
    const { data: configData, error: configError } = await supabaseServer
      .from('system_settings')
      .select('value')
      .eq('id', 'nfse_config')
      .single();

    if (configError || !configData?.value) {
      throw new Error('Configurações de NFS-e não encontradas na Holding.');
    }

    const config = configData.value;

    // 3. Preparar dados da nota (DPSData)
    const dpsData: DPSData = {
      numero: `HOLD-${Date.now()}`,
      serie: '1',
      dataEmissao: getLocalIsoTimestamp(),
      prestador: {
        cnpj: config.prestador_cnpj,
        razaoSocial: config.razao_social,
        inscricaoMunicipal: config.inscricao_municipal,
        endereco: {
          logradouro: config.logradouro,
          numero: config.numero,
          bairro: config.bairro,
          cep: config.cep,
          cidade: config.cidade,
          uf: config.estado
        }
      },
      tomador: {
        cnpj: vidracaria.cnpj,
        razaoSocial: vidracaria.nome,
        email: vidracaria.email,
        inscricaoMunicipal: vidracaria.inscricao_municipal,
        endereco: {
          logradouro: vidracaria.endereco,
          numero: vidracaria.numero,
          bairro: vidracaria.bairro,
          cep: vidracaria.cep,
          cidade: vidracaria.cidade,
          uf: vidracaria.estado
        }
      },
      servico: {
        valorServicos: valor,
        codigoItemListaServico: config.tax_code || '01.01.01',
        discriminacao: descricao || `Mensalidade Plataforma 791 - Referência ${new Date().getMonth() + 1}/${new Date().getFullYear()}`,
        aliquota: 0
      }
    };

    // Validação básica de dados obrigatórios
    if (!dpsData.prestador.cnpj) throw new Error('Seu CNPJ (Prestador) não está configurado.');
    if (!dpsData.tomador.cnpj) throw new Error('A vidraçaria (Tomador) não possui CNPJ cadastrado.');
    if (!dpsData.tomador.endereco?.logradouro && !vidracaria.endereco_completo) throw new Error('O endereço da vidraçaria está incompleto.');

    let result: Awaited<ReturnType<typeof ipmProvider.emit>>;
    let metadataNacional: Record<string, unknown> = {};
    if (usaNacional(competencia)) {
      if (previsualizar !== true && (typeof referencia !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(referencia))) {
        throw new Error('Informe uma referência única da operação para impedir duplicidade.');
      }
      const emissao = await emitirNacionalProducao({
        supabase: supabaseServer, config, dados: dpsData, tenant: { ...vidracaria, id: vidracaria_id },
        competencia, operacao: `manual_${referencia}`, previsualizar: previsualizar === true,
      });
      if (!emissao.result) return NextResponse.json({ success: true, enviado: false, ...emissao });
      result = emissao.result;
      metadataNacional = emissao.metadata;
    } else {
      if (previsualizar === true) throw new Error('Prévia IPM não disponível neste endpoint.');
      result = await ipmProvider.emit(
      dpsData,
      config.pfxBase64,
      config.passphrase,
      {
        username: config.ipm_username,
        password: config.ipm_password,
        municipal_code: config.municipal_code,
        isTest: config.environment === 'homologacao'
      }
      );
    }

    // 5. Salvar na tabela system_invoices da Holding
    const { error: invoiceError } = await supabaseServer
      .from('system_invoices')
      .insert([{
        invoice_number: result.invoiceId || dpsData.numero,
        status: result.status,
        client_name: vidracaria.nome,
        client_document: vidracaria.cnpj,
        value: valor,
        access_link: result.accessLink,
        error_message: result.success ? null : result.message,
        metadata: {
            vidracaria_id,
            xml: result.xml,
            danfse: montarSnapshotDanfse({ dpsData, config, retornoXml: result.xml, accessLink: result.accessLink }),
            ...metadataNacional, competencia, mes_ref: competencia.slice(0, 7)
        }
      }]);

    if (invoiceError) {
        console.error('Erro ao salvar fatura no banco:', invoiceError);
        throw new Error('Nota enviada ao emissor fiscal, mas houve erro ao salvar histórico. Não reenvie: ' + invoiceError.message);
    }

    return NextResponse.json(result);

  } catch (err) {
    console.error('Erro na emissão de nota:', err);
    return NextResponse.json({ 
        success: false, 
        error: err instanceof Error ? err.message : 'Falha na emissão fiscal.'
    }, { status: 500 });
  }
}
