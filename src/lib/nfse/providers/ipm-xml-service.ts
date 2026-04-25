import { XMLBuilder } from 'fast-xml-parser';
import { DPSData } from '../types';

export class IpmXmlService {
    private builder: XMLBuilder;

    constructor() {
        this.builder = new XMLBuilder({
            format: true,
            ignoreAttributes: false,
            suppressEmptyNode: true,
        });
    }

    private formatNumber(value: number): string {
        return value.toFixed(2).replace('.', ',');
    }

    public generateIpmXml(data: DPSData, tomCodigo: string = '8303', isTest: boolean = false): string {
        const isPessoaJuridica = !!data.tomador.cnpj;

        // Converter códigos TOM para IBGE se necessário (São José SC)
        const prestadorCidade = tomCodigo === '8303' ? '4216602' : tomCodigo;

        // Tentar converter nome da cidade para código se necessário
        let tomadorCidade = (data.tomador.endereco?.cidade?.toLowerCase().includes('são josé') || 
                               data.tomador.endereco?.cidade === tomCodigo ||
                               data.tomador.endereco?.cidade === '8303' ||
                               data.tomador.endereco?.cidade === '4216602') ? '4216602' : (data.tomador.endereco?.cidade || prestadorCidade);

        const nfseObject = {
            nfse: {
                ...(isTest ? { nfse_teste: '1' } : {}),
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
                    cidade: prestadorCidade
                },
                tomador: {
                    tipo: isPessoaJuridica ? 'J' : 'F',
                    cpfcnpj: (data.tomador.cnpj || data.tomador.cpf || '').replace(/\D/g, ''),
                    nome_razao_social: data.tomador.razaoSocial,
                    email: data.tomador.email || '',
                    cidade: tomadorCidade,
                    logradouro: `${data.tomador.endereco?.logradouro}${data.tomador.endereco?.numero ? ', ' + data.tomador.endereco?.numero : ''}`,
                    bairro: data.tomador.endereco?.bairro,
                    cep: data.tomador.endereco?.cep?.replace(/\D/g, ''),
                    estado: data.tomador.endereco?.uf
                },
                itens: {
                    lista: {
                        tributa_municipio_prestador: '1',
                        codigo_local_prestacao_servico: prestadorCidade,
                        codigo_item_lista_servico: data.servico.codigoItemListaServico.replace(/\D/g, ''),
                        descritivo: data.servico.discriminacao,
                        aliquota_item_lista_servico: data.servico.aliquota ? this.formatNumber(data.servico.aliquota) : '0,00',
                        situacao_tributaria: '0',
                        valor_tributavel: this.formatNumber(data.servico.valorServicos),
                        unidade_codigo: '1',
                        unidade_quantidade: '1,00',
                        unidade_valor_unitario: this.formatNumber(data.servico.valorServicos)
                    }
                }
            }
        };

        return '<?xml version="1.0" encoding="ISO-8859-1"?>\n' + this.builder.build(nfseObject);
    }
}

export default new IpmXmlService();
