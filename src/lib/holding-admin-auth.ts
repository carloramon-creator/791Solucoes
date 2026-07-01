import { createClient } from '@supabase/supabase-js';

export type HoldingAdminAuthSuccess = {
  ok: true;
  user: {
    id: string;
    email: string | null;
  };
};

export type HoldingAdminAuthFailure = {
  ok: false;
  status: number;
  error: string;
};

export type HoldingAdminAuthResult = HoldingAdminAuthSuccess | HoldingAdminAuthFailure;

export async function authenticateHoldingAdmin(
  req: Request,
  deniedMessage = 'Acesso negado para patrocinador.'
): Promise<HoldingAdminAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: 'Configuracao do Supabase da Holding ausente.' };
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, status: 401, error: 'Token ausente.' };
  }

  const requester = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await requester.auth.getUser(token);
  if (userErr || !userData.user) {
    return { ok: false, status: 401, error: 'Sessao invalida.' };
  }

  const userEmail = userData.user.email || null;
  if (userEmail) {
    const { data: sponsor } = await requester
      .from('patrocinadores')
      .select('id')
      .eq('email', userEmail)
      .maybeSingle();

    if (sponsor?.id) {
      return { ok: false, status: 403, error: deniedMessage };
    }
  }

  return {
    ok: true,
    user: {
      id: userData.user.id,
      email: userEmail,
    },
  };
}
