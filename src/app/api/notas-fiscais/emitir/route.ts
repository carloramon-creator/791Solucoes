import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getGlassClient } from '@/lib/glass-client';
import ipmProvider from '@/lib/nfse/providers/ipm';
import { DPSData } from '@/lib/nfse/types';

export async function POST(req: Request) {
  try {
    const { vidracaria_id, valor, descricao } = await req.json();

    if (!vidracaria_id || !valor) {
      return NextResponse.json({ error: 'ID da vidraçaria e valor são obrigatórios.' }, { status: 400 });
    }

    // 1. Buscar dados da Vidraçaria no 791glass (Tomador)
    const glassSupabase = await getGlassClient();
    const { data: vidracaria, error: glassError } = await glassSupabase
      .from('vidracarias')
      .select('nome, cnpj, email, endereco, numero, bairro, cep, cidade, estado, inscricao_municipal')
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
      dataEmissao: new Date().toISOString(),
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
    if (!dpsData.tomador.endereco?.logradouro) throw new Error('O endereço da vidraçaria está incompleto.');

    console.log('[NFSe] Dados preparados:', JSON.stringify(dpsData, null, 2));

    // 4. Chamar Provider IPM para emissão
    const result = await ipmProvider.emit(
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
            xml: result.xml
        }
      }]);

    if (invoiceError) {
        console.error('Erro ao salvar fatura no banco:', invoiceError);
        throw new Error('Nota enviada para prefeitura, mas erro ao salvar histórico: ' + invoiceError.message);
    }

    return NextResponse.json(result);

  } catch (err: any) {
    console.error('Erro na emissão de nota:', err);
    return NextResponse.json({ 
        success: false, 
        error: err.message 
    }, { status: 500 });
  }
}
