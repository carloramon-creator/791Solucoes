import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { isUuid } from '@/lib/holding-customers';
import { billWebsiteSubscription, changeWebsiteSubscription } from '@/lib/website-subscriptions';
import { approveWebsiteSubscription } from '@/lib/website-subscription-approval';

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
      || !('action' in body) || typeof body.action !== 'string' || !['generate', 'sync', 'pause', 'resume', 'cancel'].includes(body.action)) {
      return NextResponse.json({ error: 'Informe assinatura e ação generate/sync/pause/resume/cancel.' }, { status: 400 });
    }
    if (body.action === 'pause' || body.action === 'resume' || body.action === 'cancel') {
      if (!('confirmed' in body) || body.confirmed !== true) return NextResponse.json({ error: 'Confirme explicitamente a alteração da assinatura.' }, { status: 400 });
      const date = 'next_due_date' in body && typeof body.next_due_date === 'string' ? body.next_due_date : undefined;
      return NextResponse.json(await changeWebsiteSubscription(body.id, body.action, date));
    }
    if (body.action === 'generate') {
      if (!('confirmed' in body) || body.confirmed !== true) {
        return NextResponse.json({ error: 'Confirme a aprovação do cliente e a ativação das cobranças recorrentes.' }, { status: 400 });
      }
      await approveWebsiteSubscription(req, body.id);
    }
    return NextResponse.json(await billWebsiteSubscription(body.id, body.action === 'generate'));
  } catch (failure) {
    console.error('[WEBSITE SUBSCRIPTIONS] Operação interrompida. Nenhum POST será repetido automaticamente.');
    return NextResponse.json({ error: failure instanceof Error ? failure.message : 'Falha ao processar assinatura. Confira o Asaas.' }, { status: 409 });
  }
}
