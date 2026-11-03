import { writeFile } from 'node:fs/promises';

const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios', {
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Consulta IBGE falhou: HTTP ${response.status}`);
const municipios = await response.json();
if (!Array.isArray(municipios) || municipios.length < 5500) throw new Error('Lista IBGE incompleta.');
const lista = municipios.map(municipio => {
  const uf = municipio.microrregiao?.mesorregiao?.UF?.sigla
    || municipio['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla;
  if (!Number.isInteger(municipio.id) || !/^\d{7}$/.test(String(municipio.id))
    || typeof municipio.nome !== 'string' || !/^[A-Z]{2}$/.test(uf || '')) {
    throw new Error('Município inválido na lista IBGE.');
  }
  return { codigo: String(municipio.id), nome: municipio.nome, uf };
}).sort((a, b) => a.codigo.localeCompare(b.codigo));
if (new Set(lista.map(municipio => municipio.codigo)).size !== lista.length) throw new Error('Códigos IBGE repetidos.');
await writeFile(new URL('../src/services/nfse/municipios-ibge.json', import.meta.url), `${JSON.stringify(lista, null, 2)}\n`);
console.log(`Lista local atualizada: ${lista.length} municípios do IBGE.`);
