import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  ));
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem atualizar assuntos de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const subjectId = String(id || '').trim();
  if (!subjectId) {
    return NextResponse.json({ error: 'ID do assunto invalido.' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body?.name != null) {
      const name = String(body.name || '').trim();
      if (!name) {
        return NextResponse.json({ error: 'Nome do assunto nao pode ficar vazio.' }, { status: 400 });
      }
      updateData.name = name;
    }

    if (body?.description !== undefined) {
      const description = body.description == null ? null : String(body.description).trim();
      updateData.description = description;
    }

    if (body?.active !== undefined) {
      updateData.active = Boolean(body.active);
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabaseServer
        .from('support_subjects')
        .update(updateData)
        .eq('id', subjectId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message || 'Falha ao atualizar assunto.' }, { status: 500 });
      }
    }

    if (body?.assigneeEmails !== undefined) {
      const assigneeEmails = normalizeEmails(body.assigneeEmails);

      const { error: deleteError } = await supabaseServer
        .from('support_subject_assignments')
        .delete()
        .eq('subject_id', subjectId);

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message || 'Falha ao atualizar responsaveis.' }, { status: 500 });
      }

      if (assigneeEmails.length > 0) {
        const payload = assigneeEmails.map((email) => ({ subject_id: subjectId, assignee_email: email }));
        const { error: insertError } = await supabaseServer
          .from('support_subject_assignments')
          .insert(payload);

        if (insertError) {
          return NextResponse.json({ error: insertError.message || 'Falha ao atualizar responsaveis.' }, { status: 500 });
        }
      }
    }

    const [{ data: subject, error: subjectError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      supabaseServer
        .from('support_subjects')
        .select('id, name, description, active, created_at, updated_at')
        .eq('id', subjectId)
        .single(),
      supabaseServer
        .from('support_subject_assignments')
        .select('assignee_email')
        .eq('subject_id', subjectId),
    ]);

    if (subjectError || assignmentsError || !subject) {
      return NextResponse.json({
        error: subjectError?.message || assignmentsError?.message || 'Assunto nao encontrado.',
      }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      subject: {
        ...subject,
        assigneeEmails: (assignments || []).map((row) => String(row.assignee_email || '').trim().toLowerCase()).filter(Boolean),
      },
      updatedBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao atualizar assunto.' }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem excluir assuntos de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const subjectId = String(id || '').trim();
  if (!subjectId) {
    return NextResponse.json({ error: 'ID do assunto invalido.' }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from('support_subjects')
    .update({ active: false })
    .eq('id', subjectId);

  if (error) {
    return NextResponse.json({ error: error.message || 'Falha ao inativar assunto.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    subjectId,
    inativadoPor: auth.user.email,
  });
}
