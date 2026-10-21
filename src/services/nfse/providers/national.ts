import axios from 'axios';
import https from 'node:https';
import { gzipSync, gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import type { DPSData } from '../xml-service';
import xmlService from '../xml-service';
import signatureService from '../signature-service';
import type { NfseProvider, EmitResult } from './types';

export const SEFIN_HOMOLOGACAO = 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional';

export class NationalProvider implements NfseProvider {
    public async emit(data: DPSData, pfxBase64: string, passphrase: string): Promise<EmitResult> {
        const xml = xmlService.generateDPS(data);
        const id = xml.match(/Id="(DPS\d{42})"/)?.[1];
        if (!id) throw new Error('Identificador nacional da DPS inválido.');
        const { privateKey, certificate } = signatureService.extractFromPfx(pfxBase64, passphrase);
        const signedXml = signatureService.signXML(xml, privateKey, certificate, id);
        const httpsAgent = new https.Agent({ cert: certificate, key: privateKey, rejectUnauthorized: true });
        try {
            const response = await axios.post<{
                chaveAcesso?: string; nfseXmlGZipB64?: string;
                erros?: { Codigo?: string; Descricao?: string; Complemento?: string }[];
            }>(`${SEFIN_HOMOLOGACAO}/nfse`, {
                dpsXmlGZipB64: gzipSync(Buffer.from(signedXml, 'utf8')).toString('base64'),
            }, { httpsAgent, timeout: 30_000, maxRedirects: 0, maxContentLength: 4_000_000 });
            if (response.data.erros?.length) throw new Error(JSON.stringify(response.data.erros));
            const encoded = response.data.nfseXmlGZipB64;
            const chave = response.data.chaveAcesso;
            if (!encoded || !/^\d{50}$/.test(chave || '')) {
                throw new Error('Resposta sem XML autorizado ou chave nacional. Não tente novamente sem consultar a DPS no portal.');
            }
            const officialXml = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 2_000_000 }).toString('utf8');
            const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(officialXml);
            const nfse = doc.NFSe?.infNFSe;
            if (!/^\d{1,13}$/.test(nfse?.nNFSe || '') || nfse['@_Id'] !== `NFS${chave}`
                || nfse.DPS?.infDPS?.['@_Id'] !== id || nfse.DPS?.infDPS?.tpAmb !== '2'
                || nfse.DPS?.infDPS?.prest?.CNPJ !== data.prestador.cnpj) {
                throw new Error('XML de retorno não corresponde à DPS/emitente de homologação. Confira no portal antes de repetir.');
            }
            return {
                success: true, status: 'authorized', invoiceId: nfse.nNFSe,
                message: 'NFS-e de homologação autorizada pelo Emissor Nacional — sem validade fiscal.',
                xml: officialXml,
                accessLink: `https://www.producaorestrita.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`,
            };
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const resposta = err.response?.data;
                throw new Error(`Homologação nacional: ${resposta ? JSON.stringify(resposta) : err.message}. Consulte a DPS ${id} antes de reenviar.`);
            }
            throw err;
        } finally {
            httpsAgent.destroy();
        }
    }
}

const nationalProvider = new NationalProvider();
export default nationalProvider;
