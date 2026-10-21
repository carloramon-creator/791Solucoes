import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { lerDocumentoOficial } from '@/services/nfse/documento-oficial';

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

    if (data.metadata?.nfse_oficial_xml && !data.metadata.documento_oficial) {
      try {
        data.metadata.documento_oficial = lerDocumentoOficial(data.metadata.nfse_oficial_xml);
      } catch (err) {
        console.error('[NFS-e] XML armazenado incompleto:', err instanceof Error ? err.message : err);
        return NextResponse.json({ success: true, invoice: data, aviso: 'XML oficial incompleto. Consulte o original no portal fiscal.' }, { headers: { 'Cache-Control': 'private, no-store' } });
      }
    }
    return NextResponse.json({ success: true, invoice: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
