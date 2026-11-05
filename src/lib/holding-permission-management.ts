import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function authorizePermissionManagement(email: string | null) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return NextResponse.json({ error: 'Sem permissao para gerenciar perfis.' }, { status: 403, headers });
    const assignments = await supabaseServer.from('holding_user_permission_profiles')
      .select('profile_id').eq('user_email', normalized);
    if (assignments.error) throw assignments.error;
    const ids = (assignments.data || []).map((row) => row.profile_id);
    if (!ids.length) return NextResponse.json({ error: 'Sem permissao para gerenciar perfis.' }, { status: 403, headers });
    const profiles = await supabaseServer.from('holding_permission_profiles').select('id,name,is_system')
      .in('id', ids).eq('active', true);
    if (profiles.error) throw profiles.error;
    if (profiles.data?.some((profile) => profile.is_system && profile.name === 'Dono')) return null;
    const activeIds = (profiles.data || []).map((profile) => profile.id);
    if (activeIds.length) {
      const code = 'action.permissions.manage_profiles';
      const [resource, grants] = await Promise.all([
        supabaseServer.from('holding_permission_resources').select('code').eq('code', code).eq('active', true),
        supabaseServer.from('holding_profile_resource_permissions').select('profile_id')
          .in('profile_id', activeIds).eq('resource_code', code).eq('enabled', true),
      ]);
      if (resource.error) throw resource.error;
      if (grants.error) throw grants.error;
      if (resource.data?.length && grants.data?.length) return null;
    }
    return NextResponse.json({ error: 'Sem permissao para gerenciar perfis.' }, { status: 403, headers });
  } catch {
    console.error('[PERMISSIONS] Autorizacao de gerenciamento indisponivel.');
    return NextResponse.json({ error: 'Nao foi possivel autorizar a alteracao de permissoes.' }, { status: 503, headers });
  }
}
