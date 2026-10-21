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
    nacional?: {
        municipioEmissao: string;
        municipioPrestacao: string;
        competencia: string;
        codigoTributacaoNacional: string;
        codigoTributacaoMunicipal?: string;
        codigoNbs?: string;
        percentualTributosSimples: number;
        regimeConfirmado: 'simples-me-epp';
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
        const nacional = data.nacional;
        if (!nacional || nacional.regimeConfirmado !== 'simples-me-epp') {
            throw new Error('Confirme o regime ME/EPP do Simples e os parâmetros nacionais antes de gerar a DPS de homologação.');
        }
        const validar = (valor: string, regex: RegExp, campo: string) => {
            if (!regex.test(valor)) throw new Error(`${campo} inválido.`);
        };
        validar(data.numero, /^[1-9]\d{0,14}$/, 'Número da DPS');
        validar(data.serie, /^(?:\d{1,4}|[0-8]\d{4})$/, 'Série da DPS (0 a 89999)');
        validar(data.prestador.cnpj, /^\d{14}$/, 'CNPJ do prestador');
        validar(nacional.municipioEmissao, /^\d{7}$/, 'Município de emissão (IBGE)');
        validar(nacional.municipioPrestacao, /^\d{7}$/, 'Município de prestação (IBGE)');
        validar(nacional.codigoTributacaoNacional, /^\d{6}$/, 'Código de tributação nacional');
        validar(nacional.competencia, /^\d{4}-\d{2}-\d{2}$/, 'Competência');
        if (!Number.isFinite(Date.parse(`${nacional.competencia}T00:00:00Z`))
            || new Date(`${nacional.competencia}T00:00:00Z`).toISOString().slice(0, 10) !== nacional.competencia) {
            throw new Error('Competência inválida.');
        }
        if (!Number.isFinite(Date.parse(data.dataEmissao)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:00$/.test(data.dataEmissao)) {
            throw new Error('Data de emissão deve conter segundos e fuso horário numérico, sem milissegundos.');
        }
        if (Number(data.dataEmissao.slice(0, 4)) !== 2026 || Number(nacional.competencia.slice(0, 4)) !== 2026) {
            throw new Error('Este fluxo de homologação cobre o Simples em 2026. Parametrize IBS/CBS antes de emitir para 2027.');
        }
        if (!Number.isFinite(data.servico.valorServicos) || data.servico.valorServicos <= 0
            || !data.servico.discriminacao.trim() || data.servico.discriminacao.length > 2000) {
            throw new Error('Informe valor positivo e descrição do serviço de até 2000 caracteres.');
        }
        if (!Number.isFinite(nacional.percentualTributosSimples)
            || nacional.percentualTributosSimples < 0 || nacional.percentualTributosSimples > 100) {
            throw new Error('Informe o percentual aproximado de tributos do Simples, confirmado com o contador.');
        }
        if (nacional.codigoTributacaoMunicipal) validar(nacional.codigoTributacaoMunicipal, /^\d{3}$/, 'Código de tributação municipal');
        if (nacional.codigoNbs) validar(nacional.codigoNbs, /^\d{9}$/, 'Código NBS');
        if (Boolean(data.tomador.cnpj) === Boolean(data.tomador.cpf)) throw new Error('Informe apenas CNPJ ou CPF do tomador.');
        if (data.tomador.cnpj) validar(data.tomador.cnpj, /^\d{14}$/, 'CNPJ do tomador');
        if (data.tomador.cpf) validar(data.tomador.cpf, /^\d{11}$/, 'CPF do tomador');
        if (!data.tomador.razaoSocial.trim()) throw new Error('Nome do tomador obrigatório.');
        const id = `DPS${nacional.municipioEmissao}2${data.prestador.cnpj}${data.serie.padStart(5, '0')}${data.numero.padStart(15, '0')}`;
        const dpsObject = {
            DPS: {
                "@_xmlns": "http://www.sped.fazenda.gov.br/nfse",
                "@_versao": "1.01",
                infDPS: {
                    "@_Id": id,
                    tpAmb: 2, // 1-Produção, 2-Homologação
                    dhEmi: data.dataEmissao,
                    verAplic: "791holding_1.0",
                    serie: data.serie,
                    nDPS: data.numero,
                    dCompet: nacional.competencia,
                    tpEmit: 1,
                    finNFSe: 0,
                    cLocEmi: nacional.municipioEmissao,
                    prest: {
                        CNPJ: data.prestador.cnpj,
                        regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 },
                    },
                    toma: {
                        CNPJ: data.tomador.cnpj ? data.tomador.cnpj.replace(/\D/g, '') : undefined,
                        CPF: data.tomador.cpf ? data.tomador.cpf.replace(/\D/g, '') : undefined,
                        xNome: data.tomador.razaoSocial,
                        email: data.tomador.email || undefined,
                    },
                    serv: {
                        locPrest: { cLocPrestacao: nacional.municipioPrestacao },
                        cServ: {
                            cTribNac: nacional.codigoTributacaoNacional,
                            cTribMun: nacional.codigoTributacaoMunicipal || undefined,
                            cNBS: nacional.codigoNbs || undefined,
                            xDescServ: data.servico.discriminacao,
                        },
                    },
                    valores: {
                        vServPrest: { vServ: data.servico.valorServicos.toFixed(2) },
                        trib: {
                            tribMun: { tribISSQN: 1, tpRetISSQN: 1 },
                            totTrib: { pTotTribSN: nacional.percentualTributosSimples.toFixed(2) },
                        },
                    },
                }
            }
        };

        return this.builder.build(dpsObject);
    }
}

const xmlService = new XmlService();
export default xmlService;
