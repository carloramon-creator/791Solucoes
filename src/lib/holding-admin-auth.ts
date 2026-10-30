import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';

export type HoldingAdminAuthSuccess = {
  ok: true;
  user: {
    id: string;
    email: string | null;
    role: string | null;
  };
};

export type HoldingAdminAuthFailure = {
  ok: false;
  status: number;
  error: string;
};

export type HoldingAdminAuthResult = HoldingAdminAuthSuccess | HoldingAdminAuthFailure;

export async function authenticateHoldingUser(req: Request): Promise<HoldingAdminAuthResult> {
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

  return {
    ok: true,
    user: {
      id: userData.user.id,
      email: userData.user.email || null,
      role: typeof userData.user.app_metadata?.role === 'string'
        ? userData.user.app_metadata.role
        : typeof userData.user.user_metadata?.role === 'string'
          ? userData.user.user_metadata.role
          : null,
    },
  };
}

export async function authenticateHoldingAdmin(
  req: Request,
  deniedMessage = 'Acesso negado para patrocinador.'
): Promise<HoldingAdminAuthResult> {
  const authenticated = await authenticateHoldingUser(req);
  if (!authenticated.ok) return authenticated;

  const { user } = authenticated;
  if (user.role === 'sponsor') {
    return { ok: false, status: 403, error: deniedMessage };
  }

  const userEmail = user.email;
  if (userEmail) {
    const { data: sponsor, error: sponsorError } = await supabaseServer
      .from('patrocinadores')
      .select('id')
      .ilike('email', userEmail.trim())
      .maybeSingle();

    if (sponsorError) {
      return { ok: false, status: 500, error: 'Nao foi possivel validar o acesso administrativo.' };
    }
    if (sponsor?.id) {
      return { ok: false, status: 403, error: deniedMessage };
    }
  }

  return authenticated;
}
