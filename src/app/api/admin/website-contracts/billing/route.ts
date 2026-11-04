import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { isUuid } from '@/lib/holding-customers';
import { billWebsiteContract } from '@/lib/website-billing';

export async function POST(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.clientes']);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || !('id' in body) || !isUuid(body.id)
      || !('action' in body) || !['generate', 'sync'].includes(String(body.action))) {
      return NextResponse.json({ error: 'Informe contratação e ação válidas.' }, { status: 400 });
    }
    return NextResponse.json(await billWebsiteContract(body.id, body.action === 'generate'));
  } catch (error) {
    console.error('[WEBSITE BILLING] A operação foi interrompida; nenhuma repetição automática será feita.');
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Falha ao processar cobranças. Confira o painel Asaas.',
    }, { status: 409 });
  }
}
