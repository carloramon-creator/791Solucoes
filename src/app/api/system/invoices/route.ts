import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  try {
    const { data, error } = await supabaseServer
      .from('system_invoices')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, invoices: data || [] });
  } catch (err: any) {
    console.error('[API INVOICES ERROR]:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
