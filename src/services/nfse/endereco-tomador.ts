import type { DPSData } from './xml-service';
import municipios from './municipios-ibge.json';

const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

export async function enderecoTomadorNacional(tenant: Record<string, unknown>): Promise<NonNullable<DPSData['tomador']['endereco']>> {
  const texto = (campo: string) => typeof tenant[campo] === 'string' ? tenant[campo].trim() : '';
  const logradouro = texto('endereco') || texto('endereco_completo');
  const numero = texto('numero');
  const bairro = texto('bairro');
  const cep = texto('cep').replace(/\D/g, '');
  const cidade = texto('cidade');
  const uf = texto('estado').toUpperCase();
  if (!logradouro || !numero || !bairro || !/^\d{8}$/.test(cep) || !cidade || !/^[A-Z]{2}$/.test(uf)) {
    throw new Error('Complete o endereço do cliente no Glass: rua, número, bairro, CEP, cidade e UF.');
  }
  const encontrados = municipios.filter(municipio => municipio.uf === uf
    && (municipio.codigo === cidade || normalizar(municipio.nome) === normalizar(cidade)));
  if (encontrados.length !== 1) throw new Error('Município do cliente não encontrado na UF informada. Confira cidade e estado no Glass.');
  return { logradouro, numero, bairro, cep, codigoMunicipio: encontrados[0].codigo, complemento: texto('complemento') || undefined };
}
