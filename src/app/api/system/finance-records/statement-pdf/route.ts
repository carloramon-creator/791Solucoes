import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { notoSansBase64 } from '@/services/nfse/noto-sans-base64';

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

function toShortDateLabel(value: string) {
  const text = sanitizeCell(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${day}/${month}/${year.slice(-2)}`;
  }
  return text;
}

function parseCurrencyNumber(value: string) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const normalized = text
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as StatementPayload;
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!columns.length) {
      return NextResponse.json({ error: 'Nenhuma coluna recebida para gerar o extrato.' }, { status: 400 });
    }

    const appFontBuffer = Buffer.from(notoSansBase64, 'base64');
    const doc = new PDFDocument({ size: 'A4', margin: 30, font: appFontBuffer as any, bufferPages: true });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    // Use embedded font to avoid runtime dependency on pdfkit AFM font files.
    doc.registerFont('AppFont', appFontBuffer);
    doc.font('AppFont');

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
      doc.image(logoPath, doc.page.margins.left, y, { width: 40 });
    }

    doc.font('AppFont').fontSize(14).fillColor('#0F172A').text('791 Soluções', doc.page.margins.left + 50, y + 2);
    doc.font('AppFont').fontSize(8).fillColor('#334155').text(`Usuário: ${userLabel}`, doc.page.margins.left, y + 3, {
      width: pageWidth,
      align: 'right',
    });
    doc.font('AppFont').fontSize(8).fillColor('#64748B').text(`Gerado em: ${generatedAt}`, doc.page.margins.left, y + 16, {
      width: pageWidth,
      align: 'right',
    });

    y += 46;

    doc.roundedRect(doc.page.margins.left, y, pageWidth, 44, 8).fillAndStroke('#F8FAFC', '#CBD5E1');
    doc.fillColor('#0F172A').font('AppFont').fontSize(13).text(title, doc.page.margins.left + 12, y + 10, { width: pageWidth - 24 });
    doc.fillColor('#475569').font('AppFont').fontSize(8).text(`${sectionLabel} | ${periodLabel}`, doc.page.margins.left + 12, y + 27, { width: pageWidth - 24 });

    y += 54;

    const explicitWidths = columns.map((column) => {
      const key = String(column || '').toLowerCase();
      if (key.includes('data')) return 52;
      if (key.includes('status')) return 58;
      if (key.includes('valor')) return 62;
      if (key.includes('saldo')) return 58;
      if (key.includes('lançamento') || key.includes('lancamento') || key.includes('descrição') || key.includes('descricao')) return 194;
      if (key.includes('documento')) return 88;
      if (key.includes('conta')) return 92;
      if (key.includes('método') || key.includes('metodo')) return 72;
      if (key.includes('categoria')) return 86;
      return null;
    });

    const knownWidth = explicitWidths.reduce((sum, width) => sum + (width || 0), 0);
    const unknownCount = explicitWidths.filter((width) => width === null).length;
    const fallbackWidth = unknownCount > 0 ? Math.max((pageWidth - knownWidth) / unknownCount, 60) : 0;

    let colWidths = explicitWidths.map((width) => Math.floor(width ?? fallbackWidth));
    const colSum = colWidths.reduce((sum, width) => sum + width, 0);

    if (colSum > pageWidth) {
      const factor = pageWidth / colSum;
      colWidths = colWidths.map((width) => Math.floor(width * factor));
    }

    const usedWidth = colWidths.reduce((sum, value) => sum + value, 0);
    colWidths[colWidths.length - 1] += pageWidth - usedWidth;

    const rightAlignedIndexes = new Set(
      columns
        .map((column, index) => ({ column: String(column || '').toLowerCase(), index }))
        .filter(({ column }) => column.includes('valor') || column.includes('saldo'))
        .map(({ index }) => index)
    );

    const drawHeader = () => {
      let x = doc.page.margins.left;
      const headerHeight = 22;

      columns.forEach((column, index) => {
        const width = colWidths[index];
        doc.rect(x, y, width, headerHeight).fillAndStroke('#E2E8F0', '#94A3B8');
        doc.fillColor('#0F172A').font('AppFont').fontSize(8).text(sanitizeCell(column), x + 6, y + 8, {
          width: width - 12,
          height: headerHeight - 8,
          align: rightAlignedIndexes.has(index) ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
        x += width;
      });

      y += headerHeight;
    };

    const drawRow = (row: string[], isEven: boolean) => {
      let x = doc.page.margins.left;
      const rowHeight = 19;
      const backgroundColor = isEven ? '#FFFFFF' : '#F8FAFC';

      row.forEach((cell, index) => {
        const width = colWidths[index];
        const value = sanitizeCell(cell);
        const isNumericColumn = rightAlignedIndexes.has(index);
        const parsed = parseCurrencyNumber(value);
        const isNegative = value.includes('-') || parsed < 0;
        const isPositive = value.includes('+') || parsed > 0;

        doc.rect(x, y, width, rowHeight).fillAndStroke(backgroundColor, '#CBD5E1');
        doc.fillColor(isNumericColumn ? (isNegative ? '#DC2626' : isPositive ? '#15803D' : '#0F172A') : '#0F172A')
          .font('AppFont')
          .fontSize(8)
          .text(value, x + 6, y + 5.5, {
          width: width - 12,
          height: rowHeight - 8,
          align: isNumericColumn ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
        x += width;
      });

      y += rowHeight;
    };

    drawHeader();

    rows.forEach((row, index) => {
      if (y + 24 > pageBottom - 16) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }

      const normalizedRow = columns.map((_, colIndex) => {
        const columnKey = String(columns[colIndex] || '').toLowerCase();
        const cell = sanitizeCell(row?.[colIndex] || '');
        if (columnKey.includes('data')) return toShortDateLabel(cell);
        return cell;
      });
      drawRow(normalizedRow, index % 2 === 0);
    });

    if (rows.length === 0) {
      doc.rect(doc.page.margins.left, y, pageWidth, 26).fillAndStroke('#FFFFFF', '#CBD5E1');
      doc.fillColor('#64748B').font('AppFont').fontSize(9).text('Nenhum registro para o filtro selecionado.', doc.page.margins.left + 8, y + 9);
    }

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      const footerY = doc.page.height - doc.page.margins.bottom - 8;
      doc.fillColor('#64748B').font('AppFont').fontSize(8).text(`${index + 1}/${range.count}`, doc.page.margins.left, footerY, {
        width: pageWidth,
        align: 'right',
      });
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
