import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import * as forge from 'node-forge';

export class SignatureService {
    /**
     * Extrai chave privada e certificado de um PFX base64
     */
    public extractFromPfx(pfxBase64: string, passphrase: string) {
        try {
            // Remove prefixo data:application/x-pkcs12;base64, se existir
            const pureBase64 = pfxBase64.includes(',') ? pfxBase64.split(',')[1] : pfxBase64;
            const pfxDer = forge.util.decode64(pureBase64);
            const pfxAsn1 = forge.asn1.fromDer(pfxDer);
            const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, passphrase);

            const bags = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            const keyBag = bags[forge.pki.oids.pkcs8ShroudedKeyBag];
            if (!keyBag || !keyBag[0]) throw new Error("Chave privada não encontrada no PFX");

            const privateKey = forge.pki.privateKeyToPem(keyBag[0].key!);

            const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
            const certBag = certBags[forge.pki.oids.certBag];
            if (!certBag || !certBag[0]) throw new Error("Certificado não encontrado no PFX");

            const certificate = forge.pki.certificateToPem(certBag[0].cert!);

            return { privateKey, certificate };
        } catch (error: any) {
            console.error('[SignatureService] Erro ao extrair PFX:', error.message);
            throw new Error('Falha ao processar certificado digital: ' + error.message);
        }
    }

    /**
     * Sinais um XML usando um certificado digital (PEM format) e chave privada.
     */
    public signXML(xml: string, privateKey: string, publicCert: string, elementId: string): string {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        // @ts-ignore
        const sig = new SignedXml({
            privateKey: Buffer.from(privateKey),
            publicCert: Buffer.from(publicCert),
            signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
            canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#"
        });

        sig.addReference({
            xpath: `//*[@Id="${elementId}"]`,
            transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
            digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1"
        });

        sig.computeSignature(xml, {
            location: { reference: `//*[@Id="${elementId}"]`, action: "after" }
        });

        return sig.getSignedXml();
    }
}

export default new SignatureService();
