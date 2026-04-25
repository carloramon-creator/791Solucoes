import axios from 'axios';
import https from 'https';
import zlib from 'zlib';
import { promisify } from 'util';
import { DPSData } from '../xml-service';
import signatureService from '../signature-service';
import { NfseProvider, EmitResult } from './types';

const gzip = promisify(zlib.gzip);

export class NationalProvider implements NfseProvider {
    public async emit(data: DPSData, pfxBase64: string, passphrase: string, credentials?: any): Promise<EmitResult> {
        console.log(`[NationalProvider] Iniciando emissão para nota ${data.numero}`);

        try {
            // 1. Extrair certificados
            const { privateKey, certificate } = signatureService.extractFromPfx(pfxBase64, passphrase);

            // 2. Gerar XML do DPS (padrão nacional já no xml-service)
            // Importar dinamicamente para evitar ciclos ou usar o import estático se possível.
            // O código original usava require, manterei para garantir compatibilidade.
            const xmlService = require('../xml-service').default;
            const xml = xmlService.generateDPS(data);

            // 3. Assinar XML
            const signedXml = signatureService.signXML(xml, privateKey, certificate, `DPS${data.numero}`);

            // 4. Compactar e Codificar (GZip + Base64) conforme padrão Nacional/ADN
            const compressedXml = await gzip(Buffer.from(signedXml, 'utf-8'));
            const base64Xml = compressedXml.toString('base64');

            // 5. Configurar Cliente HTTP com mTLS
            // OextractFromPfx deve retornar PEMs válidos.
            const httpsAgent = new https.Agent({
                cert: certificate,
                key: privateKey,
                passphrase: passphrase, // Caso a chave esteja encriptada
                rejectUnauthorized: false // Ambiente de homologação
            });

            // 6. Enviar para API Nacional (Homologação)
            // URL identificada para ambiente de produção restrita (homologação)
            const url = "https://adn.producaorestrita.nfse.gov.br/contribuintes/v1/nfse";

            // Payload JSON com propriedade 'dps'
            const payload = {
                dps: base64Xml
            };

            const response = await axios.post(url, payload, {
                httpsAgent,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[NationalProvider] Resposta: ${response.status} - ${JSON.stringify(response.data)}`);

            return {
                success: true,
                invoiceId: response.data?.id || data.numero,
                status: 'authorized',
                message: 'Emitido via Provedor Nacional (REST)'
            };

        } catch (error: any) {
            let cleanMessage = error.message;
            if (error.response?.data) {
                if (error.response.data.mensagem) {
                    cleanMessage = error.response.data.mensagem;
                } else if (error.response.data.errors) {
                    cleanMessage = JSON.stringify(error.response.data.errors);
                } else {
                    cleanMessage = JSON.stringify(error.response.data);
                }
            }

            console.error(`[NationalProvider] Erro detalhado:`, cleanMessage);
            throw new Error(`Erro Provedor Nacional: ${cleanMessage}`);
        }
    }
}

export default new NationalProvider();
