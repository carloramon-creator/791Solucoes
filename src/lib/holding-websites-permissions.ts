import { supabaseServer } from '@/lib/supabase-server';

export const WEBSITE_PERMISSION_CODES = {
  menu: 'menu.websites',
  view: 'action.websites.view',
  create: 'action.websites.create',
  edit: 'action.websites.edit',
  manage: 'action.websites.manage',
} as const;

export async function getHoldingWebsitesPermissions(email: string | null | undefined) {
  const denied = { menu: false, view: false, create: false, edit: false, manage: false };
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return denied;

  const assignments = await supabaseServer.from('holding_user_permission_profiles')
    .select('profile_id').eq('user_email', normalized);
  if (assignments.error) throw assignments.error;
  const assignedIds = (assignments.data || []).map((row) => row.profile_id);
  if (!assignedIds.length) return denied;

  const profiles = await supabaseServer.from('holding_permission_profiles')
    .select('id').in('id', assignedIds).eq('active', true);
  if (profiles.error) throw profiles.error;
  const activeIds = (profiles.data || []).map((row) => row.id);
  if (!activeIds.length) return denied;

  const codes = Object.values(WEBSITE_PERMISSION_CODES);
  const [resources, permissions] = await Promise.all([
    supabaseServer.from('holding_permission_resources').select('code')
      .in('code', codes).eq('active', true),
    supabaseServer.from('holding_profile_resource_permissions').select('resource_code')
      .in('profile_id', activeIds).in('resource_code', codes).eq('enabled', true),
  ]);
  if (resources.error) throw resources.error;
  if (permissions.error) throw permissions.error;
  const active = new Set((resources.data || []).map((row) => row.code));
  const enabled = new Set((permissions.data || []).map((row) => row.resource_code));
  const allows = (code: string) => active.has(code) && enabled.has(code);
  return {
    menu: allows(WEBSITE_PERMISSION_CODES.menu),
    view: allows(WEBSITE_PERMISSION_CODES.view),
    create: allows(WEBSITE_PERMISSION_CODES.create),
    edit: allows(WEBSITE_PERMISSION_CODES.edit),
    manage: allows(WEBSITE_PERMISSION_CODES.manage),
  };
}
