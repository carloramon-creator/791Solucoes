import axios from 'axios';
import https from 'node:https';
import { gzipSync, gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import type { DPSData, PedidoCancelamentoData } from '../xml-service';
import xmlService from '../xml-service';
import signatureService from '../signature-service';
import type { NfseProvider, EmitResult } from './types';

export const SEFIN_HOMOLOGACAO = 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional';
export const SEFIN_PRODUCAO = 'https://sefin.nfse.gov.br/SefinNacional';

/** O Sefin rejeita (E1229) XML sem declaração de codificação UTF-8; ela fica fora do elemento assinado. */
export const xmlParaEnvio = (xml: string) => Buffer.from(
    xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>${xml}`, 'utf8');

export interface CancelResult {
    eventoXml: string;
    idEvento: string;
    processadoEm: string | null;
}

/** O Sefin recusou porque a nota já tem evento de cancelamento (ex.: repetição após timeout ou cancelada no portal). */
export class NfseJaCanceladaError extends Error {
    constructor(public readonly detalhe: string) {
        super(`A NFS-e já está cancelada no Emissor Nacional: ${detalhe}`);
    }
}

type ErroSefin = { Codigo?: string; codigo?: string; Descricao?: string; descricao?: string; xMotivo?: string; Complemento?: string };

function errosDaResposta(dados: unknown): ErroSefin[] {
    if (!dados || typeof dados !== 'object') return [];
    const d = dados as { erros?: unknown; erro?: unknown };
    const lista = [d.erros, d.erro].flatMap(e => Array.isArray(e) ? e : e && typeof e === 'object' ? [e] : []);
    return lista as ErroSefin[];
}

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
                dpsXmlGZipB64: gzipSync(xmlParaEnvio(signedXml)).toString('base64'),
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

    public async cancelar(pedido: PedidoCancelamentoData, pfxBase64: string, passphrase: string): Promise<CancelResult> {
        const xml = xmlService.generatePedidoCancelamento(pedido);
        const id = `PRE${pedido.chaveAcesso}101101`;
        const { privateKey, certificate } = signatureService.extractFromPfx(pfxBase64, passphrase);
        const signedXml = signatureService.signXML(xml, privateKey, certificate, id);
        const base = pedido.ambiente === 1 ? SEFIN_PRODUCAO : SEFIN_HOMOLOGACAO;
        const httpsAgent = new https.Agent({ cert: certificate, key: privateKey, rejectUnauthorized: true });
        try {
            let response;
            try {
                response = await axios.post<{ eventoXmlGZipB64?: string }>(`${base}/nfse/${pedido.chaveAcesso}/eventos`, {
                    pedidoRegistroEventoXmlGZipB64: gzipSync(xmlParaEnvio(signedXml)).toString('base64'),
                }, { httpsAgent, timeout: 30_000, maxRedirects: 0, maxContentLength: 4_000_000 });
            } catch (err) {
                if (!axios.isAxiosError(err)) throw err;
                const erros = errosDaResposta(err.response?.data);
                if (erros.some(e => (e.Codigo || e.codigo) === 'E0840')) throw new NfseJaCanceladaError(JSON.stringify(erros));
                const detalhe = err.response?.data ? JSON.stringify(err.response.data) : err.message;
                throw new Error(`Cancelamento nacional recusado ou sem resposta: ${detalhe}. Confira a situação da nota no portal antes de repetir.`);
            }
            const erros = errosDaResposta(response.data);
            if (erros.some(e => (e.Codigo || e.codigo) === 'E0840')) throw new NfseJaCanceladaError(JSON.stringify(erros));
            if (erros.length) throw new Error(`Cancelamento nacional recusado: ${JSON.stringify(erros)}`);
            const encoded = response.data?.eventoXmlGZipB64;
            if (!encoded) throw new Error('Resposta sem o XML do evento de cancelamento. Confira a situação da nota no portal antes de repetir.');
            const eventoXml = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 2_000_000 }).toString('utf8');
            const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(eventoXml);
            const inf = doc.evento?.infEvento;
            const ped = inf?.pedRegEvento?.infPedReg;
            const idEvento = String(inf?.['@_Id'] || '');
            if (!idEvento.startsWith(`EVT${pedido.chaveAcesso}101101`) || ped?.chNFSe !== pedido.chaveAcesso || !ped?.e101101) {
                throw new Error('O evento retornado não corresponde ao cancelamento desta NFS-e. Confira no portal antes de repetir.');
            }
            return { eventoXml, idEvento, processadoEm: typeof inf.dhProc === 'string' ? inf.dhProc : null };
        } finally {
            httpsAgent.destroy();
        }
    }
}

const nationalProvider = new NationalProvider();
export default nationalProvider;
