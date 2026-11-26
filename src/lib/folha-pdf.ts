/**
 * Gerador de PDF Oficial de Holerites e Folha de Pagamento (Art. 464 da CLT)
 * Layout 100% idêntico ao modelo consagrado do 791 Glass.
 */

import type { DemonstrativoColaborador } from '@/lib/folha-pagamento';

const moeda = (valor: number) =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const competenciaLegivel = (competencia: string) => {
  if (!competencia || competencia.length < 7) return competencia;
  return `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
};

export interface EmpregadorFolha {
  nome: string;
  cnpj: string;
  endereco: string;
}

export const EMPREGADOR_PADRAO_HOLDING: EmpregadorFolha = {
  nome: '791 SOLUÇÕES EMPRESARIAIS LTDA',
  cnpj: '14.087.439/0001-09',
  endereco: 'Rua Fernando Bauther da Silva, 791 - Ingleses do Rio Vermelho, Florianópolis - SC, 88058-408'
};

/**
 * Gera o Holerite Oficial em PDF individual ou para todos os colaboradores.
 */
export async function gerarHoleritesPdf(
  colaboradores: DemonstrativoColaborador[],
  competencia: string,
  empregador: EmpregadorFolha = EMPREGADOR_PADRAO_HOLDING
) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const X = 14;
  const LARGURA = 182;
  const larguras = [14, 76, 30, 31, 31];

  colaboradores.forEach((colab, indice) => {
    if (indice > 0) doc.addPage();
    doc.setTextColor(15, 23, 42);
    doc.setDrawColor(90);

    // 1. Quadro do empregador + título do recibo
    let y = 14;
    doc.rect(X, y, LARGURA, 20);
    doc.line(X + 118, y, X + 118, y + 20);

    const xEmpresa = X + 3;
    const larguraEmpresa = 112;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const nomeEmpresa: string[] = doc.splitTextToSize(empregador.nome, larguraEmpresa);
    doc.text(nomeEmpresa, xEmpresa, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const endereco: string[] = doc.splitTextToSize(empregador.endereco || '', larguraEmpresa);
    doc.text(endereco.slice(0, 2), xEmpresa, y + 5.5 + nomeEmpresa.length * 4.5);

    if (empregador.cnpj) {
      doc.text(`CNPJ: ${empregador.cnpj}`, xEmpresa, y + 17.5);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('RECIBO DE PAGAMENTO DE SALÁRIO', X + 121, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Referência: ${competenciaLegivel(competencia)}`, X + 121, y + 17);
    y += 20;

    // 2. Quadro do empregado
    doc.rect(X, y, LARGURA, 12);
    doc.setFontSize(6.5);
    doc.setTextColor(100);
    doc.text('Matrícula', X + 3, y + 3.5);
    doc.text('Nome do Colaborador', X + 28, y + 3.5);
    doc.text('Função / Cargo', X + 98, y + 3.5);
    doc.text('Admissão', X + 138, y + 3.5);
    doc.text('CPF', X + 158, y + 3.5);

    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(colab.matricula || '001', X + 3, y + 9);
    doc.text(doc.splitTextToSize(colab.nome, 66)[0] ?? '', X + 28, y + 9);
    doc.text(doc.splitTextToSize(colab.cargo || 'Colaborador', 37)[0] ?? '', X + 98, y + 9);
    doc.text(colab.admissao || '—', X + 138, y + 9);
    doc.setFontSize(7);
    doc.text(colab.cpf || '—', X + 158, y + 9);
    y += 12;

    // 3. Cabeçalho das rubricas
    const cabecalho = ['Cód.', 'Descrição das Verbas', 'Referência', 'Vencimentos', 'Descontos'];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    let x = X;
    cabecalho.forEach((rotulo, i) => {
      doc.setFillColor(229, 239, 235);
      doc.rect(x, y, larguras[i], 6.5, 'FD');
      doc.text(rotulo, i >= 3 ? x + larguras[i] - 2 : x + 2, y + 4.3, i >= 3 ? { align: 'right' } : undefined);
      x += larguras[i];
    });
    y += 6.5;

    // 4. Rubricas com código sequencial (Apenas proventos e descontos)
    const visiveis = colab.rubricas.filter(r => r.tipo === 'provento' || r.tipo === 'desconto');
    const inicioCorpo = y;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    visiveis.forEach((item) => {
      const descricao: string[] = doc.splitTextToSize(item.descricao, larguras[1] - 4);
      const referencia: string[] = doc.splitTextToSize(item.referencia || '—', larguras[2] - 4);
      const altura = Math.max(descricao.length, referencia.length) * 3.3 + 2.6;

      doc.text(item.codigo, X + 2, y + 3.6);
      doc.text(descricao, X + larguras[0] + 2, y + 3.6);
      doc.text(referencia, X + larguras[0] + larguras[1] + 2, y + 3.6);

      if (item.tipo === 'provento') {
        doc.text(moeda(item.valor), X + 149, y + 3.6, { align: 'right' });
      }
      if (item.tipo === 'desconto') {
        doc.text(moeda(item.valor), X + LARGURA - 2, y + 3.6, { align: 'right' });
      }
      y += altura;
    });

    const fimCorpo = Math.max(y + 2, inicioCorpo + 70);
    // Molduras verticais das colunas do corpo
    doc.rect(X, inicioCorpo, LARGURA, fimCorpo - inicioCorpo);
    let cx = X;
    for (const largura of larguras.slice(0, 4)) {
      cx += largura;
      doc.line(cx, inicioCorpo, cx, fimCorpo);
    }
    y = fimCorpo;

    // 5. Totais e Líquido
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.rect(X, y, 120, 6.5);
    doc.rect(X + 120, y, 31, 6.5);
    doc.rect(X + 151, y, 31, 6.5);

    doc.text('TOTAIS', X + 2, y + 4.3);
    doc.text(moeda(colab.totalProventos), X + 149, y + 4.3, { align: 'right' });
    doc.text(moeda(colab.totalDescontos), X + 180, y + 4.3, { align: 'right' });
    y += 6.5;

    doc.rect(X, y, 151, 7);
    doc.rect(X + 151, y, 31, 7);
    doc.setFontSize(8.5);
    doc.text('VALOR LÍQUIDO A RECEBER  ->', X + 149, y + 4.7, { align: 'right' });
    doc.text(moeda(colab.salarioLiquido), X + 180, y + 4.7, { align: 'right' });
    y += 10;

    // 6. Quadros de Bases Legais no rodapé
    const baseInss = Math.min(colab.salarioBase, 8157.41);
    const quadros: [string, number][] = [
      ['Salário Base', colab.salarioBase],
      ['Sal. Contr. INSS', baseInss],
      ['Base Cálc. FGTS', colab.salarioBase],
      ['FGTS do Mês (8%)', colab.fgts],
      ['Base Cálc. IRRF', Math.max(0, colab.salarioBase - colab.inss - 607.20)]
    ];

    const larguraQuadro = LARGURA / quadros.length;
    quadros.forEach(([rotulo, valor], i) => {
      const qx = X + i * larguraQuadro;
      doc.rect(qx, y, larguraQuadro, 11);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.2);
      doc.setTextColor(100);
      doc.text(doc.splitTextToSize(rotulo, larguraQuadro - 3), qx + 1.5, y + 3.2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text(moeda(valor), qx + larguraQuadro - 1.5, y + 9, { align: 'right' });
    });
    y += 17;

    // 7. Declaração de Recebimento e Assinatura (Art. 464 CLT)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    const declaracao = 'DECLARO TER RECEBIDO A IMPORTÂNCIA LÍQUIDA DISCRIMINADA NESTE RECIBO, CORRESPONDENTE À PRESTAÇÃO DE SERVIÇOS NO MÊS INDICADO.';
    doc.text(doc.splitTextToSize(declaracao, LARGURA), X, y);
    y += 14;

    doc.line(X, y, X + 55, y);
    doc.line(X + 70, y, X + 160, y);
    doc.setFontSize(6.5);
    doc.setTextColor(100);
    doc.text('DATA: _____/_____/_________', X, y + 3.5);
    doc.text('ASSINATURA DO COLABORADOR', X + 70, y + 3.5);
    doc.setTextColor(15, 23, 42);
  });

  // Numeração de páginas e rodapé legal
  for (let pagina = 1; pagina <= doc.getNumberOfPages(); pagina++) {
    doc.setPage(pagina);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text('791 Soluções Holding · Documento emitido eletronicamente em conformidade com o Art. 464 da CLT', 14, 283);
    doc.text(`${pagina} / ${doc.getNumberOfPages()}`, 196, 290, { align: 'right' });
  }

  const filename = colaboradores.length === 1
    ? `holerite-${colaboradores[0].nome.toLowerCase().replace(/\s+/g, '-')}-${competencia}.pdf`
    : `holerites-${competencia}.pdf`;

  return { doc, filename };
}
