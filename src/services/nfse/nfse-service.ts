import { DPSData } from './xml-service';
import nationalProvider from './providers/national';
import ipmProvider from './providers/ipm';
import { NfseProvider, EmitResult } from './providers/types';
import { getProviderType, getCitySlug } from './provider-mapping';

export interface IpmCredentials {
    username: string;
    password: string;
    cidade: string; // Ex: 'saojose' para São José/SC
    isTest?: boolean;
}

export interface TenantFiscalConfig {
    municipal_code: string;
    pfxBase64: string;
    passphrase: string;
    // Credenciais IPM (opcionais, apenas para municípios que usam IPM)
    ipm_username?: string;
    ipm_password?: string;
}

export class NfseService {
    /**
     * Orquestra a emissão da NFS-e selecionando o provedor adequado.
     * @param credentials - Obrigatório apenas para providerType 'ipm'
     */
    public async emitNfse(
        data: DPSData,
        pfxBase64: string,
        passphrase: string,
        providerType: 'national' | 'ipm' = 'national',
        credentials?: IpmCredentials
    ): Promise<EmitResult> {
        console.log(`[NfseService] Iniciando emissão para nota ${data.numero} via provedor: ${providerType}`);

        let provider: NfseProvider;

        switch (providerType) {
            case 'ipm':
                provider = ipmProvider;
                break;
            case 'national':
            default:
                provider = nationalProvider;
                break;
        }

        try {
            // O provedor IPM requer credentials, o Nacional não
            return await provider.emit(data, pfxBase64, passphrase, credentials as any);
        } catch (error: any) {
            console.error(`[NfseService] Erro no provedor ${providerType}:`, error.message);
            throw error;
        }
    }

    /**
     * Emite NFS-e com seleção automática de provedor baseada no tenant
     * @param data - Dados da NFS-e
     * @param tenantConfig - Configuração fiscal do tenant
     */
    public async emitNfseAuto(
        data: DPSData,
        tenantConfig: TenantFiscalConfig
    ): Promise<EmitResult> {
        const { municipal_code, pfxBase64, passphrase, ipm_username, ipm_password } = tenantConfig;

        console.log(`[NfseService] DEBUG - Tenant Config:`, {
            municipal_code,
            hasPfx: !!pfxBase64,
            hasPassphrase: !!passphrase,
            ipm_username
        });

        // Determinar provedor automaticamente
        const providerType = getProviderType(municipal_code);
        console.log(`[NfseService] Provedor selecionado automaticamente: ${providerType} (código municipal: '${municipal_code}')`);

        // Se for IPM, preparar credenciais
        let credentials: IpmCredentials | undefined;
        if (providerType === 'ipm') {
            const citySlug = getCitySlug(municipal_code);

            if (!citySlug) {
                throw new Error(`Cidade não mapeada para código municipal ${municipal_code}. Configure o mapeamento em provider-mapping.ts`);
            }

            if (!ipm_username || !ipm_password) {
                throw new Error(`Credenciais IPM não configuradas para o município ${municipal_code}`);
            }

            credentials = {
                username: ipm_username,
                password: ipm_password,
                cidade: citySlug
            };
        }

        // Emitir usando o método base
        return this.emitNfse(data, pfxBase64, passphrase, providerType, credentials);
    }
}

export default new NfseService();

