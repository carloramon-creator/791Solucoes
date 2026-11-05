import { createHash, randomBytes } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';

export const websitesCallback = 'https://websites.791solucoes.com.br/auth/holding/callback';
export const ssoHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export const isSsoValue = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const hashSsoValue = (value: string) => createHash('sha256').update(value).digest('hex');
export const newSsoValue = () => randomBytes(32).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function holdingAuthSessionId(verifiedToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(verifiedToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.session_id) ? payload.session_id : null;
  } catch {
    return null;
  }
}

export async function inspectWebsitesSession(token: string) {
  const { data, error } = await supabaseServer.rpc('inspect_holding_websites_session', { p_token_hash: hashSsoValue(token) });
  if (error) throw error;
  const session = data?.[0];
  if (!session) return null;
  const permissions = await getHoldingWebsitesPermissions(session.email);
  if (!permissions.menu || !permissions.view) return null;
  return { user: { id: session.user_id, email: session.email }, permissions, expiresAt: session.expires_at };
}
