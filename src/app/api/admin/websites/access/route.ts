import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';
import { supabaseServer } from '@/lib/supabase-server';
import { hashSsoValue, holdingAuthSessionId, isSsoValue, newSsoValue, ssoHeaders, websitesCallback } from '@/lib/holding-websites-sso';

export async function GET(req: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  try {
    const permissions = await getHoldingWebsitesPermissions(auth.user.email);
    if (!permissions.menu) {
      return NextResponse.json({ error: 'Sem permissao para acessar o menu 791 Websites.' }, { status: 403, headers });
    }
    return NextResponse.json({ url: 'https://websites.791solucoes.com.br/auth/holding/start' }, { headers });
  } catch (error) {
    console.error('[WEBSITES ACCESS] Falha ao verificar acesso.', error);
    return NextResponse.json({ error: 'Nao foi possivel verificar seu acesso. Tente novamente.' }, { status: 503, headers });
  }

}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: ssoHeaders });
  let input: { challenge?: unknown; state?: unknown };
  try { input = await req.json(); }
  catch { return NextResponse.json({ error: 'Envie uma solicitacao valida.' }, { status: 400, headers: ssoHeaders }); }
  if (!input || !isSsoValue(input.challenge) || !isSsoValue(input.state)) {
    return NextResponse.json({ error: 'Reinicie o acesso pela Holding.' }, { status: 400, headers: ssoHeaders });
  }
  try {
    const permissions = await getHoldingWebsitesPermissions(auth.user.email);
    if (!permissions.menu || !permissions.view) {
      return NextResponse.json({ error: 'Habilite as permissoes de menu e visualizacao da 791 Websites.' }, { status: 403, headers: ssoHeaders });
    }
    const sessionId = holdingAuthSessionId((req.headers.get('authorization') || '').slice(7));
    if (!sessionId) return NextResponse.json({ error: 'Sessao sem identificador. Entre novamente na Holding.' }, { status: 401, headers: ssoHeaders });
    const code = newSsoValue();
    const { error } = await supabaseServer.from('holding_websites_login_codes').insert({
      code_hash: hashSsoValue(code), challenge: input.challenge, user_id: auth.user.id, auth_session_id: sessionId,
    });
    if (error) throw error;
    const url = new URL(websitesCallback);
    url.searchParams.set('code', code);
    url.searchParams.set('state', input.state);
    return NextResponse.json({ url: url.toString() }, { headers: ssoHeaders });
  } catch (error) {
    console.error('[WEBSITES SSO] Falha ao iniciar sessao.', { code: error && typeof error === 'object' && 'code' in error ? error.code : 'unavailable' });
    return NextResponse.json({ error: 'Nao foi possivel iniciar o acesso. Tente novamente.' }, { status: 503, headers: ssoHeaders });
  }
}
