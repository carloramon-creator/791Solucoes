import { NfseProvider, EmitResult, DPSData } from '../types';
import ipmXmlService from './ipm-xml-service';

interface IpmCredentials {
    username: string;
    password: string;
    municipal_code: string;
    isTest?: boolean;
}

export type ConsultaIpm =
    | { ok: true; httpStatus: number; situacao: string; codigo: string | null; xml: string }
    | { ok: false; httpStatus: number; erro: string };

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

    /** Consulta a NFS-e na prefeitura pelo código de autenticidade (mesmo endpoint/autenticação da emissão). */
    public async consultar(codigoAutenticidade: string, credentials: IpmCredentials): Promise<ConsultaIpm> {
        const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<nfse>\n<pesquisa>\n<codigo_autenticidade>${codigoAutenticidade.replace(/\D/g, '')}</codigo_autenticidade>\n</pesquisa>\n</nfse>`;
        const formData = new FormData();
        formData.append('f1', new Blob([xml], { type: 'application/xml' }), 'consulta.xml');

        const cidadeSlug = credentials.municipal_code === '8303' ? 'saojose' : credentials.municipal_code;
        const authHeader = 'Basic ' + Buffer.from(`${this.formatCnpj(credentials.username)}:${credentials.password}`).toString('base64');
        const response = await fetch(this.baseUrl.replace('{cidade}', cidadeSlug), {
            method: 'POST',
            headers: { Authorization: authHeader },
            body: formData,
            signal: AbortSignal.timeout(20_000),
        });

        const bytes = new Uint8Array(await response.arrayBuffer());
        const inicio = new TextDecoder('latin1').decode(bytes.slice(0, 100));
        const texto = new TextDecoder(/iso-8859-1/i.test(inicio) ? 'latin1' : 'utf-8').decode(bytes);
        const situacao = texto.match(/<situacao_descricao_nfse>([^<]*)<\/situacao_descricao_nfse>/)?.[1]?.trim() || null;
        const codigo = texto.match(/<situacao_codigo_nfse>([^<]*)<\/situacao_codigo_nfse>/)?.[1]?.trim() || null;

        if (!response.ok || !situacao) {
            const msg = texto.match(/"msg"\s*:\s*"([^"]+)"/)?.[1] || texto.match(/<mensagem>([\s\S]*?)<\/mensagem>/)?.[1] || texto.slice(0, 200);
            return { ok: false, httpStatus: response.status, erro: msg.trim() || `HTTP ${response.status}` };
        }
        return { ok: true, httpStatus: response.status, situacao, codigo, xml: texto };
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
        const responseLower = responseXml.toLowerCase();

        // Alguns retornos vêm com HTTP 200, mas a mensagem da prefeitura indica rejeição.
        if (responseLower.includes('erro') || responseLower.includes('rejeit')) {
            return this.parseErrorResponse(responseXml);
        }

        const invoiceId = numeroNfseMatch ? numeroNfseMatch[1] : '';

        // Sem número oficial da NFS-e, consideramos processamento pendente.
        // Isso evita falso positivo de "autorizada" com invoice_number HOLD-...
        if (!invoiceId) {
            return {
                success: true,
                status: 'pending',
                message: 'Prefeitura recebeu a solicitação, mas ainda não retornou número da NFS-e.',
                invoiceId: numero.startsWith('HOLD') ? numero : '',
                accessLink: linkMatch ? linkMatch[1] : '',
                xml: responseXml,
            };
        }

        return {
            success: true,
            status: 'authorized',
            message: `NFS-e emitida com sucesso via IPM Fiscal`,
            invoiceId,
            accessLink: linkMatch ? linkMatch[1] : '',
            xml: responseXml
        };
    }
}

export default new IpmProvider();
