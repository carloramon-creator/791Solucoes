import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { isUuid } from '@/lib/holding-customers';
import { emitWebsiteInvoice } from '@/lib/website-invoices';

export async function POST(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.notas_fiscais']);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || !('id' in body) || !isUuid(body.id)
      || !('competence' in body) || typeof body.competence !== 'string'
      || !('confirmed' in body) || typeof body.confirmed !== 'boolean') {
      return NextResponse.json({ error: 'Informe contrato, competência e confirmação explícita.' }, { status: 400 });
    }
    return NextResponse.json(await emitWebsiteInvoice(body.id, body.competence, body.confirmed));
  } catch (error) {
    console.error('[WEBSITE NFS-E] Emissão interrompida. Nenhum reenvio automático.');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha fiscal. Confira o portal nacional antes de repetir.' }, { status: 409 });
  }
}
