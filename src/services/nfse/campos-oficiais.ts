const ROTULOS: Record<string, string> = {
  nNFSe: 'Número da NFS-e', numero_nfse: 'Número da NFS-e', serie_nfse: 'Série',
  dhProc: 'Data e hora de processamento', data_nfse: 'Data de emissão', hora_nfse: 'Hora de emissão',
  dCompet: 'Competência', dhEmi: 'Data e hora de emissão da DPS', nDPS: 'Número da DPS',
  xNome: 'Nome / razão social', nome_razao_social: 'Nome / razão social',
  sobrenome_nome_fantasia: 'Nome fantasia', cpfcnpj: 'CPF / CNPJ', CNPJ: 'CNPJ', CPF: 'CPF',
  IM: 'Inscrição municipal', inscricao_municipal: 'Inscrição municipal', email: 'E-mail', fone: 'Telefone',
  xLgr: 'Logradouro', nro: 'Número', xBairro: 'Bairro', xCpl: 'Complemento', CEP: 'CEP',
  cMun: 'Município (IBGE)', cLocIncid: 'Município de incidência (IBGE)',
  xLocEmi: 'Município de emissão', xLocPrestacao: 'Local da prestação', xLocIncid: 'Município de incidência',
  cTribNac: 'Código de tributação nacional', xTribNac: 'Serviço — tributação nacional',
  cTribMun: 'Código de tributação municipal', xTribMun: 'Serviço — tributação municipal',
  cNBS: 'Código NBS', xNBS: 'Descrição NBS', xDescServ: 'Descrição do serviço', descritivo: 'Descrição do serviço',
  vServ: 'Valor do serviço (R$)', valor_total: 'Valor total (R$)', vLiq: 'Valor líquido (R$)',
  vBC: 'Base de cálculo (R$)', pAliq: 'Alíquota (%)', vISSQN: 'ISSQN apurado (R$)',
  vTotalRet: 'Total das retenções (R$)', vRetIRRF: 'IRRF retido (R$)',
  vRetCSLL: 'CSLL retida (R$)', vRetCP: 'Contribuição previdenciária retida (R$)',
  vPis: 'PIS (R$)', vCofins: 'COFINS (R$)', vPIS: 'PIS (R$)', vCOFINS: 'COFINS (R$)',
  pCBS: 'Alíquota CBS (%)', vCBS: 'CBS (R$)', pIBSUF: 'Alíquota IBS estadual (%)',
  pIBSMun: 'Alíquota IBS municipal (%)', vIBSUF: 'IBS estadual (R$)', vIBSMun: 'IBS municipal (R$)',
  vIBS: 'Total IBS (R$)', CST: 'CST', cClassTrib: 'Classificação tributária',
  opSimpNac: 'Opção pelo Simples Nacional (código oficial)', regApTribSN: 'Regime de apuração do Simples (código oficial)',
  regEspTrib: 'Regime especial de tributação (código oficial)', tribISSQN: 'Tributação ISSQN (código oficial)',
  tpRetISSQN: 'Retenção ISSQN (código oficial)', pTotTribSN: 'Tributos aproximados do Simples (%)',
  chave_acesso_nfse_nacional: 'Chave de acesso nacional', cod_verificador_autenticidade: 'Código de verificação',
  situacao_descricao_nfse: 'Situação na prefeitura', xInfComp: 'Informações complementares',
};

export function rotuloCampoOficial(caminho: string): string {
  const tag = caminho.split('/').pop()?.replace(/^@_/, '') || caminho;
  return ROTULOS[tag] || tag.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function grupoCampoOficial(caminho: string): string {
  if (/IBSCBS|ibs|cbs/i.test(caminho)) return 'Tributação IBS/CBS';
  if (/tomador|\/toma\//i.test(caminho)) return 'Tomador do serviço';
  if (/prestador|\/emit\/|\/prest\//i.test(caminho)) return 'Prestador do serviço';
  if (/\/valores\/|\/tribMun\/|\/tribFed\//i.test(caminho)) return 'Tributação e valores';
  if (/\/serv\/|\/itens\//i.test(caminho)) return 'Serviço prestado';
  return 'Dados da NFS-e';
}
