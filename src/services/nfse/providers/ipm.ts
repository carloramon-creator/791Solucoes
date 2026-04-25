import { NfseProvider, EmitResult } from './types';
import { DPSData } from '../xml-service';
import ipmXmlService from './ipm-xml-service';

interface IpmCredentials {
    username: string;
    password: string;
    cidade: string; // Ex: 'saojose' para São José/SC
    isTest?: boolean;
}

export class IpmProvider implements NfseProvider {
    // A URL será construída dinamicamente: https://{cidade}.atende.net/...
    // Conforme documentação: atende.php?pg=rest&service=WNERestServiceNFSecidade=padrao (ou 8303)
    private baseUrl: string = 'https://nfse-{cidade}.atende.net/atende.php?pg=rest&service=WNERestServiceNFSecidade=padrao';

    /**
     * Provedor IPM Fiscal (Atende.Net) - São José/SC
     */
    public async emit(
        data: DPSData,
        pfxBase64: string,
        passphrase: string,
        credentials?: IpmCredentials
    ): Promise<EmitResult> {
        console.log(`[IpmProvider] Iniciando emissão para nota ${data.numero} - São José/SC`);

        if (!credentials) {
            throw new Error('[IpmProvider] Credenciais da IPM (username/password/cidade) não fornecidas.');
        }

        try {
            // 1. Gerar XML no padrão IPM
            // Se isTest for true, gera com tag <nfse_teste>1</nfse_teste>
            const xmlContent = ipmXmlService.generateIpmXml(data, '8303', credentials.isTest);
            console.log(`[IpmProvider] XML gerado:\n${xmlContent}`);

            // 2. Preparar endpoint com cidade
            const endpoint = this.baseUrl.replace('{cidade}', credentials.cidade);

            // 3. Criar FormData com o arquivo XML
            const formData = new FormData();
            const xmlBlob = new Blob([xmlContent], { type: 'application/xml' });
            formData.append('xml', xmlBlob, 'nfse.xml');

            // 4. Preparar autenticação Basic
            // A documentação IPM mostra o uso do CNPJ FORMATADO (com pontos/barras)
            // Exemplo: 11.111.111/1111-11
            const formattedUsername = this.formatCnpj(credentials.username);

            const authHeader = 'Basic ' + Buffer.from(
                `${formattedUsername}:${credentials.password}`
            ).toString('base64');

            // 5. Enviar requisição
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    // Não definir Content-Type manualmente; o navegador define com boundary correto
                },
                body: formData
            });

            const responseText = await response.text();
            console.log(`[IpmProvider] Resposta do servidor (${response.status}):`, responseText);

            // 6. Processar resposta (XML de retorno)
            if (!response.ok) {
                return this.parseErrorResponse(responseText, response.status);
            }

            return this.parseSuccessResponse(responseText, data.numero);

        } catch (error: any) {
            console.error('[IpmProvider] Erro na emissão:', error);
            throw new Error(`Erro IPM Provider: ${error.message}`);
        }
    }

    public async cancel(
        numero: string,
        pfxBase64: string,
        passphrase: string,
        credentials?: IpmCredentials
    ): Promise<EmitResult> {
        console.log(`[IpmProvider] Cancelamento de nota ${numero}`);

        if (!credentials) {
            throw new Error('[IpmProvider] Credenciais da IPM não fornecidas para cancelamento.');
        }

        // TODO: Implementar lógica de cancelamento conforme documentação
        // Geralmente envolve enviar XML com <solicitacao_cancelamento>

        throw new Error('Cancelamento IPM em desenvolvimento.');
    }

    public async checkStatus(numero: string, credentials?: IpmCredentials): Promise<EmitResult> {
        console.log(`[IpmProvider] Consulta de status para nota ${numero}`);

        if (!credentials) {
            throw new Error('[IpmProvider] Credenciais da IPM não fornecidas para consulta.');
        }

        // TODO: Implementar consulta via código de autenticidade ou número

        throw new Error('Consulta de status IPM em desenvolvimento.');
    }

    /**
     * Formata o CNPJ se necessário para o padrão esperado pela IPM (com pontos e barras)
     */
    private formatCnpj(cnpj: string): string {
        const raw = cnpj.replace(/\D/g, '');
        if (raw.length === 14) {
            return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
        }
        return cnpj; // Se não for CNPJ, envia como está
    }

    /**
     * Mapeia códigos de erro da documentação IPM
     */
    private parseErrorResponse(responseXml: string, statusCode: number): EmitResult {
        // Extrair código de erro do XML (ex: <codigo>132</codigo>)
        const codigoMatch = responseXml.match(/<codigo>(\d+)<\/codigo>/);
        const mensagemMatch = responseXml.match(/<mensagem>(.+?)<\/mensagem>/);

        const codigo = codigoMatch ? codigoMatch[1] : 'UNKNOWN';
        const mensagem = mensagemMatch ? mensagemMatch[1] : responseXml;

        console.error(`[IpmProvider] Erro ${codigo}: ${mensagem}`);

        return {
            success: false,
            status: 'rejected',
            message: `Erro IPM [${codigo}]: ${mensagem}`,
            invoiceId: ''
        };
    }

    /**
     * Processa resposta de sucesso
     */
    private parseSuccessResponse(responseXml: string, numero: string): EmitResult {
        // Extrair número da NFS-e gerada
        const numeroNfseMatch = responseXml.match(/<numero_nfse>(\d+)<\/numero_nfse>/);
        const linkMatch = responseXml.match(/<link_nfse>(.+?)<\/link_nfse>/);

        const numeroNfse = numeroNfseMatch ? numeroNfseMatch[1] : numero;
        const linkNfse = linkMatch ? linkMatch[1] : '';

        console.log(`[IpmProvider] NFS-e ${numeroNfse} emitida com sucesso!`);
        if (linkNfse) {
            console.log(`[IpmProvider] Link de acesso: ${linkNfse}`);
        }

        return {
            success: true,
            status: 'authorized',
            message: `NFS-e ${numeroNfse} emitida via IPM Fiscal (São José/SC)`,
            invoiceId: numeroNfse,
            accessLink: linkNfse
        };
    }
}

export default new IpmProvider();
