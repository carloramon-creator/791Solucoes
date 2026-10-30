import { supabaseServer } from '@/lib/supabase-server';
import type { User } from '@supabase/supabase-js';
import { authenticateHoldingAdmin, authenticateHoldingUser, type HoldingAdminAuthResult } from '@/lib/holding-admin-auth';

const SPONSOR_PERMISSION = 'menu.patrocinadores';

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

export async function findHoldingAuthUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseServer.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => normalizeEmail(candidate.email) === normalizedEmail);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  throw new Error('Limite de busca de usuários excedido.');
}

function isOwnerLabel(value: unknown) {
  return /(dono|owner|super\s*admin|admin\s*master|administrador)/i.test(String(value || '').trim());
}

async function canManageSponsors(email: string | null) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return false;

  const { data: assignments, error: assignmentsError } = await supabaseServer
    .from('holding_user_permission_profiles')
    .select('profile_id')
    .eq('user_email', normalizedEmail);
  if (assignmentsError) throw assignmentsError;
  const profileIds = (assignments || []).map((row) => String(row.profile_id));
  if (profileIds.length === 0) {
    const { data: member, error } = await supabaseServer
      .from('equipe_791')
      .select('cargo')
      .ilike('email', normalizedEmail)
      .maybeSingle();
    if (error) throw error;
    return isOwnerLabel(member?.cargo);
  }

  const [{ data: profiles, error: profilesError }, { data: resource, error: resourceError }, { data: permission, error: permissionError }] = await Promise.all([
    supabaseServer
      .from('holding_permission_profiles')
      .select('name')
      .in('id', profileIds),
    supabaseServer
      .from('holding_permission_resources')
      .select('code')
      .eq('code', SPONSOR_PERMISSION)
      .eq('active', true)
      .maybeSingle(),
    supabaseServer
      .from('holding_profile_resource_permissions')
      .select('profile_id')
      .in('profile_id', profileIds)
      .eq('resource_code', SPONSOR_PERMISSION)
      .eq('enabled', true),
  ]);

  if (profilesError) throw profilesError;
  if (resourceError) throw resourceError;
  if (permissionError) throw permissionError;
  if ((profiles || []).some((profile) => isOwnerLabel(profile.name))) return true;
  return Boolean(resource && permission?.length);
}

export async function authorizeSponsorManagement(req: Request): Promise<HoldingAdminAuthResult> {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem gerenciar patrocinadores.');
  if (!auth.ok) return auth;

  try {
    if (!(await canManageSponsors(auth.user.email))) {
      return { ok: false, status: 403, error: 'Sem permissao para gerenciar patrocinadores.' };
    }
  } catch (error) {
    console.error('[SPONSOR AUTH] Falha ao verificar permissao:', error instanceof Error ? error.message : error);
    return { ok: false, status: 500, error: 'Nao foi possivel validar a permissao para patrocinadores.' };
  }
  return auth;
}

export async function authorizeSponsorSelfOrManager(req: Request, sponsorId: string): Promise<HoldingAdminAuthResult> {
  const user = await authenticateHoldingUser(req);
  if (!user.ok) return user;

  const email = normalizeEmail(user.user.email);
  if (email) {
    const { data: sponsor, error } = await supabaseServer
      .from('patrocinadores')
      .select('id')
      .eq('id', sponsorId)
      .ilike('email', email)
      .maybeSingle();
    if (error) {
      return { ok: false, status: 500, error: 'Nao foi possivel validar o patrocinador.' };
    }
    if (sponsor) return user;

    const { data: anySponsor, error: sponsorError } = await supabaseServer
      .from('patrocinadores')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (sponsorError) return { ok: false, status: 500, error: 'Nao foi possivel validar o patrocinador.' };
    if (anySponsor || user.user.role === 'sponsor') {
      return { ok: false, status: 403, error: 'Acesso negado a este patrocinador.' };
    }
  }

  const manager = await authorizeSponsorManagement(req);
  if (!manager.ok) return manager;
  return manager;
}
