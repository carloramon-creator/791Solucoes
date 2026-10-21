import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface CampoOficial {
  caminho: string;
  valor: string;
}

export interface DocumentoOficial {
  formato: 'ipm' | 'nacional';
  campos: CampoOficial[];
}

/** Mantém os valores textuais do fisco, inclusive zeros, sem recalcular tributos. */
export function lerDocumentoOficial(xml: string): DocumentoOficial {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('XML oficial inválido ou acima do limite permitido.');
  }
  if (XMLValidator.validate(xml) !== true) throw new Error('XML oficial malformado.');
  const parser = new XMLParser({
    ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false,
    parseAttributeValue: false, trimValues: false,
  });
  const raiz: unknown = parser.parse(xml);
  const campos: CampoOficial[] = [];
  const visitar = (no: unknown, caminho: string) => {
    if (Array.isArray(no)) {
      no.forEach((item, i) => visitar(item, `${caminho}[${i + 1}]`));
    } else if (no && typeof no === 'object') {
      for (const [tag, valor] of Object.entries(no)) {
        if (tag === 'Signature' || tag.startsWith('?')) continue;
        visitar(valor, caminho ? `${caminho}/${tag}` : tag);
      }
    } else if (no !== undefined && no !== null && String(no).trim() !== '') {
      campos.push({ caminho, valor: String(no) });
    }
  };
  visitar(raiz, '');
  const nacional = campos.some(c => /(^|\/)infNFSe\/nNFSe$/.test(c.caminho));
  const ipm = campos.some(c => /(^|\/)nf\/numero_nfse$/.test(c.caminho));
  if (!nacional && !ipm) throw new Error('O retorno não contém uma NFS-e oficial completa. Abra o documento original no portal fiscal.');
  return { formato: nacional ? 'nacional' : 'ipm', campos };
}
