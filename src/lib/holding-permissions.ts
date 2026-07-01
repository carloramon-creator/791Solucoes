import { supabaseServer } from '@/lib/supabase-server';

export type PermissionResource = {
  code: string;
  label: string;
  category: string;
  parent_code: string | null;
  sort_order: number;
  active: boolean;
};

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const value = String(email).trim().toLowerCase();
  return value || null;
}

export async function getUserProfileIds(userEmail: string | null | undefined): Promise<string[]> {
  const normalizedEmail = normalizeEmail(userEmail);
  if (!normalizedEmail) return [];

  const { data, error } = await supabaseServer
    .from('holding_user_permission_profiles')
    .select('profile_id')
    .eq('user_email', normalizedEmail);

  if (error || !data) return [];
  return data.map((row: any) => String(row.profile_id)).filter(Boolean);
}

export async function getUserPermissionCodes(userEmail: string | null | undefined): Promise<Set<string>> {
  const profileIds = await getUserProfileIds(userEmail);
  if (profileIds.length === 0) {
    return new Set();
  }

  const [{ data: profilePermissions }, { data: resources }] = await Promise.all([
    supabaseServer
      .from('holding_profile_resource_permissions')
      .select('resource_code, enabled')
      .in('profile_id', profileIds),
    supabaseServer
      .from('holding_permission_resources')
      .select('code, active')
      .eq('active', true),
  ]);

  const activeResources = new Set((resources || []).map((row: any) => String(row.code)));
  const allowed = new Set<string>();

  for (const row of profilePermissions || []) {
    const code = String(row.resource_code || '');
    if (!code) continue;
    if (!row.enabled) continue;
    if (!activeResources.has(code)) continue;
    allowed.add(code);
  }

  return allowed;
}

export async function userCanAccessResource(userEmail: string | null | undefined, resourceCode: string): Promise<boolean> {
  const allowed = await getUserPermissionCodes(userEmail);

  // Sem perfis atribuídos ainda: mantém acesso total para não bloquear bootstrap.
  if (allowed.size === 0) {
    return true;
  }

  return allowed.has(resourceCode);
}

export async function getUserSubjectIds(userEmail: string | null | undefined): Promise<string[] | null> {
  const profileIds = await getUserProfileIds(userEmail);

  // Sem perfil: não filtra assuntos por enquanto (modo compatível inicial).
  if (profileIds.length === 0) {
    return null;
  }

  const { data, error } = await supabaseServer
    .from('support_subject_permission_profiles')
    .select('subject_id')
    .in('profile_id', profileIds);

  if (error) return [];
  const ids = Array.from(new Set((data || []).map((row: any) => String(row.subject_id)).filter(Boolean)));
  return ids;
}

export async function getAllPermissionResources(): Promise<PermissionResource[]> {
  const { data } = await supabaseServer
    .from('holding_permission_resources')
    .select('code, label, category, parent_code, sort_order, active')
    .order('sort_order', { ascending: true });

  return (data || []) as PermissionResource[];
}
