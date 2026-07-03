import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';

interface StatementPayload {
  title?: string;
  sectionLabel?: string;
  userLabel?: string;
  generatedAt?: string;
  periodLabel?: string;
  columns?: string[];
  rows?: string[][];
}

function formatDateTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return new Date().toLocaleString('pt-BR');
  return date.toLocaleString('pt-BR');
}

function sanitizeCell(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as StatementPayload;
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!columns.length) {
      return NextResponse.json({ error: 'Nenhuma coluna recebida para gerar o extrato.' }, { status: 400 });
    }

    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    doc.pipe(stream);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    const generatedAt = formatDateTime(payload.generatedAt);
    const title = sanitizeCell(payload.title || 'Extrato financeiro');
    const sectionLabel = sanitizeCell(payload.sectionLabel || 'Financeiro');
    const userLabel = sanitizeCell(payload.userLabel || 'Usuário');
    const periodLabel = sanitizeCell(payload.periodLabel || 'Período atual');

    let y = doc.page.margins.top;

    const logoPath = path.join(process.cwd(), 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, doc.page.margins.left, y, { width: 52 });
    }

    doc.font('Helvetica-Bold').fontSize(14).fillColor('#0F172A').text('791 Soluções', doc.page.margins.left + 64, y + 4);
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Usuário: ${userLabel}`, doc.page.margins.left + 64, y + 22);
    doc.text(`Gerado em: ${generatedAt}`, doc.page.margins.left + 64, y + 35);

    y += 64;

    doc.roundedRect(doc.page.margins.left, y, pageWidth, 52, 8).fillAndStroke('#F8FAFC', '#CBD5E1');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(13).text(title, doc.page.margins.left + 14, y + 12, { width: pageWidth - 28 });
    doc.fillColor('#475569').font('Helvetica').fontSize(9).text(`${sectionLabel} | ${periodLabel}`, doc.page.margins.left + 14, y + 31, { width: pageWidth - 28 });

    y += 68;

    const colCount = columns.length;
    const baseWidth = pageWidth / colCount;
    const colWidths = columns.map((_, index) => {
      if (colCount <= 3) return baseWidth;
      if (index === 0) return Math.floor(baseWidth * 0.85);
      if (index === colCount - 1) return Math.floor(baseWidth * 1.1);
      return Math.floor(baseWidth);
    });

    const usedWidth = colWidths.reduce((sum, value) => sum + value, 0);
    colWidths[colWidths.length - 1] += pageWidth - usedWidth;

    const drawHeader = () => {
      let x = doc.page.margins.left;
      const headerHeight = 24;

      columns.forEach((column, index) => {
        const width = colWidths[index];
        doc.rect(x, y, width, headerHeight).fillAndStroke('#E2E8F0', '#94A3B8');
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8).text(sanitizeCell(column), x + 6, y + 8, {
          width: width - 12,
          height: headerHeight - 8,
          ellipsis: true,
        });
        x += width;
      });

      y += headerHeight;
    };

    const drawRow = (row: string[], isEven: boolean) => {
      let x = doc.page.margins.left;
      const rowHeight = 22;
      const backgroundColor = isEven ? '#FFFFFF' : '#F8FAFC';

      row.forEach((cell, index) => {
        const width = colWidths[index];
        doc.rect(x, y, width, rowHeight).fillAndStroke(backgroundColor, '#CBD5E1');
        doc.fillColor('#0F172A').font('Helvetica').fontSize(8).text(sanitizeCell(cell), x + 6, y + 7, {
          width: width - 12,
          height: rowHeight - 8,
          ellipsis: true,
        });
        x += width;
      });

      y += rowHeight;
    };

    drawHeader();

    rows.forEach((row, index) => {
      if (y + 24 > pageBottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }

      const normalizedRow = columns.map((_, colIndex) => sanitizeCell(row?.[colIndex] || ''));
      drawRow(normalizedRow, index % 2 === 0);
    });

    if (rows.length === 0) {
      doc.rect(doc.page.margins.left, y, pageWidth, 26).fillAndStroke('#FFFFFF', '#CBD5E1');
      doc.fillColor('#64748B').font('Helvetica').fontSize(9).text('Nenhum registro para o filtro selecionado.', doc.page.margins.left + 8, y + 9);
    }

    doc.end();

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="extrato-financeiro.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Falha ao gerar extrato em PDF.' }, { status: 500 });
  }
}
