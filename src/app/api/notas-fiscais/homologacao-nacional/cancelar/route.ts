import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { CancelamentoError, cancelarNoEmissorNacional, lerPedido } from '@/services/nfse/cancelar-nacional';

// Cancela uma NFS-e de teste da produção restrita (sem validade fiscal), para homologar o fluxo.
export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^DPS\d{42}$/.test(id)) return NextResponse.json({ error: 'Identificador da DPS inválido.' }, { status: 400 });
  try {
    const pedido = await lerPedido(req);
    const registroId = `nfse_homologacao_${id}`;
    const { data, error } = await supabaseServer.from('system_settings').select('value').eq('id', registroId).maybeSingle();
    if (error) throw new CancelamentoError(error.message, 500);
    if (!data) throw new CancelamentoError('Teste não encontrado.', 404);
    const value = (data.value || {}) as Record<string, unknown> & { result?: { xml?: string } };
    if (value.status !== 'authorized') throw new CancelamentoError('Somente testes autorizados podem ser cancelados.', 409);

    const registro = await cancelarNoEmissorNacional({
      xmlOficial: value.result?.xml, ...pedido, usuario: auth.user.email || auth.user.id, ambienteEsperado: 2,
    });
    const novo = { ...value, status: 'cancelled', cancelamento: registro };
    const { error: erroSalvar } = await supabaseServer.from('system_settings')
      .update({ value: novo, updated_at: new Date().toISOString() }).eq('id', registroId);
    if (erroSalvar) throw new CancelamentoError(`Cancelamento registrado, mas não foi salvo aqui: ${erroSalvar.message}.`, 500);
    return NextResponse.json(novo, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof CancelamentoError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    console.error('[Cancelamento homologação]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Falha inesperada no cancelamento.' }, { status: 500 });
  }
}
