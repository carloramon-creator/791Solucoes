import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

const EDITABLE_FIELDS = [
  'nome', 'razao_social', 'email', 'cpf_cnpj', 'telefone', 'nome_responsavel',
  'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep',
  'total_licencas', 'valor_mensal', 'ciclo',
] as const;

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

async function findAuthUserByEmail(email: string): Promise<User | null> {
  if (!email) return null;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseServer.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((u) => normalizeEmail(u.email) === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function loadSponsor(id: string) {
  const { data, error } = await supabaseServer
    .from('patrocinadores')
    .select('id, nome, email')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Atualiza o patrocinador e mantém o e-mail do login (Auth) igual ao e-mail de acesso. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem editar patrocinadores.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const body = await req.json();
    const sponsor = await loadSponsor(id);
    if (!sponsor) return NextResponse.json({ success: false, error: 'Patrocinador nao encontrado.' }, { status: 404 });

    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    const oldEmail = normalizeEmail(sponsor.email);
    const newEmail = 'email' in updates ? normalizeEmail(updates.email) : oldEmail;
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return NextResponse.json({ success: false, error: 'E-mail de acesso invalido.' }, { status: 400 });
    }
    updates.email = newEmail;

    let movedAuthUser: User | null = null;
    if (newEmail !== oldEmail) {
      const { data: otherSponsor } = await supabaseServer
        .from('patrocinadores')
        .select('id')
        .ilike('email', newEmail)
        .neq('id', id)
        .maybeSingle();
      if (otherSponsor) {
        return NextResponse.json({ success: false, error: 'Este e-mail ja pertence a outro patrocinador.' }, { status: 409 });
      }

      const [oldUser, userWithNewEmail] = await Promise.all([findAuthUserByEmail(oldEmail), findAuthUserByEmail(newEmail)]);
      if (userWithNewEmail && userWithNewEmail.id !== oldUser?.id) {
        return NextResponse.json({ success: false, error: 'Ja existe um login com este e-mail na holding. Use outro e-mail.' }, { status: 409 });
      }

      if (oldUser) {
        const { error: authError } = await supabaseServer.auth.admin.updateUserById(oldUser.id, {
          email: newEmail,
          email_confirm: true,
        });
        if (authError) throw new Error(`Falha ao atualizar o login: ${authError.message}`);
        movedAuthUser = oldUser;
      }
    }

    const { data, error } = await supabaseServer
      .from('patrocinadores')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (movedAuthUser) {
        await supabaseServer.auth.admin.updateUserById(movedAuthUser.id, { email: oldEmail, email_confirm: true });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      sponsor: data,
      authUpdated: !!movedAuthUser,
      authMissing: newEmail !== oldEmail && !movedAuthUser,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Erro ao atualizar patrocinador.' }, { status: 500 });
  }
}

/** Exclui o patrocinador (tokens vão junto) e o login dele; recusa se algum token estiver em uso. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem excluir patrocinadores.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const sponsor = await loadSponsor(id);
    if (!sponsor) return NextResponse.json({ success: false, error: 'Patrocinador nao encontrado.' }, { status: 404 });

    const { count, error: countError } = await supabaseServer
      .from('vouchers')
      .select('id', { count: 'exact', head: true })
      .eq('patrocinador_id', id)
      .not('usado_por_vidracaria_id', 'is', null);
    if (countError) throw countError;
    if ((count || 0) > 0) {
      return NextResponse.json({
        success: false,
        error: `Este patrocinador tem ${count} vidracaria(s) licenciada(s). Revogue os tokens em uso antes de excluir, para nao derrubar a licenca delas.`,
      }, { status: 409 });
    }

    const { error } = await supabaseServer.from('patrocinadores').delete().eq('id', id);
    if (error) throw error;

    let authDeleted = false;
    const authUser = await findAuthUserByEmail(normalizeEmail(sponsor.email));
    // Só remove login de patrocinador; nunca apaga um admin que use o mesmo e-mail.
    if (authUser && authUser.user_metadata?.role === 'sponsor') {
      const { error: authError } = await supabaseServer.auth.admin.deleteUser(authUser.id);
      authDeleted = !authError;
    }

    return NextResponse.json({ success: true, authDeleted });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Erro ao excluir patrocinador.' }, { status: 500 });
  }
}
