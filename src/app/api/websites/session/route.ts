import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { hashSsoValue, inspectWebsitesSession, isSsoValue, newSsoValue, pkceChallenge, ssoHeaders } from '@/lib/holding-websites-sso';

function failure() {
  console.error('[WEBSITES SSO] Servico de sessao indisponivel.');
  return NextResponse.json({ error: 'Servico de acesso indisponivel.' }, { status: 503, headers: ssoHeaders });
}

export async function POST(req: Request) {
  let input: { code?: unknown; verifier?: unknown };
  try { input = await req.json(); }
  catch { return NextResponse.json({ error: 'Solicitacao invalida.' }, { status: 400, headers: ssoHeaders }); }
  if (!input || !isSsoValue(input.code) || !isSsoValue(input.verifier)) {
    return NextResponse.json({ error: 'Solicitacao invalida.' }, { status: 400, headers: ssoHeaders });
  }
  try {
    const token = newSsoValue();
    const { data, error } = await supabaseServer.rpc('exchange_holding_websites_code', {
      p_code_hash: hashSsoValue(input.code), p_challenge: pkceChallenge(input.verifier), p_token_hash: hashSsoValue(token),
    });
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: 'Acesso expirado ou ja utilizado.' }, { status: 401, headers: ssoHeaders });
    const session = await inspectWebsitesSession(token);
    if (!session) {
      const { error: revokeError } = await supabaseServer.from('holding_websites_sessions').delete().eq('token_hash', hashSsoValue(token));
      if (revokeError) throw revokeError;
      return NextResponse.json({ error: 'Acesso revogado na Holding.' }, { status: 403, headers: ssoHeaders });
    }
    return NextResponse.json({ token, ...session }, { headers: ssoHeaders });
  } catch { return failure(); }
}

function bearer(req: Request) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return isSsoValue(token) ? token : null;
}

export async function GET(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: 'Sessao ausente.' }, { status: 401, headers: ssoHeaders });
  try {
    const session = await inspectWebsitesSession(token);
    return session ? NextResponse.json(session, { headers: ssoHeaders })
      : NextResponse.json({ error: 'Sessao expirada ou acesso revogado.' }, { status: 401, headers: ssoHeaders });
  } catch { return failure(); }
}

export async function DELETE(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: 'Sessao ausente.' }, { status: 401, headers: ssoHeaders });
  try {
    const { error } = await supabaseServer.from('holding_websites_sessions').delete().eq('token_hash', hashSsoValue(token));
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: ssoHeaders });
  } catch { return failure(); }
}
