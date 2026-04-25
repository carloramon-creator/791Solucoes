import { NfseProvider, EmitResult, DPSData } from '../types';
import ipmXmlService from './ipm-xml-service';

interface IpmCredentials {
    username: string;
    password: string;
    municipal_code: string;
    isTest?: boolean;
}

export class IpmProvider implements NfseProvider {
    private baseUrl: string = 'https://nfse-{cidade}.atende.net/atende.php?pg=rest&service=WNERestServiceNFSe&cidade=padrao';

    public async emit(
        data: DPSData,
        pfxBase64: string,
        passphrase: string,
        credentials?: IpmCredentials
    ): Promise<EmitResult> {
        console.log(`[IpmProvider] Iniciando emissão para nota ${data.numero} - IPM Fiscal`);

        if (!credentials) {
            throw new Error('[IpmProvider] Credenciais da IPM não fornecidas.');
        }

        try {
            const xmlContent = ipmXmlService.generateIpmXml(data, credentials.municipal_code, credentials.isTest);
            console.log('[IpmProvider] XML Gerado:', xmlContent);
            
            // IPM Atende.Net geralmente usa 'saojose' ou o código no subdomínio. 
            // Em São José/SC é 'saojose'.
            const cidadeSlug = credentials.municipal_code === '8303' ? 'saojose' : credentials.municipal_code;
            const endpoint = this.baseUrl.replace('{cidade}', cidadeSlug);

            // Preparar o conteúdo como um Blob (simulando um arquivo físico)
            const formData = new FormData();
            const xmlBlob = new Blob([xmlContent], { type: 'application/xml' });
            formData.append('f1', xmlBlob, 'nfse.xml');

            console.log('[IpmProvider] Enviando via FormData (f1 como arquivo) para:', endpoint);
 
            const formattedUsername = this.formatCnpj(credentials.username);
            const authHeader = 'Basic ' + Buffer.from(`${formattedUsername}:${credentials.password}`).toString('base64');
 
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                },
                body: formData
            });

            const responseText = await response.text();
            console.log('[IpmProvider] Resposta da prefeitura:', responseText);
            
            if (!response.ok) {
                return this.parseErrorResponse(responseText || `Erro HTTP ${response.status}`);
            }

            if (!responseText) {
                throw new Error('A prefeitura retornou uma resposta vazia.');
            }

            return this.parseSuccessResponse(responseText, data.numero);

        } catch (error: any) {
            console.error('[IpmProvider] Erro na emissão:', error);
            throw new Error(`Erro na comunicação com a prefeitura: ${error.message}`);
        }
    }

    private formatCnpj(cnpj: string): string {
        const raw = cnpj.replace(/\D/g, '');
        if (raw.length === 14) {
            return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
        }
        return cnpj;
    }

    private parseErrorResponse(responseXml: string): EmitResult {
        const codigoMatch = responseXml.match(/<codigo>(\d+)<\/codigo>/);
        const mensagemMatch = responseXml.match(/<mensagem>(.+?)<\/mensagem>/);

        return {
            success: false,
            status: 'rejected',
            message: `Erro IPM [${codigoMatch ? codigoMatch[1] : 'ERR'}]: ${mensagemMatch ? mensagemMatch[1] : responseXml}`,
            invoiceId: ''
        };
    }

    private parseSuccessResponse(responseXml: string, numero: string): EmitResult {
        // Tentar vários padrões de tags que a IPM usa dependendo da cidade/versão
        const numeroNfseMatch = responseXml.match(/<(?:numero_nfse|numero_nota|numero)>(\d+)<\/(?:numero_nfse|numero_nota|numero)>/);
        const linkMatch = responseXml.match(/<(?:link_nfse|link_nota|link)>(.+?)<\/(?:link_nfse|link_nota|link)>/);

        return {
            success: true,
            status: 'authorized',
            message: `NFS-e emitida com sucesso via IPM Fiscal`,
            invoiceId: numeroNfseMatch ? numeroNfseMatch[1] : (numero.startsWith('HOLD') ? '' : numero),
            accessLink: linkMatch ? linkMatch[1] : '',
            xml: responseXml
        };
    }
}

export default new IpmProvider();
