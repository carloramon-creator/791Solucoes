import { XMLBuilder } from 'fast-xml-parser';
import { DPSData } from '../xml-service';

export class IpmXmlService {
    private builder: XMLBuilder;

    constructor() {
        this.builder = new XMLBuilder({
            format: true,
            ignoreAttributes: false,
            suppressEmptyNode: true,
        });
    }

    /**
     * Formata um número para o padrão IPM (vírgula como decimal, sem milhar)
     */
    private formatNumber(value: number): string {
        return value.toFixed(2).replace('.', ',');
    }

    /**
     * Gera o XML no padrão IPM Fiscal (Atende.Net)
     */
    public generateIpmXml(data: DPSData, tomCodigo: string = '8303', isTest: boolean = false): string {
        const isPessoaJuridica = !!data.tomador.cnpj;

        const nfseObject = {
            nfse: {
                // Tag de teste conforme documentação (para não gerar nota válida)
                ...(isTest ? { nfse_teste: '1' } : {}),

                // Identificador único para evitar duplicidade
                identificador: data.numero,
                nf: {
                    serie_nfse: data.serie,
                    data_fato_gerador: data.dataEmissao.split('T')[0].split('-').reverse().join('/'),
                    valor_total: this.formatNumber(data.servico.valorServicos),
                    valor_desconto: '0,00',
                    valor_ir: '0,00',
                    valor_inss: '0,00',
                    valor_contribuicao_social: '0,00',
                    valor_rps: '0,00',
                    valor_pis: '0,00',
                    valor_cofins: '0,00',
                    observacao: data.servico.discriminacao
                },
                prestador: {
                    cpfcnpj: data.prestador.cnpj.replace(/\D/g, ''),
                    cidade: tomCodigo
                },
                tomador: {
                    tipo: isPessoaJuridica ? 'J' : 'F',
                    cpfcnpj: (data.tomador.cnpj || data.tomador.cpf || '').replace(/\D/g, ''),
                    nome_razao_social: data.tomador.razaoSocial,
                    email: data.tomador.email || '',
                    // Para simplificação, assumimos que os dados de endereço viriam no DPSData se necessário
                    // Por enquanto usaremos placeholders ou deixaremos vazio se opcionais
                    cidade: tomCodigo // Assumindo mesma cidade para simplificar, ou deveria vir do tomador
                },
                itens: {
                    lista: {
                        item: {
                            tributa_municipio_prestador: '1',
                            codigo_local_prestacao_servico: tomCodigo,
                            codigo_item_lista_servico: data.servico.codigoItemListaServico.replace(/\D/g, ''),
                            descritivo: data.servico.discriminacao,
                            aliquota_item_lista_servico: '0,00', // Deve ser configurado por serviço
                            situacao_tributaria: '0', // 0 = Tributada Integralmente
                            valor_tributavel: this.formatNumber(data.servico.valorServicos),
                            unidade_codigo: '1',
                            unidade_quantidade: '1,00',
                            unidade_valor_unitario: this.formatNumber(data.servico.valorServicos)
                        }
                    }
                }
            }
        };

        return '<?xml version="1.0" encoding="UTF-8"?>\n' + this.builder.build(nfseObject);
    }
}

export default new IpmXmlService();
