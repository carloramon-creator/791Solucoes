import soap from 'soap';

export class SoapService {
    /**
     * Envia o XML assinado para o Web Service da SEFAZ Nacional.
     */
    public async sendNfse(url: string, xml: string, pfx: Buffer, passphrase: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const options: soap.IOptions = {
                wsdl_options: {
                    pfx: pfx,
                    passphrase: passphrase,
                    rejectUnauthorized: false
                }
            };

            soap.createClient(url, options, (err, client) => {
                if (err) {
                    return reject(err);
                }

                // Método RecepcionarLoteRps conforme padrão NFS-e Nacional
                if (client && (client as any).RecepcionarLoteRps) {
                    (client as any).RecepcionarLoteRps({ _xml: xml }, (err: any, result: any) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(result);
                    });
                } else {
                    reject(new Error('Método RecepcionarLoteRps não encontrado no WSDL'));
                }
            });
        });
    }
}

export default new SoapService();
