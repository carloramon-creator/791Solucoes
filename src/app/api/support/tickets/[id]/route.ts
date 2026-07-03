import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { isOpenStatus, parseTicketStatus } from '@/lib/support-queue';
import { userCanAccessResource } from '@/lib/holding-permissions';

const AVATAR_BUCKET = 'equipe-avatars';
const SUPPORT_DELETE_TICKET_PERMISSION = 'action.support.delete_ticket';

function formatStatusLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    new: 'Novo',
    in_progress: 'Em andamento',
    waiting_customer: 'Aguardando cliente',
    resolved: 'Resolvido',
    closed: 'Fechado',
  };
  const key = String(value || '').trim();
  return labels[key] || key || '--';
}

function formatPriorityLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    low: 'Baixa',
    normal: 'Normal',
    high: 'Alta',
    urgent: 'Urgente',
  };
  const key = String(value || '').trim();
  return labels[key] || key || '--';
}

function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActorDisplayName(email: string | null | undefined) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return 'Sistema';
  const [namePart] = normalized.split('@');
  if (!namePart) return normalized;
  return namePart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

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
      .select('id, status, priority, assigned_to_email, due_at, first_response_at, resolved_at')
      .eq('id', ticketId)
      .single();

    if (currentError || !current) {
      return NextResponse.json({ error: currentError?.message || 'Ticket nao encontrado.' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    const actionParts: string[] = [];
    const actorName = getActorDisplayName(auth.user.email);

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

      if (priority !== String(current.priority || '')) {
        actionParts.push(`Prioridade alterada por ${actorName}: ${formatPriorityLabel(current.priority)} para ${formatPriorityLabel(priority)}.`);
      }
    }

    if (body?.assignToMe === true && body?.assignedToEmail === undefined) {
      const targetEmail = auth.user.email?.toLowerCase() || null;
      updateData.assigned_to_email = targetEmail;
      if (targetEmail !== String(current.assigned_to_email || '').toLowerCase()) {
        actionParts.push(`Ticket assumido por ${actorName}.`);
      }
    }

    if (body?.assignedToEmail !== undefined) {
      const nextAssigned = body.assignedToEmail
        ? String(body.assignedToEmail).trim().toLowerCase()
        : null;
      updateData.assigned_to_email = nextAssigned;

      if ((nextAssigned || '') !== String(current.assigned_to_email || '').toLowerCase()) {
        actionParts.push(`Responsavel alterado por ${actorName}: ${String(current.assigned_to_email || 'sem responsavel')} para ${String(nextAssigned || 'sem responsavel')}.`);
      }
    }

    if (body?.dueAt !== undefined) {
      const nextDueAt = body.dueAt ? new Date(body.dueAt).toISOString() : null;
      updateData.due_at = nextDueAt;
      if ((nextDueAt || '') !== String(current.due_at || '')) {
        const formattedDueAt = formatDateTimeLabel(nextDueAt);
        actionParts.push(formattedDueAt
          ? `Prazo alterado por ${actorName} para ${formattedDueAt}.`
          : `Prazo removido por ${actorName}.`);
      }
    }

    const nextStatus = parseTicketStatus(body?.status ? String(body.status) : null);
    if (nextStatus) {
      updateData.status = nextStatus;

      if (nextStatus !== String(current.status || '')) {
        if (nextStatus === 'resolved') {
          actionParts.push(`Ticket concluido por ${actorName}.`);
        } else if (nextStatus === 'closed') {
          actionParts.push(`Ticket fechado por ${actorName}.`);
        } else {
          actionParts.push(`Status alterado por ${actorName}: ${formatStatusLabel(current.status)} para ${formatStatusLabel(nextStatus)}.`);
        }
      }

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

    if (actionParts.length > 0) {
      await supabaseServer
        .from('support_ticket_messages')
        .insert({
          ticket_id: ticketId,
          origin: 'system',
          author_email: auth.user.email?.toLowerCase() || null,
          author_name: null,
          message: `Ato: ${actionParts.join(' ')}`,
          is_internal: false,
        });
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

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem excluir ticket de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const allowed = await userCanAccessResource(auth.user.email, SUPPORT_DELETE_TICKET_PERMISSION);
  if (!allowed) {
    return NextResponse.json({ error: 'Sem permissao para excluir ticket.' }, { status: 403 });
  }

  const { id } = await context.params;
  const ticketId = String(id || '').trim();

  if (!ticketId) {
    return NextResponse.json({ error: 'ID do ticket invalido.' }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from('support_tickets')
    .delete()
    .eq('id', ticketId);

  if (error) {
    return NextResponse.json({ error: error.message || 'Falha ao excluir ticket.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedId: ticketId, deletedBy: auth.user.email });
}
