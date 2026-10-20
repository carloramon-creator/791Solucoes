import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateHoldingAdmin(request);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;

    const { data, error } = await supabaseServer
      .from('system_invoices')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Nota não encontrada' }, { status: 404 });
    }

    return NextResponse.json({ success: true, invoice: data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
