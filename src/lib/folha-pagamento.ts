/**
 * Motor de Cálculo da Folha de Pagamento (CLT / eSocial / Legislação Vigente 2025/2026)
 * Portado com paridade do 791 Glass.
 */

export interface ParametrosLegaisFolha {
  salario_minimo: number;
  teto_inss: number;
  fgts_aliquota: number;
  inss_faixas: { ate: number; aliquota: number }[];
  irrf_faixas: { ate: number | null; aliquota: number; deducao: number }[];
  irrf_deducao_dependente: number;
  irrf_desconto_simplificado: number;
  salario_familia_valor: number;
  salario_familia_teto: number;
}

export const PARAMETROS_LEGAIS_PADRAO: ParametrosLegaisFolha = {
  salario_minimo: 1518.00,
  teto_inss: 8157.41,
  fgts_aliquota: 8.0,
  inss_faixas: [
    { ate: 1518.00, aliquota: 7.5 },
    { ate: 2793.88, aliquota: 9.0 },
    { ate: 4190.83, aliquota: 12.0 },
    { ate: 8157.41, aliquota: 14.0 }
  ],
  irrf_faixas: [
    { ate: 2428.80, aliquota: 0, deducao: 0 },
    { ate: 2826.65, aliquota: 7.5, deducao: 182.16 },
    { ate: 3751.05, aliquota: 15.0, deducao: 394.16 },
    { ate: 4664.68, aliquota: 22.5, deducao: 675.49 },
    { ate: null, aliquota: 27.5, deducao: 908.73 }
  ],
  irrf_deducao_dependente: 189.59,
  irrf_desconto_simplificado: 607.20,
  salario_familia_valor: 65.00,
  salario_familia_teto: 1906.04
};

export const arredondar = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Cálculo progressivo de INSS pelas faixas legais.
 */
export function calcularINSS(salarioBruto: number, params: ParametrosLegaisFolha = PARAMETROS_LEGAIS_PADRAO): number {
  const salarioContribuicao = Math.min(Math.max(salarioBruto, 0), params.teto_inss);
  let total = 0;
  let anterior = 0;

  for (const faixa of params.inss_faixas) {
    const tributavel = Math.min(salarioContribuicao, faixa.ate) - anterior;
    if (tributavel <= 0) break;
    total += tributavel * (faixa.aliquota / 100);
    anterior = faixa.ate;
  }

  return arredondar(total);
}

/**
 * Cálculo de IRRF (compara deduções legais com desconto simplificado e aplica o mais benéfico).
 */
export function calcularIRRF(
  baseBruta: number,
  inss: number,
  dependentes: number = 0,
  params: ParametrosLegaisFolha = PARAMETROS_LEGAIS_PADRAO
): { valor: number; base: number; simplificado: boolean } {
  const baseLegal = Math.max(0, baseBruta - inss - dependentes * params.irrf_deducao_dependente);
  const baseSimplificada = Math.max(0, baseBruta - params.irrf_desconto_simplificado);

  const irrfPorBase = (b: number) => {
    if (b <= 0) return 0;
    for (const faixa of params.irrf_faixas) {
      if (faixa.ate === null || b <= faixa.ate) {
        return Math.max(0, arredondar(b * (faixa.aliquota / 100) - faixa.deducao));
      }
    }
    return 0;
  };

  const impostoLegal = irrfPorBase(baseLegal);
  const impostoSimplificado = irrfPorBase(baseSimplificada);

  if (impostoSimplificado < impostoLegal) {
    return { valor: impostoSimplificado, base: arredondar(baseSimplificada), simplificado: true };
  }
  return { valor: impostoLegal, base: arredondar(baseLegal), simplificado: false };
}

export interface RubricaHolerite {
  codigo: string;
  descricao: string;
  tipo: 'provento' | 'desconto' | 'informativo';
  referencia: string;
  valor: number;
}

export interface DemonstrativoColaborador {
  id: string;
  nome: string;
  matricula: string;
  cargo: string;
  cpf: string;
  admissao: string;
  salarioBase: number;
  inss: number;
  irrf: number;
  fgts: number;
  totalProventos: number;
  totalDescontos: number;
  salarioLiquido: number;
  rubricas: RubricaHolerite[];
}

/**
 * Processa a folha de um colaborador gerando demonstrativo analítico e rubricas do holerite.
 */
export function processarFolhaColaborador(
  dados: {
    id: string;
    nome: string;
    matricula: string;
    cargo?: string;
    cpf?: string;
    admissao?: string;
    salario?: number;
    dependentes?: number;
  },
  params: ParametrosLegaisFolha = PARAMETROS_LEGAIS_PADRAO
): DemonstrativoColaborador {
  const salario = Number(dados.salario) > 0 ? Number(dados.salario) : params.salario_minimo;
  const inss = calcularINSS(salario, params);
  const irrfObj = calcularIRRF(salario, inss, dados.dependentes || 0, params);
  const irrf = irrfObj.valor;
  const fgts = arredondar(salario * (params.fgts_aliquota / 100));

  const totalProventos = salario;
  const totalDescontos = arredondar(inss + irrf);
  const salarioLiquido = arredondar(totalProventos - totalDescontos);

  const rubricas: RubricaHolerite[] = [
    {
      codigo: '001',
      descricao: 'Salário Base Mensal',
      tipo: 'provento',
      referencia: '30 dias',
      valor: salario
    },
    {
      codigo: '101',
      descricao: 'INSS Folha',
      tipo: 'desconto',
      referencia: `Base R$ ${Math.min(salario, params.teto_inss).toFixed(2)}`,
      valor: inss
    }
  ];

  if (irrf > 0) {
    rubricas.push({
      codigo: '102',
      descricao: 'IRRF Folha',
      tipo: 'desconto',
      referencia: irrfObj.simplificado ? 'Desc. Simplificado' : 'Dedução Legal',
      valor: irrf
    });
  }

  rubricas.push(
    {
      codigo: '901',
      descricao: 'Base de Cálculo INSS',
      tipo: 'informativo',
      referencia: '',
      valor: Math.min(salario, params.teto_inss)
    },
    {
      codigo: '902',
      descricao: 'Base de Cálculo FGTS',
      tipo: 'informativo',
      referencia: '',
      valor: salario
    },
    {
      codigo: '903',
      descricao: `FGTS do Mês (${params.fgts_aliquota}%)`,
      tipo: 'informativo',
      referencia: 'Depósito Empresa',
      valor: fgts
    },
    {
      codigo: '904',
      descricao: 'Base de Cálculo IRRF',
      tipo: 'informativo',
      referencia: '',
      valor: irrfObj.base
    }
  );

  return {
    id: dados.id,
    nome: dados.nome,
    matricula: dados.matricula || '001',
    cargo: dados.cargo || 'Colaborador',
    cpf: dados.cpf || '—',
    admissao: dados.admissao || new Date().toISOString().slice(0, 10),
    salarioBase: salario,
    inss,
    irrf,
    fgts,
    totalProventos,
    totalDescontos,
    salarioLiquido,
    rubricas
  };
}
