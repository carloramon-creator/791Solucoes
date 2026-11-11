import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { emitirNotaAssinatura } from '@/services/nfse/emissao-assinatura';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/system/invoices/emitir-automatica
 * Emissão automática da NFS-e da assinatura, chamada servidor-a-servidor pelo webhook
 * de pagamentos do 791glass. Autenticada pelo token compartilhado da config finance_api
 * (asaasWebhookToken) — o mesmo segredo que autentica o webhook do Asaas.
 */
export async function POST(req: Request) {
  try {
    const { data: financeApi, error: configError } = await supabaseServer
      .from('system_settings').select('value').eq('id', 'finance_api').single();
    if (configError) throw configError;
    const tokenEsperado = String((financeApi?.value as { asaasWebhookToken?: unknown } | null)?.asaasWebhookToken || '');
    const tokenRecebido = req.headers.get('x-automacao-token') || '';
    if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const vidracariaId = String(body?.vidracariaId || '');
    const valor = Number(body?.valor);
    const asaasPaymentId = String(body?.asaasPaymentId || '');
    const descricao = typeof body?.descricao === 'string' ? body.descricao.slice(0, 300) : undefined;
    if (!/^[0-9a-f-]{36}$/i.test(vidracariaId) || !Number.isFinite(valor) || valor <= 0 || !asaasPaymentId) {
      return NextResponse.json({ success: false, error: 'Dados obrigatórios: vidracariaId, valor e asaasPaymentId.' }, { status: 400 });
    }

    const resultado = await emitirNotaAssinatura({ supabase: supabaseServer, vidracariaId, valor, descricao, asaasPaymentId });
    return NextResponse.json(resultado, { status: resultado.success ? 200 : 502 });
  } catch (err) {
    console.error('[NFS-e automática] Falha na emissão:', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Falha na emissão automática.' }, { status: 502 });
  }
}
