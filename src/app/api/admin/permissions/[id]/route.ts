import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)));
}

function normalizeResourceCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v || '').trim()).filter(Boolean)));
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem atualizar perfis de permissao.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const profileId = String(id || '').trim();
  if (!profileId) {
    return NextResponse.json({ error: 'Perfil invalido.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body?.name != null) {
      const name = String(body.name || '').trim();
      if (!name) {
        return NextResponse.json({ error: 'Nome do perfil nao pode ficar vazio.' }, { status: 400 });
      }
      updateData.name = name;
    }

    if (body?.description !== undefined) {
      updateData.description = body.description == null ? null : String(body.description).trim();
    }

    if (body?.active !== undefined) {
      updateData.active = Boolean(body.active);
    }

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabaseServer
        .from('holding_permission_profiles')
        .update(updateData)
        .eq('id', profileId);

      if (error) {
        return NextResponse.json({ error: error.message || 'Falha ao atualizar perfil.' }, { status: 500 });
      }
    }

    if (body?.resourceCodes !== undefined) {
      const resourceCodes = normalizeResourceCodes(body.resourceCodes);

      const { error: deleteError } = await supabaseServer
        .from('holding_profile_resource_permissions')
        .delete()
        .eq('profile_id', profileId);

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message || 'Falha ao atualizar recursos do perfil.' }, { status: 500 });
      }

      if (resourceCodes.length > 0) {
        const payload = resourceCodes.map((resourceCode) => ({
          profile_id: profileId,
          resource_code: resourceCode,
          enabled: true,
        }));

        const { error: insertError } = await supabaseServer
          .from('holding_profile_resource_permissions')
          .insert(payload);

        if (insertError) {
          return NextResponse.json({ error: insertError.message || 'Falha ao atualizar recursos do perfil.' }, { status: 500 });
        }
      }
    }

    if (body?.userEmails !== undefined) {
      const userEmails = normalizeEmails(body.userEmails);

      const { error: deleteError } = await supabaseServer
        .from('holding_user_permission_profiles')
        .delete()
        .eq('profile_id', profileId);

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message || 'Falha ao atualizar usuarios do perfil.' }, { status: 500 });
      }

      if (userEmails.length > 0) {
        const payload = userEmails.map((email) => ({
          profile_id: profileId,
          user_email: email,
        }));

        const { error: insertError } = await supabaseServer
          .from('holding_user_permission_profiles')
          .insert(payload);

        if (insertError) {
          return NextResponse.json({ error: insertError.message || 'Falha ao atualizar usuarios do perfil.' }, { status: 500 });
        }
      }
    }

    const [
      { data: profile, error: profileError },
      { data: profileResources, error: profileResourcesError },
      { data: userProfiles, error: userProfilesError },
    ] = await Promise.all([
      supabaseServer
        .from('holding_permission_profiles')
        .select('id, name, description, active, is_system, created_at, updated_at')
        .eq('id', profileId)
        .single(),
      supabaseServer
        .from('holding_profile_resource_permissions')
        .select('resource_code')
        .eq('profile_id', profileId)
        .eq('enabled', true),
      supabaseServer
        .from('holding_user_permission_profiles')
        .select('user_email')
        .eq('profile_id', profileId),
    ]);

    if (profileError || !profile || profileResourcesError || userProfilesError) {
      return NextResponse.json({ error: profileError?.message || profileResourcesError?.message || userProfilesError?.message || 'Perfil nao encontrado.' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...profile,
        resourceCodes: (profileResources || []).map((row: any) => String(row.resource_code)),
        userEmails: (userProfiles || []).map((row: any) => String(row.user_email).toLowerCase()),
      },
      updatedBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao atualizar perfil.' }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem inativar perfis de permissao.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const profileId = String(id || '').trim();
  if (!profileId) {
    return NextResponse.json({ error: 'Perfil invalido.' }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from('holding_permission_profiles')
    .update({ active: false })
    .eq('id', profileId);

  if (error) {
    return NextResponse.json({ error: error.message || 'Falha ao inativar perfil.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profileId,
    inactivatedBy: auth.user.email,
  });
}
