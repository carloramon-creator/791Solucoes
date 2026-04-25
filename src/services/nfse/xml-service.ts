import { XMLBuilder } from 'fast-xml-parser';

export interface DPSData {
    numero: string;
    serie: string;
    dataEmissao: string;
    prestador: {
        cnpj: string;
        inscricaoMunicipal: string;
    };
    tomador: {
        cnpj?: string;
        cpf?: string;
        razaoSocial: string;
        email?: string;
    };
    servico: {
        codigoItemListaServico: string;
        valorServicos: number;
        discriminacao: string;
    };
}

export class XmlService {
    private builder: XMLBuilder;

    constructor() {
        this.builder = new XMLBuilder({
            format: true,
            ignoreAttributes: false,
            suppressEmptyNode: true,
        });
    }

    public generateDPS(data: DPSData): string {
        const dpsObject = {
            DPS: {
                "@_xmlns": "http://www.sped.fazenda.gov.br/nfse",
                infDPS: {
                    "@_Id": `DPS${data.numero}`,
                    tpAmb: 2, // 1-Produção, 2-Homologação
                    dhEmi: data.dataEmissao,
                    verAplic: "1.0",
                    prest: {
                        CNPJ: data.prestador.cnpj,
                    },
                    tom: {
                        CNPJ: data.tomador.cnpj ? data.tomador.cnpj.replace(/\D/g, '') : undefined,
                        CPF: data.tomador.cpf ? data.tomador.cpf.replace(/\D/g, '') : undefined,
                        xNome: data.tomador.razaoSocial,
                    },
                    serv: {
                        cServ: data.servico.codigoItemListaServico,
                        vServ: data.servico.valorServicos.toFixed(2),
                        desc: data.servico.discriminacao,
                    }
                }
            }
        };

        return this.builder.build(dpsObject);
    }
}

export default new XmlService();
