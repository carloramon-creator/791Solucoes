import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import ipmProvider from '@/lib/nfse/providers/ipm';
import { lerDocumentoOficial } from '@/services/nfse/documento-oficial';
import { lerRetornoIpm } from '@/services/nfse/danfse-snapshot';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const { data: invoice, error } = await supabaseServer.from('system_invoices')
      .select('id, metadata, access_link').eq('id', id).single();
    if (error || !invoice) return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 });
    const metadata = invoice.metadata || {};
    if (metadata.documento_oficial?.formato === 'nacional') {
      return NextResponse.json({ error: 'Esta nota é nacional. Consulte o documento pelo portal nacional, não pela IPM.' }, { status: 422 });
    }
    const codigo = metadata.danfse?.retorno?.codigo_verificacao
      || lerRetornoIpm(metadata.xml, invoice.access_link).codigo_verificacao;
    if (!/^\d{30,}$/.test(codigo || '')) {
      return NextResponse.json({ error: 'Código de consulta IPM ausente. Consulte o documento pelo portal oficial.' }, { status: 422 });
    }
    const { data: settings, error: erroConfig } = await supabaseServer.from('system_settings')
      .select('value').eq('id', 'nfse_config').single();
    if (erroConfig) throw erroConfig;
    const config = settings.value;
    if (!config?.ipm_username || !config.ipm_password || !config.municipal_code) {
      return NextResponse.json({ error: 'Credenciais de consulta IPM não configuradas.' }, { status: 422 });
    }
    const resultado = await ipmProvider.consultar(codigo, {
      username: config.ipm_username, password: config.ipm_password, municipal_code: config.municipal_code,
    });
    if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 502 });
    const documento = lerDocumentoOficial(resultado.xml);
    const cancelada = /cancel/i.test(resultado.situacao);
    const { error: erroSalvar } = await supabaseServer.from('system_invoices').update({
      ...(cancelada ? { status: 'cancelled' } : {}),
      metadata: { ...metadata, nfse_oficial_xml: resultado.xml, documento_oficial: documento },
    }).eq('id', id);
    if (erroSalvar) throw erroSalvar;
    return NextResponse.json({ success: true, documento });
  } catch (err) {
    console.error('[NFS-e oficial] Falha ao consultar documento:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao consultar documento oficial.' }, { status: 502 });
  }
}
