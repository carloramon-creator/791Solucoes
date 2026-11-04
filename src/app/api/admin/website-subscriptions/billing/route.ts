import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { isUuid } from '@/lib/holding-customers';
import { billWebsiteSubscription } from '@/lib/website-subscriptions';

export const maxDuration = 300;
export async function POST(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, [
      'menu.assinaturas', 'submenu.assinaturas.websites', 'menu.clientes', 'menu.notas_fiscais',
    ]);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !('id' in body) || !isUuid(body.id)
      || !('action' in body) || !['generate', 'sync'].includes(String(body.action))) {
      return NextResponse.json({ error: 'Informe assinatura e ação generate/sync.' }, { status: 400 });
    }
    return NextResponse.json(await billWebsiteSubscription(body.id, body.action === 'generate'));
  } catch (failure) {
    console.error('[WEBSITE SUBSCRIPTIONS] Operação interrompida. Nenhum POST será repetido automaticamente.');
    return NextResponse.json({ error: failure instanceof Error ? failure.message : 'Falha ao processar assinatura. Confira o Asaas.' }, { status: 409 });
  }
}
