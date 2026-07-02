import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGlassClient } from '@/lib/glass-client';

type AuthSuccess = {
  ok: true;
  user: {
    id: string;
    email: string | null;
  };
};

type AuthFailure = {
  ok: false;
  status: number;
  error: string;
};

type AuthResult = AuthSuccess | AuthFailure;

async function authenticateHoldingAdmin(req: Request): Promise<AuthResult> {
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
      return { ok: false, status: 403, error: 'Patrocinadores nao podem listar usuarios do Glass.' };
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

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const glass = await getGlassClient();

    const [
      { data: profiles, error: profilesError },
      { data: tenants, error: tenantsError },
      { data: people, error: peopleError },
      authUsersResult,
    ] = await Promise.all([
      glass
        .from('user_profiles')
        .select('user_id, vidracaria_id, pessoa_id, perfil_id, nome_exibicao, ativo, is_master, created_at')
        .order('created_at', { ascending: false }),
      glass
        .from('vidracarias')
        .select('id, nome, nome_fantasia, slug, ativa')
        .order('nome', { ascending: true }),
      glass
        .from('pessoas')
        .select('id, nome, email, user_id')
        .not('user_id', 'is', null),
      glass.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const authUsersError = authUsersResult.error;
    if (profilesError || tenantsError || peopleError || authUsersError) {
      return NextResponse.json({
        error: profilesError?.message || tenantsError?.message || peopleError?.message || authUsersError?.message || 'Falha ao listar usuarios do Glass.',
      }, { status: 500 });
    }

    const tenantById = new Map((tenants || []).map((tenant: any) => [String(tenant.id), tenant]));
    const personById = new Map((people || []).map((person: any) => [String(person.id), person]));
    const personByUserId = new Map((people || []).map((person: any) => [String(person.user_id), person]));
    const authUserById = new Map((authUsersResult.data?.users || []).map((user: any) => [String(user.id), user]));

    const rows = (profiles || []).map((profile: any) => {
      const userId = String(profile.user_id || '');
      const tenant = tenantById.get(String(profile.vidracaria_id || ''));
      const authUser = authUserById.get(userId);
      const person = personById.get(String(profile.pessoa_id || '')) || personByUserId.get(userId);

      return {
        userId,
        email: authUser?.email || person?.email || null,
        nomeExibicao: profile.nome_exibicao || person?.nome || authUser?.email || userId,
        pessoaNome: person?.nome || null,
        perfilId: profile.perfil_id || null,
        ativo: Boolean(profile.ativo),
        isMaster: Boolean(profile.is_master),
        createdAt: profile.created_at || null,
        lastSignInAt: authUser?.last_sign_in_at || null,
        vidracariaId: profile.vidracaria_id || null,
        vidracariaNome: tenant?.nome || 'Sem vidracaria',
        vidracariaNomeFantasia: tenant?.nome_fantasia || null,
        vidracariaSlug: tenant?.slug || null,
        vidracariaAtiva: tenant?.ativa ?? null,
      };
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      total: rows.length,
      users: rows,
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return NextResponse.json({ error: candidate?.message || 'Falha ao listar usuarios do Glass.' }, { status: 500 });
  }
}