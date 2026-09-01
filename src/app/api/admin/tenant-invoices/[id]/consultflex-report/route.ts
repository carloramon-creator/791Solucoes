import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { getGlassClient } from '@/lib/glass-client';

const text = (value: unknown, fallback = '-') => String(value || '').trim() || fallback;
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
const formatReference = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : text(value);
};
const formatPeriod = (start: unknown, end: unknown) => {
  const startDate = new Date(String(start || '')); const endDate = new Date(String(end || ''));
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return '-';
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const format = (date: Date) => date.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${format(startDate)} à ${format(endDate)}`;
};
const formatReferenceMonth = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return text(value);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[Number(match[2]) - 1]}/${match[1].slice(-2)}`;
};
const formatDocument = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return text(value, 'Documento não informado');
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const { data: record, error } = await supabaseServer.from('system_finance_records').select('id, value, description, metadata').eq('id', id).eq('metadata->>kind', 'overage').single();
  if (error || !record) return NextResponse.json({ error: 'Excedente não encontrado.' }, { status: 404 });

  const metadata = (record.metadata || {}) as Record<string, any>;
  if (!metadata.tenant_id || !metadata.period_start || !metadata.period_end) {
    return NextResponse.json({ error: 'A fatura não possui vidraçaria ou período de excedente.' }, { status: 422 });
  }

  let rows: any[] = [];
  let glass: Awaited<ReturnType<typeof getGlassClient>>;
  try {
    glass = await getGlassClient();
    const orcamentosResult = await glass
      .from('orcamentos')
      .select('id, vendedor_id')
      .eq('vidracaria_id', metadata.tenant_id);
    if (orcamentosResult.error) return NextResponse.json({ error: `Falha ao consultar orçamentos no Glass: ${orcamentosResult.error.message}` }, { status: 502 });

    const orcamentos = orcamentosResult.data || [];
    const orcamentoIds = orcamentos.map((row: any) => String(row.id)).filter(Boolean);
    const sellerByBudget = Object.fromEntries(orcamentos.map((row: any) => [String(row.id), row.vendedor_id]));

    for (let index = 0; index < orcamentoIds.length; index += 500) {
      const result = await glass
        .from('orcamento_credito_consultas')
        .select('*')
        .in('orcamento_id', orcamentoIds.slice(index, index + 500))
        .in('tipo_consulta', ['basico', 'completo'])
        .gte('created_at', metadata.period_start)
        .lt('created_at', metadata.period_end)
        .order('created_at');
      if (result.error) return NextResponse.json({ error: `Falha ao consultar consumos excedentes no Glass: ${result.error.message}` }, { status: 502 });
      rows.push(...(result.data || []).map((row: any) => ({ ...row, _seller_id: sellerByBudget[String(row.orcamento_id)] || null })));
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao conectar ao Glass para gerar o demonstrativo.' }, { status: 502 });
  }

  const userIds = Array.from(new Set((rows || []).map((row: any) => text(row.usuario_id, '')).filter(Boolean)));
  const sellerIds = Array.from(new Set((rows || []).map((row: any) => text(row?._seller_id, '')).filter(Boolean)));
  const [usersResult, sellersResult, tenantResult] = await Promise.all([
    userIds.length ? glass.from('user_profiles').select('user_id, nome_exibicao').in('user_id', userIds) : Promise.resolve({ data: [] }),
    sellerIds.length ? glass.from('pessoas').select('id, nome').in('id', sellerIds) : Promise.resolve({ data: [] }),
    glass.from('vidracarias').select('nome, cnpj').eq('id', metadata.tenant_id).single(),
  ]);
  const users = Object.fromEntries((usersResult.data || []).map((row: any) => [row.user_id, text(row.nome_exibicao)]));
  const sellers = Object.fromEntries((sellersResult.data || []).map((row: any) => [row.id, text(row.nome)]));
  const prices = metadata.prices || {};

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
  const stream = new PassThrough(); const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(chunk)); doc.pipe(stream);
  doc.rect(0, 0, 105, 72).fill('#FFFFFF');
  doc.rect(105, 0, doc.page.width - 105, 72).fill('#0E6B5F');
  const logoPath = path.join(process.cwd(), 'public', 'logo.png');
  if (fs.existsSync(logoPath)) doc.image(logoPath, 25, 18, { fit: [55, 32] });
  doc.fillColor('#FFFFFF').fontSize(18).text('DEMONSTRATIVO DE EXCEDENTES', 125, 24);
  doc.fontSize(14).text(`Fatura nº ${formatReference(metadata.ref_month)}`, 650, 21, { width: 155, align: 'right' });
  doc.fontSize(9).text(`${text(tenantResult.data?.nome, 'Vidracaria')} - ${formatDocument(tenantResult.data?.cnpj)}        |        Referência ${formatReferenceMonth(metadata.ref_month)}        |        Período: ${formatPeriod(metadata.period_start, metadata.period_end)}`, 125, 49);
  const columns = [32, 145, 230, 345, 460, 575, 705];
  const labels = ['Nome', 'CPF/CNPJ', 'Usuário', 'Vendedor', 'Tipo', 'Fonte', 'Valor'];
  doc.fillColor('#1E293B').fontSize(9); labels.forEach((label, index) => doc.text(label, columns[index], 92));
  let y = 110;
  for (const row of rows || []) {
    if (y > 520) { doc.addPage(); y = 42; labels.forEach((label, index) => doc.text(label, columns[index], y)); y += 18; }
    const type = row.tipo_consulta === 'completo' ? 'Consultflex Completa' : 'Consultflex Básica';
    const values = [
      text(row.cliente_nome || row.pessoa_nome, 'Consumo ConsultFlex'),
      text(row.cliente_documento || row.pessoa_documento),
      users[row.usuario_id] || 'Não identificado',
      sellers[row._seller_id] || text(row.responsavel_comercial, 'Não identificado'),
      type,
      'Consultflex',
      money(Number(row.tipo_consulta === 'completo' ? prices.consultflexCompletePrice : prices.consultflexBasicPrice)),
    ];
    doc.fillColor('#334155').fontSize(8); values.forEach((value, index) => doc.text(value, columns[index], y, { width: index === 0 ? 108 : index === 1 ? 82 : index === 2 || index === 3 ? 110 : index === 4 ? 100 : index === 5 ? 135 : 70, ellipsis: true, lineBreak: false }));
    doc.moveTo(32, y + 13).lineTo(805, y + 13).strokeColor('#E2E8F0').stroke(); y += 20;
  }
  const extras = metadata.extras || {}; const values = metadata.values || {};
  const extraItems = [
    ['791 GLASS', `${Number(extras.users || 0)} usuários excedentes`, 'Usuários do sistema acima do limite contratado', Number(values.users || 0)],
    ['META', `${Number(extras.whatsappUsers || 0)} usuários excedentes`, 'Usuários vinculados ao WhatsApp acima do limite contratado', Number(values.whatsappUsers || 0)],
    ['META', `${Number(extras.messages || 0)} mensagens excedentes`, 'Mensagens WhatsApp acima do limite contratado', Number(values.messages || 0)],
  ].filter((item) => Number(item[3]) > 0);
  for (const [type, name, reason, value] of extraItems) {
    if (y > 520) { doc.addPage(); y = 42; labels.forEach((label, index) => doc.text(label, columns[index], y)); y += 18; }
    const rowValues = [name, '-', '-', '-', type, reason, money(Number(value))];
    doc.fillColor('#334155').fontSize(8); rowValues.forEach((item, index) => doc.text(String(item), columns[index], y, { width: index === 0 ? 108 : index === 1 ? 82 : index === 2 || index === 3 ? 110 : index === 4 ? 100 : index === 5 ? 135 : 70, ellipsis: true, lineBreak: false }));
    doc.moveTo(32, y + 13).lineTo(805, y + 13).strokeColor('#E2E8F0').stroke(); y += 20;
  }
  doc.fillColor('#0F172A').fontSize(11).text(`Itens faturados: ${(rows || []).length + extraItems.length}`, 32, y + 15);
  doc.text(`Total cobrado: ${money(Number(record.value || 0))}`, 650, y + 15, { width: 155, align: 'right' });
  doc.end(); await new Promise<void>((resolve) => stream.on('end', resolve));
  return new NextResponse(Buffer.concat(chunks), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="consultflex-${text(metadata.ref_month)}.pdf"` } });
}