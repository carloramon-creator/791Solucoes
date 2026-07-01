import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function normalizeProfileIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v || '').trim()).filter(Boolean)));
}

export async function PATCH(req: Request, context: { params: Promise<{ email: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem alterar permissao de usuario.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { email } = await context.params;
  const userEmail = decodeURIComponent(String(email || '').trim().toLowerCase());
  if (!userEmail) {
    return NextResponse.json({ error: 'E-mail invalido.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const profileIds = normalizeProfileIds(body?.profileIds);

    const { error: deleteError } = await supabaseServer
      .from('holding_user_permission_profiles')
      .delete()
      .eq('user_email', userEmail);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message || 'Falha ao limpar perfis do usuario.' }, { status: 500 });
    }

    if (profileIds.length > 0) {
      const payload = profileIds.map((profileId) => ({
        user_email: userEmail,
        profile_id: profileId,
      }));

      const { error: insertError } = await supabaseServer
        .from('holding_user_permission_profiles')
        .insert(payload);

      if (insertError) {
        return NextResponse.json({ error: insertError.message || 'Falha ao salvar perfil do usuario.' }, { status: 500 });
      }
    }

    const { data: profileRows } = await supabaseServer
      .from('holding_user_permission_profiles')
      .select('profile_id, holding_permission_profiles(id, name, active)')
      .eq('user_email', userEmail);

    const assignedProfiles = (profileRows || [])
      .map((row: any) => row.holding_permission_profiles)
      .filter((profile: any) => profile && profile.active)
      .map((profile: any) => ({ id: profile.id, name: profile.name }));

    const primaryProfileName = assignedProfiles[0]?.name || null;

    await supabaseServer
      .from('equipe_791')
      .update({ cargo: primaryProfileName })
      .eq('email', userEmail);

    return NextResponse.json({
      ok: true,
      userEmail,
      profileIds,
      assignedProfiles,
      updatedBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao atualizar permissao do usuario.' }, { status: 500 });
  }
}
