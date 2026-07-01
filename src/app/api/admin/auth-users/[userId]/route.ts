import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGlassClient } from '@/lib/glass-client';

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

function isMissingSchemaObjectError(error: unknown): boolean {
  const candidate = error as { message?: string; details?: string };
  const msg = String(candidate?.message || candidate?.details || '').toLowerCase();
  return (
    msg.includes('does not exist')
    || msg.includes('could not find the table')
    || msg.includes('schema cache')
    || msg.includes('could not find the')
  );
}

function isIgnorableAuthDeleteError(error: unknown): boolean {
  const candidate = error as { message?: string; status?: number };
  const msg = String(candidate?.message || '').toLowerCase();
  return candidate?.status === 404 || msg.includes('not found') || msg.includes('user not found');
}

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

async function releaseAuthUserReferences(admin: any, userId: string) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return;

  const tablesToNullify = [
    { table: 'pessoas', column: 'user_id' },
    { table: 'whatsapp_conversations', column: 'responsible_user_id' },
    { table: 'whatsapp_conversations', column: 'transferred_from_id' },
  ] as const;

  for (const target of tablesToNullify) {
    const { error } = await admin
      .from(target.table)
      .update({ [target.column]: null })
      .eq(target.column, normalizedUserId);

    if (!error) continue;
    if (isMissingSchemaObjectError(error)) continue;
    throw new Error(`[${target.table}.${target.column}] ${error.message || 'erro ao liberar referencia do usuario'}`);
  }
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
    const glass = await getGlassClient();
    await releaseAuthUserReferences(glass, normalizedUserId);

    const { error } = await glass.auth.admin.deleteUser(normalizedUserId);
    if (error && !isIgnorableAuthDeleteError(error)) {
      return NextResponse.json({ error: error.message || 'Falha ao excluir usuario no Auth.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      userId: normalizedUserId,
      removedFromAuth: !error,
      executadoPor: auth.user.email,
    });
  } catch (error: unknown) {
    const candidate = error as { message?: string };
    return NextResponse.json({ error: candidate?.message || 'Falha ao excluir usuario.' }, { status: 500 });
  }
}