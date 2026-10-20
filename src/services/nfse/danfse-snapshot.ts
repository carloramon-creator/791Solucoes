// Retrato imutável dos dados da NFS-e no momento da emissão.
// A DANFSe deve ser impressa só a partir dele, nunca do cadastro atual.

export interface DanfseEndereco {
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface DanfseSnapshot {
  versao: 1;
  origem: 'emissao' | 'retroativo';
  congelado_em: string;
  prestador: {
    razao_social: string | null;
    cnpj: string | null;
    inscricao_municipal: string | null;
    telefone: string | null;
    endereco: DanfseEndereco | null;
  };
  tomador: {
    razao_social: string | null;
    documento: string | null;
    inscricao_municipal: string | null;
    email: string | null;
    endereco: DanfseEndereco | null;
  };
  servico: {
    valor: number;
    codigo: string | null;
    aliquota: number | null;
    discriminacao: string | null;
  };
  retorno: {
    numero: string | null;
    serie: string | null;
    data: string | null;
    hora: string | null;
    codigo_verificacao: string | null;
    link: string | null;
  };
}

const texto = (v: unknown) => {
  const t = v == null ? '' : String(v).trim();
  return t || null;
};

type Dados = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function endereco(e: Dados | null | undefined): DanfseEndereco | null {
  if (!e) return null;
  const r = {
    logradouro: texto(e.logradouro),
    numero: texto(e.numero),
    bairro: texto(e.bairro),
    cidade: texto(e.cidade),
    uf: texto(e.uf ?? e.estado),
    cep: texto(e.cep),
  };
  return Object.values(r).some(Boolean) ? r : null;
}

/** Lê os campos do XML de retorno da IPM (formato <retorno>). */
export function lerRetornoIpm(xml: unknown, link?: unknown): DanfseSnapshot['retorno'] {
  const s = typeof xml === 'string' ? xml : '';
  const campo = (tag: string) => texto(s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]);
  return {
    numero: campo('numero_nfse'),
    serie: campo('serie_nfse'),
    data: campo('data_nfse'),
    hora: campo('hora_nfse'),
    codigo_verificacao: campo('cod_verificador_autenticidade'),
    link: campo('link_nfse') || texto(link),
  };
}

/** Monta o retrato a partir exatamente dos dados enviados à prefeitura. */
export function montarSnapshotDanfse({
  dpsData,
  config,
  retornoXml,
  accessLink,
}: {
  dpsData: Dados;
  config: Dados;
  retornoXml?: unknown;
  accessLink?: unknown;
}): DanfseSnapshot {
  const aliquota = Number(dpsData?.servico?.aliquota);
  return {
    versao: 1,
    origem: 'emissao',
    congelado_em: new Date().toISOString(),
    prestador: {
      razao_social: texto(dpsData?.prestador?.razaoSocial),
      cnpj: texto(dpsData?.prestador?.cnpj),
      inscricao_municipal: texto(dpsData?.prestador?.inscricaoMunicipal),
      telefone: texto(config?.telefone),
      endereco: endereco(dpsData?.prestador?.endereco),
    },
    tomador: {
      razao_social: texto(dpsData?.tomador?.razaoSocial),
      documento: texto(dpsData?.tomador?.cnpj ?? dpsData?.tomador?.cpf),
      inscricao_municipal: texto(dpsData?.tomador?.inscricaoMunicipal),
      email: texto(dpsData?.tomador?.email),
      endereco: endereco(dpsData?.tomador?.endereco),
    },
    servico: {
      valor: Number(dpsData?.servico?.valorServicos) || 0,
      codigo: texto(dpsData?.servico?.codigoItemListaServico),
      aliquota: Number.isFinite(aliquota) ? aliquota : null,
      discriminacao: texto(dpsData?.servico?.discriminacao),
    },
    retorno: lerRetornoIpm(retornoXml, accessLink),
  };
}
