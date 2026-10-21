import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { CancelamentoError, cancelarNoEmissorNacional, lerPedido } from '@/services/nfse/cancelar-nacional';

// Cancelamento de NFS-e emitida pela holding a um tenant. Decisão manual do administrador
// (pedido de estorno/cancelamento de assinatura); não aciona nenhum estorno no Asaas.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  try {
    const pedido = await lerPedido(req);
    const { data: inv, error } = await supabaseServer.from('system_invoices')
      .select('id, invoice_number, status, metadata').eq('id', id).maybeSingle();
    if (error) throw new CancelamentoError(error.message, 500);
    if (!inv) throw new CancelamentoError('Nota não encontrada.', 404);
    if (inv.status !== 'authorized') throw new CancelamentoError('Somente notas autorizadas podem ser canceladas.', 409);
    const metadata = (inv.metadata || {}) as Record<string, unknown>;
    const usuario = auth.user.email || auth.user.id;

    let registro;
    try {
      registro = await cancelarNoEmissorNacional({
        xmlOficial: metadata.nfse_oficial_xml || metadata.xml, ...pedido, usuario,
      });
    } catch (err) {
      if (err instanceof CancelamentoError && err.status === 502) {
        const { error: erroFalha } = await supabaseServer.from('system_invoices').update({
          metadata: { ...metadata, cancelamento_ultima_falha: { erro: err.message, em: new Date().toISOString(), por: usuario } },
        }).eq('id', id);
        if (erroFalha) console.error('[Cancelamento NFS-e] Falha ao registrar erro:', erroFalha.message);
      }
      throw err;
    }

    const semFalha = { ...metadata };
    delete semFalha.cancelamento_ultima_falha;
    const { error: erroSalvar } = await supabaseServer.from('system_invoices')
      .update({ status: 'cancelled', metadata: { ...semFalha, cancelamento: registro } })
      .eq('id', id).eq('status', 'authorized');
    if (erroSalvar) {
      throw new CancelamentoError(`Cancelamento registrado no Emissor Nacional, mas não foi salvo aqui: ${erroSalvar.message}. Não repita; atualize a nota manualmente.`, 500);
    }
    const resumo: Partial<typeof registro> = { ...registro };
    delete resumo.evento_xml;
    return NextResponse.json({ success: true, cancelamento: resumo }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof CancelamentoError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    console.error('[Cancelamento NFS-e]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Falha inesperada no cancelamento.' }, { status: 500 });
  }
}
