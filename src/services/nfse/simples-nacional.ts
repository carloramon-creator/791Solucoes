export interface HistoricoFiscal {
  inicioAtividade: string;
  apuracao: 'competencia';
  semFolha: boolean;
  semReceitasExternas?: boolean;
  receitasExternas: Record<string, number>;
  folha: Record<string, number>;
  historicoConfirmadoAte: string;
}

const FAIXAS = {
  III: [[180000, 6, 0], [360000, 11.2, 9360], [720000, 13.5, 17640], [1800000, 16, 35640], [3600000, 21, 125640]],
  V: [[180000, 15.5, 0], [360000, 18, 4500], [720000, 19.5, 9900], [1800000, 20.5, 17100], [3600000, 23, 62100]],
} as const;

export function mesesAnteriores(competencia: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(competencia) || Number(competencia.slice(5)) < 1 || Number(competencia.slice(5)) > 12) {
    throw new Error('Competência fiscal inválida.');
  }
  const [ano, mes] = competencia.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(ano, mes - 13 + i, 1)).toISOString().slice(0, 7));
}

export function calcularSimples(
  competencia: string, historico: HistoricoFiscal, receitasSistema: Record<string, number>,
) {
  const meses = mesesAnteriores(competencia);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(historico.inicioAtividade)
    || !Number.isFinite(Date.parse(historico.inicioAtividade))
    || new Date(historico.inicioAtividade).toISOString().slice(0, 10) !== historico.inicioAtividade) throw new Error('Início da atividade não informado.');
  if (historico.inicioAtividade.slice(0, 7) > meses[0]) {
    throw new Error('Empresa com menos de 12 meses: receita proporcionalizada ainda não suportada neste fluxo.');
  }
  if (historico.apuracao !== 'competencia') throw new Error('Configure a apuração por competência confirmada no PGDAS-D.');
  if ((!historico.semFolha || !historico.semReceitasExternas) && historico.historicoConfirmadoAte < meses[meses.length - 1]) {
    throw new Error('Atualize o histórico externo e de folha até o último mês anterior à competência.');
  }
  let rbt12 = 0, fs12 = 0;
  for (const mes of meses) {
    if (!historico.semReceitasExternas && !Object.hasOwn(historico.receitasExternas, mes)) {
      throw new Error(`Receita externa de ${mes} não confirmada. Informe zero explicitamente quando não houver receita.`);
    }
    const externa = historico.receitasExternas[mes] ?? 0;
    if (historico.semReceitasExternas && externa !== 0) throw new Error('A declaração sem receitas externas conflita com o histórico informado.');
    if (historico.semFolha && (historico.folha[mes] ?? 0) !== 0) throw new Error('A declaração sem folha conflita com o histórico informado.');
    const sistema = receitasSistema[mes] ?? 0;
    const folha = historico.semFolha ? 0 : historico.folha[mes];
    if (folha === undefined) throw new Error(`Folha e encargos pagos de ${mes} não informados.`);
    if ([externa, sistema, folha].some(v => !Number.isFinite(v) || v < 0)) throw new Error(`Valores fiscais inválidos em ${mes}.`);
    rbt12 += externa + sistema;
    fs12 += folha;
  }
  if (rbt12 > 3600000) throw new Error('RBT12 acima do sublimite de R$ 3.600.000: revise ISS e enquadramento antes de emitir.');
  const fatorR = rbt12 === 0 ? (fs12 === 0 ? 0.01 : 0.28) : (fs12 === 0 ? 0.01 : fs12 / rbt12);
  const anexo = fatorR >= 0.28 ? 'III' : 'V';
  const indice = FAIXAS[anexo].findIndex(([limite]) => rbt12 <= limite);
  const [, nominal, deducao] = FAIXAS[anexo][indice];
  const efetiva = rbt12 === 0 ? nominal : (rbt12 * nominal / 100 - deducao) / rbt12 * 100;
  return {
    competencia, meses, rbt12: Math.round(rbt12 * 100) / 100, fs12: Math.round(fs12 * 100) / 100,
    fatorR, anexo, faixa: indice + 1, aliquotaNominal: nominal, deducao,
    percentual: Math.round(efetiva * 100) / 100,
  };
}
