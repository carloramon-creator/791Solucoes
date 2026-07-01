import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getAllPermissionResources } from '@/lib/holding-permissions';

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)));
}

function normalizeResourceCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v || '').trim()).filter(Boolean)));
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem consultar permissoes.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [
    { data: profiles, error: profilesError },
    { data: profileResources, error: profileResourcesError },
    { data: userProfiles, error: userProfilesError },
    resources,
  ] = await Promise.all([
    supabaseServer
      .from('holding_permission_profiles')
      .select('id, name, description, active, is_system, created_at, updated_at')
      .order('name', { ascending: true }),
    supabaseServer
      .from('holding_profile_resource_permissions')
      .select('profile_id, resource_code, enabled'),
    supabaseServer
      .from('holding_user_permission_profiles')
      .select('user_email, profile_id'),
    getAllPermissionResources(),
  ]);

  if (profilesError || profileResourcesError || userProfilesError) {
    return NextResponse.json({
      error: profilesError?.message || profileResourcesError?.message || userProfilesError?.message || 'Falha ao carregar permissoes.',
    }, { status: 500 });
  }

  const resourceMapByProfile = new Map<string, string[]>();
  for (const row of profileResources || []) {
    if (!row.enabled) continue;
    const profileId = String(row.profile_id || '');
    const resourceCode = String(row.resource_code || '');
    if (!profileId || !resourceCode) continue;

    if (!resourceMapByProfile.has(profileId)) {
      resourceMapByProfile.set(profileId, []);
    }
    resourceMapByProfile.get(profileId)?.push(resourceCode);
  }

  const usersByProfile = new Map<string, string[]>();
  for (const row of userProfiles || []) {
    const profileId = String(row.profile_id || '');
    const userEmail = String(row.user_email || '').trim().toLowerCase();
    if (!profileId || !userEmail) continue;

    if (!usersByProfile.has(profileId)) {
      usersByProfile.set(profileId, []);
    }
    usersByProfile.get(profileId)?.push(userEmail);
  }

  const normalizedProfiles = (profiles || []).map((profile) => ({
    ...profile,
    resourceCodes: Array.from(new Set(resourceMapByProfile.get(String(profile.id)) || [])).sort(),
    userEmails: Array.from(new Set(usersByProfile.get(String(profile.id)) || [])).sort(),
  }));

  return NextResponse.json({
    resources,
    profiles: normalizedProfiles,
    totalProfiles: normalizedProfiles.length,
  });
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem criar perfis de permissao.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const name = String(body?.name || '').trim();
    const description = body?.description ? String(body.description).trim() : null;
    const active = body?.active == null ? true : Boolean(body.active);

    const resourceCodes = normalizeResourceCodes(body?.resourceCodes);
    const userEmails = normalizeEmails(body?.userEmails);

    if (!name) {
      return NextResponse.json({ error: 'Informe o nome do perfil.' }, { status: 400 });
    }

    const { data: created, error: createError } = await supabaseServer
      .from('holding_permission_profiles')
      .insert({ name, description, active, is_system: false })
      .select('id, name, description, active, is_system, created_at, updated_at')
      .single();

    if (createError || !created) {
      return NextResponse.json({ error: createError?.message || 'Falha ao criar perfil.' }, { status: 500 });
    }

    if (resourceCodes.length > 0) {
      const payload = resourceCodes.map((resourceCode) => ({
        profile_id: created.id,
        resource_code: resourceCode,
        enabled: true,
      }));
      const { error } = await supabaseServer
        .from('holding_profile_resource_permissions')
        .insert(payload);
      if (error) {
        return NextResponse.json({ error: error.message || 'Perfil criado, mas falhou ao salvar recursos.' }, { status: 500 });
      }
    }

    if (userEmails.length > 0) {
      const payload = userEmails.map((email) => ({
        user_email: email,
        profile_id: created.id,
      }));
      const { error } = await supabaseServer
        .from('holding_user_permission_profiles')
        .insert(payload);
      if (error) {
        return NextResponse.json({ error: error.message || 'Perfil criado, mas falhou ao vincular usuarios.' }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...created,
        resourceCodes,
        userEmails,
      },
      createdBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao criar perfil.' }, { status: 500 });
  }
}
