import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { loadTenantInvoices } from '@/lib/glass-tenant-billing';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const tenantId = new URL(req.url).searchParams.get('tenantId') || '';
  if (!tenantId) return NextResponse.json({ error: 'Vidracaria não informada.' }, { status: 400 });

  try {
    const { invoices } = await loadTenantInvoices(tenantId);
    return NextResponse.json({ invoices });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao carregar faturas.' }, { status: 500 });
  }
}
