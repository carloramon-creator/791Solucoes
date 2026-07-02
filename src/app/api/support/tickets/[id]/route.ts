import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { isOpenStatus, parseTicketStatus } from '@/lib/support-queue';

const AVATAR_BUCKET = 'equipe-avatars';

async function getAvatarByEmail(email: string | null | undefined): Promise<string | null> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;

  const { data: member } = await supabaseServer
    .from('equipe_791')
    .select('foto_path')
    .eq('email', normalized)
    .maybeSingle();

  const fotoPath = member?.foto_path ? String(member.foto_path).trim() : '';
  if (!fotoPath) return null;

  const { data: signedAvatar } = await supabaseServer.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(fotoPath, 60 * 60);

  return signedAvatar?.signedUrl || null;
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem visualizar ticket de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const ticketId = String(id || '').trim();

  if (!ticketId) {
    return NextResponse.json({ error: 'ID do ticket invalido.' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('support_tickets')
    .select('id, protocol, tenant_slug, tenant_name, tenant_id, requester_name, requester_email, requester_phone, subject_id, title, description, priority, status, assigned_to_email, created_by_email, due_at, first_response_at, resolved_at, created_at, updated_at, subject:support_subjects(id, name)')
    .eq('id', ticketId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Ticket nao encontrado.' }, { status: 404 });
  }

  const assignedToAvatarUrl = await getAvatarByEmail(data.assigned_to_email || null);
  return NextResponse.json({
    ticket: {
      ...data,
      assigned_to_avatar_url: assignedToAvatarUrl,
    },
  });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem atualizar ticket de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const ticketId = String(id || '').trim();

  if (!ticketId) {
    return NextResponse.json({ error: 'ID do ticket invalido.' }, { status: 400 });
  }

  try {
    const body = await req.json();

    const { data: current, error: currentError } = await supabaseServer
      .from('support_tickets')
      .select('id, status, first_response_at, resolved_at')
      .eq('id', ticketId)
      .single();

    if (currentError || !current) {
      return NextResponse.json({ error: currentError?.message || 'Ticket nao encontrado.' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (body?.title != null) {
      const title = String(body.title || '').trim();
      if (!title) {
        return NextResponse.json({ error: 'Titulo nao pode ficar vazio.' }, { status: 400 });
      }
      updateData.title = title;
    }

    if (body?.description != null) {
      const description = String(body.description || '').trim();
      if (!description) {
        return NextResponse.json({ error: 'Descricao nao pode ficar vazia.' }, { status: 400 });
      }
      updateData.description = description;
    }

    if (body?.subjectId !== undefined) {
      updateData.subject_id = body.subjectId ? String(body.subjectId).trim() : null;
    }

    if (body?.priority != null) {
      const priority = String(body.priority);
      if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
        return NextResponse.json({ error: 'Prioridade invalida.' }, { status: 400 });
      }
      updateData.priority = priority;
    }

    if (body?.assignToMe === true) {
      updateData.assigned_to_email = auth.user.email?.toLowerCase() || null;
    }

    if (body?.assignedToEmail !== undefined) {
      updateData.assigned_to_email = body.assignedToEmail
        ? String(body.assignedToEmail).trim().toLowerCase()
        : null;
    }

    if (body?.dueAt !== undefined) {
      updateData.due_at = body.dueAt ? new Date(body.dueAt).toISOString() : null;
    }

    const nextStatus = parseTicketStatus(body?.status ? String(body.status) : null);
    if (nextStatus) {
      updateData.status = nextStatus;

      if (nextStatus === 'in_progress' && !current.first_response_at) {
        updateData.first_response_at = new Date().toISOString();
      }

      if (nextStatus === 'resolved' || nextStatus === 'closed') {
        updateData.resolved_at = current.resolved_at || new Date().toISOString();
      } else if (isOpenStatus(nextStatus)) {
        updateData.resolved_at = null;
      }
    }

    const { data: updated, error: updateError } = await supabaseServer
      .from('support_tickets')
      .update(updateData)
      .eq('id', ticketId)
      .select('id, protocol, tenant_slug, tenant_name, tenant_id, requester_name, requester_email, requester_phone, subject_id, title, description, priority, status, assigned_to_email, created_by_email, due_at, first_response_at, resolved_at, created_at, updated_at, subject:support_subjects(id, name)')
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message || 'Falha ao atualizar ticket.' }, { status: 500 });
    }

    const assignedToAvatarUrl = await getAvatarByEmail(updated.assigned_to_email || null);

    return NextResponse.json({
      ok: true,
      ticket: {
        ...updated,
        assigned_to_avatar_url: assignedToAvatarUrl,
      },
      updatedBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao atualizar ticket.' }, { status: 500 });
  }
}
