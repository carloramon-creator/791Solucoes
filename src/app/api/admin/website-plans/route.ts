import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { validateWebsitePlan } from '@/lib/website-plans';

const REQUIRED_RESOURCES = ['menu.planos', 'submenu.planos.websites'];
const PLAN_COLUMNS = 'id, name, description, scope, category, project_type, billing_cycle, price_cents, recurring_prices, website_features, active, fiscal_config, created_at, updated_at';

async function authorize(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const email = auth.user.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Usuário sem e-mail para validar permissões.' }, { status: 403 });

  const { data: assignments, error: assignmentsError } = await supabaseServer
    .from('holding_user_permission_profiles').select('profile_id').eq('user_email', email);
  if (assignmentsError) throw assignmentsError;
  const profileIds = (assignments || []).map((row) => row.profile_id);
  // Mantém o bootstrap da Holding, mas falhas na consulta nunca liberam acesso.
  if (profileIds.length === 0) return null;

  const [profiles, member, resources, permissions] = await Promise.all([
    supabaseServer.from('holding_permission_profiles').select('name').in('id', profileIds),
    supabaseServer.from('equipe_791').select('cargo').eq('email', email).maybeSingle(),
    supabaseServer.from('holding_permission_resources').select('code').in('code', REQUIRED_RESOURCES).eq('active', true),
    supabaseServer.from('holding_profile_resource_permissions').select('resource_code')
      .in('profile_id', profileIds).in('resource_code', REQUIRED_RESOURCES).eq('enabled', true),
  ]);
  for (const result of [profiles, member, resources, permissions]) {
    if (result.error) throw result.error;
  }
  const isOwner = (value: string | null) => /(dono|owner|super\s*admin|admin\s*master|administrador)/i.test(value || '');
  const unrestricted = profiles.data?.some((profile) => isOwner(profile.name)) || isOwner(member.data?.cargo);
  const enabled = new Set(permissions.data?.map((row) => row.resource_code));
  if (resources.data?.length !== REQUIRED_RESOURCES.length
    || (!unrestricted && !REQUIRED_RESOURCES.every((code) => enabled.has(code)))) {
    return NextResponse.json({ error: 'Sem permissão para gerenciar planos de Websites.' }, { status: 403 });
  }
  return null;
}

function failure(error: unknown) {
  console.error('[WEBSITE PLANS] Falha no catálogo:', error);
  return NextResponse.json({
    error: 'Não foi possível acessar o catálogo de Websites. Verifique a configuração do banco e tente novamente.',
  }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    const { data, error } = await supabaseServer.from('holding_website_plans')
      .select(PLAN_COLUMNS).order('created_at', { ascending: false }).order('id');
    if (error) throw error;
    return NextResponse.json({ plans: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

async function save(req: Request, updating: boolean) {
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Envie um JSON válido.' }, { status: 400 });
    }
    const validated = validateWebsitePlan(body);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    let id: string | undefined;
    if (updating) {
      const candidate = body && typeof body === 'object' && 'id' in body ? body.id : undefined;
      if (typeof candidate !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
        return NextResponse.json({ error: 'Identificador do produto inválido.' }, { status: 400 });
      }
      id = candidate;
    }
    const query = supabaseServer.from('holding_website_plans');
    const mutation = updating ? query.update(validated.data).eq('id', id!) : query.insert(validated.data);
    const { data, error } = await mutation.select(PLAN_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    return NextResponse.json({ plan: data }, { status: updating ? 200 : 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  return save(req, false);
}

export async function PUT(req: Request) {
  return save(req, true);
}
