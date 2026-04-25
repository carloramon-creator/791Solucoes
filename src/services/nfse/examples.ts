/**
 * Exemplos de uso do sistema NFS-e com seleção automática de provedor
 * 
 * NOTA: Este arquivo contém apenas exemplos de código para documentação.
 * Para usar esses exemplos, copie e adapte para seu contexto específico.
 */

/*

import nfseService, { TenantFiscalConfig } from '@/lib/nfse/nfse-service';
import { DPSData } from '@/lib/nfse/xml-service';

// ============================================
// EXEMPLO 1: Emissão com seleção automática
// ============================================

async function exemploEmissaoAutomatica() {
    // Dados da NFS-e
    const dpsData: DPSData = {
        numero: '00001',
        serie: '001',
        dataEmissao: new Date().toISOString(),
        prestador: {
            cnpj: '12345678000100',
            inscricaoMunicipal: '123456'
        },
        tomador: {
            cpf: '12345678900',
            razaoSocial: 'João da Silva',
            email: 'joao@example.com'
        },
        servico: {
            codigoItemListaServico: '0501',
            valorServicos: 100.00,
            discriminacao: 'Corte de cabelo e barba'
        }
    };

    // Configuração do tenant (vinda do banco de dados)
    const tenantConfigSaoJose: TenantFiscalConfig = {
        municipal_code: '8303', // São José/SC - será automaticamente direcionado para IPM
        pfxBase64: 'MIIKs...', // Certificado digital
        passphrase: 'senha123',
        ipm_username: 'usuario_ipm',
        ipm_password: 'senha_ipm'
    };

    try {
        // O método emitNfseAuto() determina automaticamente qual provedor usar
        const result = await nfseService.emitNfseAuto(dpsData, tenantConfigSaoJose);
        
        console.log('✅ NFS-e emitida com sucesso!');
        console.log('Número da nota:', result.invoiceId);
        console.log('Status:', result.status);
        
        if (result.accessLink) {
            console.log('Link de acesso:', result.accessLink);
        }
    } catch (error: any) {
        console.error('❌ Erro na emissão:', error.message);
    }
}

// ============================================
// EXEMPLO 2: Emissão com provedor Nacional
// ============================================

async function exemploEmissaoNacional() {
    const dpsData: DPSData = {
        numero: '00001',
        serie: '001',
        dataEmissao: new Date().toISOString(),
        prestador: {
            cnpj: '12345678000100',
            inscricaoMunicipal: '123456'
        },
        tomador: {
            cpf: '12345678900',
            razaoSocial: 'João da Silva'
        },
        servico: {
            codigoItemListaServico: '0501',
            valorServicos: 100.00,
            discriminacao: 'Corte de cabelo'
        }
    };

    // Configuração para município que usa o padrão Nacional
    const tenantConfigNacional: TenantFiscalConfig = {
        municipal_code: '4205407', // Florianópolis/SC (não mapeado, usa Nacional)
        pfxBase64: 'MIIKs...',
        passphrase: 'senha123'
        // Note: ipm_username e ipm_password não são necessários
    };

    try {
        const result = await nfseService.emitNfseAuto(dpsData, tenantConfigNacional);
        console.log('✅ NFS-e emitida via Provedor Nacional');
    } catch (error: any) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 3: Emissão manual (sem auto-seleção)
// ============================================

async function exemploEmissaoManual() {
    const dpsData: DPSData = {
        numero: '00001',
        serie: '001',
        dataEmissao: new Date().toISOString(),
        prestador: {
            cnpj: '12345678000100',
            inscricaoMunicipal: '123456'
        },
        tomador: {
            cpf: '12345678900',
            razaoSocial: 'João da Silva'
        },
        servico: {
            codigoItemListaServico: '0501',
            valorServicos: 100.00,
            discriminacao: 'Corte de cabelo'
        }
    };

    // Forçar uso do provedor IPM manualmente
    const credentials = {
        username: 'usuario_ipm',
        password: 'senha_ipm',
        cidade: 'saojose'
    };

    try {
        const result = await nfseService.emitNfse(
            dpsData,
            'MIIKs...', // pfxBase64
            'senha123', // passphrase
            'ipm', // providerType fixo
            credentials
        );
        
        console.log('✅ Emitido via IPM (manual)');
    } catch (error: any) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 4: Como usar em uma API route
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
    try {
        // 1. Autenticação
        const session = await getServerSession();
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
        }

        // 2. Buscar dados do tenant
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
        const { data: tenant, error: tenantError } = await supabase
            .from('tenant')
            .select('fiscal_config')
            .eq('id', session.user.tenantId)
            .single();

        if (tenantError || !tenant) {
            return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 });
        }

        // 3. Preparar configuração fiscal
        const fiscalConfig = tenant.fiscal_config as any;
        const tenantConfig: TenantFiscalConfig = {
            municipal_code: fiscalConfig.municipal_code,
            pfxBase64: fiscalConfig.pfxBase64,
            passphrase: fiscalConfig.passphrase,
            ipm_username: fiscalConfig.ipm_username,
            ipm_password: fiscalConfig.ipm_password
        };

        // 4. Dados da NFS-e (vindos do request body)
        const body = await req.json();
        const dpsData: DPSData = {
            numero: body.numero,
            serie: body.serie,
            dataEmissao: new Date().toISOString(),
            prestador: body.prestador,
            tomador: body.tomador,
            servico: body.servico
        };

        // 5. Emitir NFS-e com seleção automática
        const result = await nfseService.emitNfseAuto(dpsData, tenantConfig);

        // 6. Retornar resultado
        return NextResponse.json({
            success: result.success,
            invoiceId: result.invoiceId,
            accessLink: result.accessLink,
            message: result.message
        });

    } catch (error: any) {
        console.error('[API /emit-nfse] Erro:', error);
        return NextResponse.json({ 
            error: error.message 
        }, { status: 500 });
    }
}

// ============================================
// EXEMPLO 5: Adicionar novos municípios ao IPM
// ============================================

Para adicionar suporte a um novo município IPM:

1. Edite /lib/nfse/provider-mapping.ts
2. Adicione o código municipal e o slug da cidade:

export const MUNICIPAL_CODE_TO_PROVIDER: Record<string, 'national' | 'ipm'> = {
    '8303': 'ipm', // São José/SC
    '4205407': 'ipm', // Florianópolis/SC (EXEMPLO)
};

export const MUNICIPAL_CODE_TO_CITY_SLUG: Record<string, string> = {
    '8303': 'saojose',
    '4205407': 'florianopolis', // EXEMPLO
};

3. Configure as credenciais IPM no banco de dados (coluna tenant.fiscal_config):
{
    "municipal_code": "4205407",
    "pfxBase64": "...",
    "passphrase": "...",
    "ipm_username": "usuario_floripa",
    "ipm_password": "senha_floripa"
}

4. Pronto! O sistema automaticamente usará o provedor IPM para esse município.

*/

export { };
