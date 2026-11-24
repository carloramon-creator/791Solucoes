import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGlassClient } from '@/lib/glass-client';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';

const GLASS_USER_LIST_PERMISSIONS = ['menu.assinaturas', 'menu.suporte'];

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

type GlassUserProfile = {
  user_id: string | null;
  vidracaria_id: string | null;
  pessoa_id: string | null;
  perfil_id: string | null;
  nome_exibicao: string | null;
  ativo: boolean | null;
  is_master: boolean | null;
  created_at: string | null;
};

type GlassTenant = {
  id: string;
  nome: string | null;
  nome_fantasia: string | null;
  slug: string | null;
  ativa: boolean | null;
};

type GlassPerson = {
  id: string;
  nome: string | null;
  email: string | null;
  user_id: string | null;
};

type GlassAuthUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

async function fetchAllRows<T>(
  loadPage: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  resource: string
): Promise<T[]> {
  const rows: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_SIZE;
    const { data, error } = await loadPage(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`Falha ao listar ${resource}: ${error.message}`);

    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }

  throw new Error(`Não foi possível concluir a listagem paginada de ${resource}.`);
}

async function fetchAllAuthUsers(glass: Awaited<ReturnType<typeof getGlassClient>>): Promise<GlassAuthUser[]> {
  const users: GlassAuthUser[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await glass.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Falha ao listar usuários do Auth: ${error.message}`);

    const pageUsers = data.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < PAGE_SIZE) return users;
  }

  throw new Error('Não foi possível concluir a listagem paginada de usuários Auth.');
}

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
    if (!await hasExplicitHoldingPermission(auth.user.email, GLASS_USER_LIST_PERMISSIONS, 'any')) {
      return NextResponse.json({ error: 'Sem permissão para consultar usuários de todas as vidraçarias.' }, { status: 403 });
    }

    const glass = await getGlassClient();

    const [profiles, tenants, people, authUsers] = await Promise.all([
      fetchAllRows<GlassUserProfile>(
        (start, end) => glass
          .from('user_profiles')
          .select('user_id, vidracaria_id, pessoa_id, perfil_id, nome_exibicao, ativo, is_master, created_at')
          .order('created_at', { ascending: false })
          .order('user_id', { ascending: true })
          .range(start, end),
        'perfis de usuários do Glass'
      ),
      fetchAllRows<GlassTenant>(
        (start, end) => glass
          .from('vidracarias')
          .select('id, nome, nome_fantasia, slug, ativa')
          .order('nome', { ascending: true })
          .order('id', { ascending: true })
          .range(start, end),
        'vidraçarias'
      ),
      fetchAllRows<GlassPerson>(
        (start, end) => glass
          .from('pessoas')
          .select('id, nome, email, user_id')
          .not('user_id', 'is', null)
          .order('id', { ascending: true })
          .range(start, end),
        'pessoas vinculadas'
      ),
      fetchAllAuthUsers(glass),
    ]);

    const tenantById = new Map<string, GlassTenant>(
      tenants.map((tenant) => [String(tenant.id), tenant])
    );
    const personById = new Map<string, GlassPerson>(
      people.map((person) => [String(person.id), person])
    );
    const personByUserId = new Map<string, GlassPerson>(
      people.map((person) => [String(person.user_id), person])
    );
    const authUserById = new Map<string, GlassAuthUser>(
      authUsers.map((user) => [String(user.id), user])
    );
    const technicalUserIds = new Set(
      authUsers
        .filter((user) => user.user_metadata?.holding_chat === true || user.user_metadata?.holding_support === true)
        .map((user) => user.id)
    );

    const rows = profiles.filter((profile) => !technicalUserIds.has(String(profile.user_id || ''))).map((profile) => {
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
    const linkedUserIds = new Set(profiles.map((profile) => String(profile.user_id || '')));
    const unlinkedRows = authUsers
      .filter((user) => {
        const metadata = user.user_metadata || {};
        return (
          !linkedUserIds.has(user.id)
          && metadata.holding_chat !== true
          && metadata.holding_support !== true
        );
      })
      .map((user) => {
        const metadataName = user.user_metadata?.nome || user.user_metadata?.full_name;
        const nomeExibicao = typeof metadataName === 'string' ? metadataName : user.email || user.id;
        return {
          userId: user.id,
          email: user.email || null,
          nomeExibicao,
          pessoaNome: null,
          perfilId: null,
          ativo: false,
          isMaster: false,
          createdAt: user.created_at || null,
          lastSignInAt: user.last_sign_in_at || null,
          vidracariaId: null,
          vidracariaNome: 'Sem vidraçaria',
          vidracariaNomeFantasia: null,
          vidracariaSlug: null,
          vidracariaAtiva: null,
        };
      });
    const allRows = [...rows, ...unlinkedRows];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      total: allRows.length,
      users: allRows,
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return NextResponse.json({ error: candidate?.message || 'Falha ao listar usuarios do Glass.' }, { status: 500 });
  }
}