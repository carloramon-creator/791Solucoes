import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';

export async function GET(req: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  try {
    const permissions = await getHoldingWebsitesPermissions(auth.user.email);
    if (!permissions.menu) {
      return NextResponse.json({ error: 'Sem permissao para acessar o menu 791 Websites.' }, { status: 403, headers });
    }
    return NextResponse.json({ url: 'https://websites.791solucoes.com.br/painel' }, { headers });
  } catch (error) {
    console.error('[WEBSITES ACCESS] Falha ao verificar acesso.', error);
    return NextResponse.json({ error: 'Nao foi possivel verificar seu acesso. Tente novamente.' }, { status: 503, headers });
  }
}
