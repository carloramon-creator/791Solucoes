import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import {
  DONE_STATUSES,
  OPEN_STATUSES,
  parseSupportQueue,
  parseTicketStatus,
  type SupportQueue,
} from '@/lib/support-queue';

function toPositiveInt(value: string | null, fallback: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(Math.floor(num), max);
}

function applyQueueFilters(query: any, queue: SupportQueue, currentEmail: string | null) {
  const nowIso = new Date().toISOString();

  if (queue === 'new') {
    return query.eq('status', 'new');
  }

  if (queue === 'mine') {
    if (!currentEmail) {
      return query.eq('assigned_to_email', '__none__');
    }
    return query.eq('assigned_to_email', currentEmail.toLowerCase()).in('status', OPEN_STATUSES);
  }

  if (queue === 'overdue') {
    return query.in('status', OPEN_STATUSES).lt('due_at', nowIso);
  }

  if (queue === 'done') {
    return query.in('status', DONE_STATUSES);
  }

  return query;
}

async function countQueue(queue: SupportQueue, currentEmail: string | null): Promise<number> {
  let query = supabaseServer.from('support_tickets').select('id', { count: 'exact', head: true });
  query = applyQueueFilters(query, queue, currentEmail);
  const { count, error } = await query;
  if (error) return 0;
  return count || 0;
}

export async function GET(req: NextRequest) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem acessar tickets de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const searchParams = req.nextUrl.searchParams;
    const queue = parseSupportQueue(searchParams.get('queue'));
    const status = parseTicketStatus(searchParams.get('status'));
    const subjectId = searchParams.get('subjectId');
    const assigneeEmail = searchParams.get('assigneeEmail');
    const search = (searchParams.get('search') || '').trim();
    const limit = toPositiveInt(searchParams.get('limit'), 60, 200);

    let query = supabaseServer
      .from('support_tickets')
      .select('id, protocol, tenant_slug, tenant_name, tenant_id, requester_name, requester_email, requester_phone, subject_id, title, description, priority, status, assigned_to_email, created_by_email, due_at, first_response_at, resolved_at, created_at, updated_at, subject:support_subjects(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    query = applyQueueFilters(query, queue, auth.user.email);

    if (status) {
      query = query.eq('status', status);
    }

    if (subjectId) {
      query = query.eq('subject_id', subjectId);
    }

    if (assigneeEmail) {
      query = query.eq('assigned_to_email', assigneeEmail.toLowerCase());
    }

    if (search) {
      const safeSearch = search.replace(/[%_,]/g, ' ').trim();
      if (safeSearch) {
        query = query.or(`protocol.ilike.%${safeSearch}%,title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,tenant_name.ilike.%${safeSearch}%`);
      }
    }

    const [{ data, error, count }, countsResult] = await Promise.all([
      query,
      Promise.all([
        countQueue('all', auth.user.email),
        countQueue('new', auth.user.email),
        countQueue('mine', auth.user.email),
        countQueue('overdue', auth.user.email),
        countQueue('done', auth.user.email),
      ]),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message || 'Falha ao carregar tickets.' }, { status: 500 });
    }

    const [allCount, newCount, mineCount, overdueCount, doneCount] = countsResult;

    return NextResponse.json({
      total: count || 0,
      tickets: data || [],
      counts: {
        all: allCount,
        new: newCount,
        mine: mineCount,
        overdue: overdueCount,
        done: doneCount,
      },
      queue,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao carregar tickets.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem abrir tickets de suporte.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();

    const tenantSlug = String(body?.tenantSlug || '').trim();
    const tenantName = body?.tenantName ? String(body.tenantName).trim() : null;
    const tenantId = body?.tenantId ? String(body.tenantId).trim() : null;
    const title = String(body?.title || '').trim();
    const description = String(body?.description || '').trim();
    const subjectId = body?.subjectId ? String(body.subjectId).trim() : null;

    if (!tenantSlug) {
      return NextResponse.json({ error: 'tenantSlug e obrigatorio.' }, { status: 400 });
    }

    if (!title || !description) {
      return NextResponse.json({ error: 'Titulo e descricao sao obrigatorios.' }, { status: 400 });
    }

    const requesterName = body?.requesterName ? String(body.requesterName).trim() : null;
    const requesterEmail = body?.requesterEmail ? String(body.requesterEmail).trim().toLowerCase() : null;
    const requesterPhone = body?.requesterPhone ? String(body.requesterPhone).trim() : null;

    const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
    const priority = allowedPriorities.has(String(body?.priority || 'normal'))
      ? String(body.priority)
      : 'normal';

    const allowedStatuses = new Set(['new', 'in_progress', 'waiting_customer', 'resolved', 'closed']);
    const status = allowedStatuses.has(String(body?.status || 'new'))
      ? String(body.status)
      : 'new';

    let assignedToEmail = body?.assignedToEmail
      ? String(body.assignedToEmail).trim().toLowerCase()
      : null;

    if (!assignedToEmail && subjectId) {
      const { data: assignment } = await supabaseServer
        .from('support_subject_assignments')
        .select('assignee_email')
        .eq('subject_id', subjectId)
        .limit(1)
        .maybeSingle();

      if (assignment?.assignee_email) {
        assignedToEmail = String(assignment.assignee_email).trim().toLowerCase();
      }
    }

    const dueAt = body?.dueAt ? new Date(body.dueAt).toISOString() : null;

    const insertPayload = {
      tenant_slug: tenantSlug,
      tenant_name: tenantName,
      tenant_id: tenantId,
      requester_name: requesterName,
      requester_email: requesterEmail,
      requester_phone: requesterPhone,
      subject_id: subjectId,
      title,
      description,
      priority,
      status,
      assigned_to_email: assignedToEmail,
      created_by_email: auth.user.email,
      due_at: dueAt,
    };

    const { data: created, error: createError } = await supabaseServer
      .from('support_tickets')
      .insert(insertPayload)
      .select('id, protocol, tenant_slug, tenant_name, tenant_id, requester_name, requester_email, requester_phone, subject_id, title, description, priority, status, assigned_to_email, created_by_email, due_at, first_response_at, resolved_at, created_at, updated_at, subject:support_subjects(id, name)')
      .single();

    if (createError || !created) {
      return NextResponse.json({ error: createError?.message || 'Falha ao criar ticket.' }, { status: 500 });
    }

    const firstMessageOrigin = body?.messageOrigin === 'tenant' ? 'tenant' : 'holding';
    const firstMessageAuthorName = body?.messageAuthorName ? String(body.messageAuthorName).trim() : null;

    const { error: messageError } = await supabaseServer
      .from('support_ticket_messages')
      .insert({
        ticket_id: created.id,
        origin: firstMessageOrigin,
        author_email: requesterEmail || auth.user.email,
        author_name: firstMessageAuthorName,
        message: description,
        is_internal: false,
      });

    if (messageError) {
      return NextResponse.json({ error: messageError.message || 'Ticket criado, mas falhou ao registrar mensagem inicial.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      ticket: created,
      createdBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao criar ticket.' }, { status: 500 });
  }
}
