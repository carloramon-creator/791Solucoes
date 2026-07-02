import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getUserProfileIds, getUserSubjectIds } from '@/lib/holding-permissions';
import {
  DONE_STATUSES,
  OPEN_STATUSES,
  parseSupportQueue,
  parseTicketStatus,
  type SupportQueue,
} from '@/lib/support-queue';

const AVATAR_BUCKET = 'equipe-avatars';

async function buildAvatarMap(emails: string[]): Promise<Map<string, string | null>> {
  const normalized = Array.from(new Set(emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)));
  const avatarMap = new Map<string, string | null>();
  if (normalized.length === 0) return avatarMap;

  const { data: members } = await supabaseServer
    .from('equipe_791')
    .select('email, foto_path')
    .in('email', normalized);

  for (const row of members || []) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) continue;

    const fotoPath = row.foto_path ? String(row.foto_path).trim() : '';
    if (!fotoPath) {
      avatarMap.set(email, null);
      continue;
    }

    const { data: signedAvatar } = await supabaseServer.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(fotoPath, 60 * 60);

    avatarMap.set(email, signedAvatar?.signedUrl || null);
  }

  return avatarMap;
}

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

function applySubjectVisibilityFilter(query: any, allowedSubjectIds: string[] | null) {
  if (allowedSubjectIds === null) {
    return query;
  }

  if (allowedSubjectIds.length === 0) {
    return query.eq('subject_id', '00000000-0000-0000-0000-000000000000');
  }

  return query.in('subject_id', allowedSubjectIds);
}

async function countQueue(queue: SupportQueue, currentEmail: string | null, allowedSubjectIds: string[] | null): Promise<number> {
  let query = supabaseServer.from('support_tickets').select('id', { count: 'exact', head: true });
  query = applyQueueFilters(query, queue, currentEmail);
  query = applySubjectVisibilityFilter(query, allowedSubjectIds);
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
    const allowedSubjectIds = await getUserSubjectIds(auth.user.email);

    let query = supabaseServer
      .from('support_tickets')
      .select('id, protocol, tenant_slug, tenant_name, tenant_id, requester_name, requester_email, requester_phone, subject_id, title, description, priority, status, assigned_to_email, created_by_email, due_at, first_response_at, resolved_at, created_at, updated_at, subject:support_subjects(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit);

    query = applyQueueFilters(query, queue, auth.user.email);
    query = applySubjectVisibilityFilter(query, allowedSubjectIds);

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
        countQueue('all', auth.user.email, allowedSubjectIds),
        countQueue('new', auth.user.email, allowedSubjectIds),
        countQueue('mine', auth.user.email, allowedSubjectIds),
        countQueue('overdue', auth.user.email, allowedSubjectIds),
        countQueue('done', auth.user.email, allowedSubjectIds),
      ]),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message || 'Falha ao carregar tickets.' }, { status: 500 });
    }

    const [allCount, newCount, mineCount, overdueCount, doneCount] = countsResult;

    const assigneeEmails = (data || [])
      .map((ticket: any) => String(ticket.assigned_to_email || '').trim().toLowerCase())
      .filter(Boolean);

    const assigneeAvatarMap = await buildAvatarMap(assigneeEmails);

    const ticketsWithAvatar = (data || []).map((ticket: any) => {
      const email = String(ticket.assigned_to_email || '').trim().toLowerCase();
      return {
        ...ticket,
        assigned_to_avatar_url: email ? (assigneeAvatarMap.get(email) ?? null) : null,
      };
    });

    return NextResponse.json({
      total: count || 0,
      tickets: ticketsWithAvatar,
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

      if (!assignedToEmail) {
        const { data: profileLinks } = await supabaseServer
          .from('support_subject_permission_profiles')
          .select('profile_id')
          .eq('subject_id', subjectId);

        const profileIds = Array.from(new Set((profileLinks || []).map((row: any) => String(row.profile_id || '').trim()).filter(Boolean)));

        if (profileIds.length > 0) {
          const { data: usersByProfile } = await supabaseServer
            .from('holding_user_permission_profiles')
            .select('user_email, profile_id')
            .in('profile_id', profileIds);

          const candidate = (usersByProfile || [])
            .map((row: any) => String(row.user_email || '').trim().toLowerCase())
            .find(Boolean);

          if (candidate) {
            assignedToEmail = candidate;
          }
        }
      }
    }

    if (subjectId) {
      const userProfiles = await getUserProfileIds(auth.user.email);
      if (userProfiles.length > 0) {
        const { data: allowedBySubject } = await supabaseServer
          .from('support_subject_permission_profiles')
          .select('profile_id')
          .eq('subject_id', subjectId)
          .in('profile_id', userProfiles);

        const hasAnyMatch = (allowedBySubject || []).length > 0;
        if (!hasAnyMatch) {
          return NextResponse.json({ error: 'Seu perfil nao pode abrir ticket neste assunto.' }, { status: 403 });
        }
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

    const assigneeMap = await buildAvatarMap([String(created.assigned_to_email || '').trim().toLowerCase()]);
    const createdWithAvatar = {
      ...created,
      assigned_to_avatar_url: created.assigned_to_email
        ? (assigneeMap.get(String(created.assigned_to_email).trim().toLowerCase()) ?? null)
        : null,
    };

    return NextResponse.json({
      ok: true,
      ticket: createdWithAvatar,
      createdBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao criar ticket.' }, { status: 500 });
  }
}
