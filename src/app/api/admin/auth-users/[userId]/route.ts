import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGlassClient } from '@/lib/glass-client';
import { deleteGlassAuthUser } from '@/lib/glass-auth-user-cleanup';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';

const REQUIRED_AUTH_DELETE_PERMISSIONS = [
  'menu.assinaturas',
  'action.assinaturas.purge_test_tenant',
];

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
      return { ok: false, status: 403, error: 'Patrocinadores nao podem executar manutencao de usuarios.' };
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

export async function DELETE(req: Request, context: { params: Promise<{ userId: string }> }) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = await context.params;
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return NextResponse.json({ error: 'Informe um userId valido.' }, { status: 400 });
  }

  try {
    if (!await hasExplicitHoldingPermission(auth.user.email, REQUIRED_AUTH_DELETE_PERMISSIONS)) {
      return NextResponse.json({ error: 'Sem permissão administrativa explícita para remover usuários do Auth.' }, { status: 403 });
    }

    const glass = await getGlassClient();
    const { data: targetUserData, error: targetUserError } = await glass.auth.admin.getUserById(normalizedUserId);
    if (targetUserError) {
      return NextResponse.json(
        { error: targetUserError.message || 'Falha ao consultar usuário Auth.' },
        { status: targetUserError.status === 404 ? 404 : 500 }
      );
    }
    if (!targetUserData.user) {
      return NextResponse.json({ error: 'Usuário Auth não encontrado.' }, { status: 404 });
    }
    if (
      (targetUserData.user.user_metadata?.holding_chat === true
      || targetUserData.user.user_metadata?.holding_support === true)
      && new URL(req.url).searchParams.get('confirmTechnical') !== 'true'
    ) {
      return NextResponse.json({ error: 'Confirme explicitamente a remoção da conta técnica de suporte/chat.' }, { status: 409 });
    }

    const removedFromAuth = await deleteGlassAuthUser(glass, normalizedUserId);

    return NextResponse.json({
      ok: true,
      userId: normalizedUserId,
      removedFromAuth,
      executadoPor: auth.user.email,
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return NextResponse.json({ error: candidate?.message || 'Falha ao excluir usuario.' }, { status: 500 });
  }
}