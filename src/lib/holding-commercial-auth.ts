import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { supabaseServer } from '@/lib/supabase-server';

export async function authorizeHoldingCommercial(req: Request, required: string[]) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const email = auth.user.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Usuário sem e-mail para validar permissões.' }, { status: 403 });
  const { data: assignments, error } = await supabaseServer.from('holding_user_permission_profiles')
    .select('profile_id').eq('user_email', email);
  if (error) throw error;
  const ids = (assignments || []).map((row) => row.profile_id);
  if (!ids.length) return null;
  const results = await Promise.all([
    supabaseServer.from('holding_permission_profiles').select('name').in('id', ids),
    supabaseServer.from('equipe_791').select('cargo').eq('email', email).maybeSingle(),
    supabaseServer.from('holding_permission_resources').select('code').in('code', required).eq('active', true),
    supabaseServer.from('holding_profile_resource_permissions').select('resource_code')
      .in('profile_id', ids).in('resource_code', required).eq('enabled', true),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [profiles, member, resources, permissions] = results;
  const owner = (label: unknown) => typeof label === 'string'
    && /(dono|owner|super\s*admin|admin\s*master|administrador)/i.test(label);
  const unrestricted = profiles.data?.some((row) => owner(row.name)) || owner(member.data?.cargo);
  const allowed = new Set(permissions.data?.map((row) => row.resource_code));
  if (resources.data?.length !== required.length || (!unrestricted && !required.every((code) => allowed.has(code)))) {
    return NextResponse.json({ error: 'Sem permissão para esta operação comercial da Holding.' }, { status: 403 });
  }
  return null;
}
