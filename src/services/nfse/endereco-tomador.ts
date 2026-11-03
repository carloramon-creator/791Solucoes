import type { DPSData } from './xml-service';

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
  // Consulta apenas a lista pública de municípios da UF; não envia dados do cliente ao IBGE.
  const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Não foi possível consultar os municípios no IBGE (HTTP ${response.status}).`);
  const municipios: unknown = await response.json();
  if (!Array.isArray(municipios)) throw new Error('Resposta inválida na consulta de municípios do IBGE.');
  const encontrados = municipios.filter((municipio: unknown): municipio is { id: number; nome: string } =>
    municipio !== null && typeof municipio === 'object'
    && 'id' in municipio && typeof municipio.id === 'number' && /^\d{7}$/.test(String(municipio.id))
    && 'nome' in municipio && typeof municipio.nome === 'string'
    && (String(municipio.id) === cidade || normalizar(municipio.nome) === normalizar(cidade)));
  if (encontrados.length !== 1) throw new Error('Município do cliente não encontrado na UF informada. Confira cidade e estado no Glass.');
  return { logradouro, numero, bairro, cep, codigoMunicipio: String(encontrados[0].id), complemento: texto('complemento') || undefined };
}
