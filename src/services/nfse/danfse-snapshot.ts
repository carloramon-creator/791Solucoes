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
  /** 'oficial_prefeitura': recuperado do XML oficial baixado do portal da prefeitura. */
  origem: 'emissao' | 'retroativo' | 'oficial_prefeitura';
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
    nome_fantasia?: string | null;
    telefone?: string | null;
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
    chave_acesso_nacional?: string | null;
    situacao?: string | null;
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
    chave_acesso_nacional: campo('chave_acesso_nfse_nacional'),
    situacao: campo('situacao_descricao_nfse'),
  };
}

// Códigos TOM (Receita/SIAFI) usados pela IPM.
const MUNICIPIOS_TOM: Record<string, string> = { '8327': 'São José' };

const decimalBr = (v: string | null) => {
  if (v == null) return null;
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const telefone = (ddd: string | null, fone: string | null) => {
  const f = fone && fone !== '0' ? fone : null;
  if (!f) return null;
  return ddd && ddd !== '0' ? `${ddd}${f}` : f;
};

/**
 * Monta o retrato a partir do XML oficial da NFS-e (portal IPM, botão "XML IPM").
 * O XML oficial não traz razão social nem endereço do prestador (e às vezes nem a IM);
 * eles vêm do documento oficial da prefeitura e precisam ser informados por quem chama.
 */
export function lerNfseOficialIpm(
  xml: string,
  prestador: Omit<DanfseSnapshot['prestador'], 'cnpj'>,
): DanfseSnapshot {
  const bloco = (tag: string) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
  const campoEm = (trecho: string) => (tag: string) =>
    texto(trecho.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]);

  const nf = campoEm(bloco('nf'));
  const pr = campoEm(bloco('prestador'));
  const to = campoEm(bloco('tomador'));
  const item = campoEm(bloco('lista'));

  const numero = nf('numero_nfse');
  const valor = decimalBr(nf('valor_total'));
  if (!numero || valor == null) throw new Error('XML oficial sem número ou valor da NFS-e');

  const cidadeTom = to('cidade');
  return {
    versao: 1,
    origem: 'oficial_prefeitura',
    congelado_em: new Date().toISOString(),
    prestador: {
      ...prestador,
      cnpj: pr('cpfcnpj'),
      inscricao_municipal: pr('inscricao_municipal') || prestador.inscricao_municipal,
    },
    tomador: {
      razao_social: to('nome_razao_social'),
      nome_fantasia: to('sobrenome_nome_fantasia'),
      telefone:
        telefone(to('ddd_fone_comercial'), to('fone_comercial')) ||
        telefone(to('ddd_fone_residencial'), to('fone_residencial')),
      documento: to('cpfcnpj'),
      inscricao_municipal: to('inscricao_municipal'),
      email: to('email'),
      endereco: endereco({
        logradouro: [to('logradouro'), to('complemento')].filter(Boolean).join(' - '),
        numero: to('numero_residencia'),
        bairro: to('bairro'),
        cidade: cidadeTom ? MUNICIPIOS_TOM[cidadeTom] ?? `TOM ${cidadeTom}` : null,
        uf: to('estado'),
        cep: to('cep'),
      }),
    },
    servico: {
      valor,
      codigo: item('codigo_item_lista_servico'),
      aliquota: decimalBr(item('aliquota_item_lista_servico')),
      discriminacao: item('descritivo') || nf('observacao'),
    },
    retorno: {
      numero,
      serie: nf('serie_nfse'),
      data: nf('data_nfse'),
      hora: nf('hora_nfse'),
      codigo_verificacao: nf('cod_verificador_autenticidade'),
      link: nf('link_nfse'),
      chave_acesso_nacional: nf('chave_acesso_nfse_nacional'),
      situacao: nf('situacao_descricao_nfse'),
    },
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
