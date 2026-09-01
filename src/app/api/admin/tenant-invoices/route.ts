import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

const metadataOf = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const tenantId = new URL(req.url).searchParams.get('tenantId') || '';
  if (!tenantId) return NextResponse.json({ error: 'Vidracaria não informada.' }, { status: 400 });

  const [invoicesResult, recordsResult] = await Promise.all([
    supabaseServer.from('system_invoices').select('*').eq('metadata->>vidracaria_id', tenantId).order('created_at', { ascending: false }),
    supabaseServer.from('system_finance_records').select('id, value, description, status, category, payment_link, metadata, created_at').eq('metadata->>tenant_id', tenantId).eq('business_unit', 'glass').eq('type', 'revenue').order('created_at', { ascending: false }),
  ]);

  if (invoicesResult.error || recordsResult.error) {
    return NextResponse.json({ error: invoicesResult.error?.message || recordsResult.error?.message }, { status: 500 });
  }

  const invoicePaymentIds = new Set((invoicesResult.data || []).map((row: any) => String(metadataOf(row.metadata).asaas_payment_id || '')).filter(Boolean));
  const invoiceItems = (invoicesResult.data || []).map((row: any) => {
    const metadata = metadataOf((row as any).metadata);
    return {
      id: row.id,
      createdAt: row.created_at,
      reference: row.invoice_number,
      type: metadata.kind === 'overage' ? 'Excedente' : 'Assinatura',
      description: metadata.kind === 'overage' ? `${metadata?.consultflex?.basic || 0} Consultas básicas; ${metadata?.consultflex?.complete || 0} Consultas completas` : 'Assinatura 791glass',
      status: row.status,
      value: Number(row.value || 0),
      paymentUrl: null,
      fiscalUrl: `/notas-fiscais/${row.id}/pdf`,
      reportUrl: metadata.finance_record_id ? `/api/admin/tenant-invoices/${metadata.finance_record_id}/consultflex-report` : null,
    };
  });
  const recordItems = (recordsResult.data || [])
    .filter((row: any) => !invoicePaymentIds.has(String(metadataOf(row.metadata).asaas_payment_id || '')))
    .map((row: any) => {
      const metadata = metadataOf(row.metadata);
      const isOverage = metadata.kind === 'overage';
      return {
        id: `finance-${row.id}`,
        createdAt: row.created_at,
        reference: isOverage ? `EXC-${metadata.ref_month || String(row.id).slice(0, 8)}` : `COB-${String(row.id).slice(0, 8)}`,
        type: isOverage ? 'Excedente' : 'Assinatura',
        description: row.description || 'Cobrança 791glass',
        status: row.status,
        value: Number(row.value || 0),
        paymentUrl: row.payment_link || metadata.invoice_url || null,
        fiscalUrl: null,
        reportUrl: isOverage ? `/api/admin/tenant-invoices/${row.id}/consultflex-report` : null,
      };
    });

  return NextResponse.json({ invoices: [...invoiceItems, ...recordItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) });
}