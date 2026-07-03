import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getUserSubjectIds } from '@/lib/holding-permissions';
import {
  DONE_STATUSES,
  OPEN_STATUSES,
  parseSupportQueue,
  parseTicketStatus,
  type SupportQueue,
} from '@/lib/support-queue';
import { randomUUID } from 'crypto';

const AVATAR_BUCKET = 'equipe-avatars';
const ATTACHMENT_BUCKET = 'support-ticket-attachments';

async function resolveDueAtByPriority(priority: string): Promise<string | null> {
  const normalizedPriority = String(priority || 'normal').trim().toLowerCase();

  const { data } = await supabaseServer
    .from('support_ticket_priority_sla')
    .select('response_minutes, active')
    .eq('priority', normalizedPriority)
    .maybeSingle();

  const minutes = Number((data as any)?.response_minutes || 0);
  const active = Boolean((data as any)?.active);
  if (!active || !Number.isFinite(minutes) || minutes <= 0) return null;

  const due = new Date(Date.now() + minutes * 60 * 1000);
  return due.toISOString();
}

function isAllowedAttachment(file: File) {
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type.startsWith('video/')) return true;
  if (type === 'application/pdf') return true;
  return false;
}

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
    return query
      .in('status', OPEN_STATUSES)
      .or(`assigned_to_email.eq.${currentEmail.toLowerCase()},created_by_email.eq.${currentEmail.toLowerCase()}`);
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

async function pickLeastBusyAssignee(subjectId: string): Promise<string | null> {
  const candidateEmails = new Set<string>();

  const { data: directAssignments } = await supabaseServer
    .from('support_subject_assignments')
    .select('assignee_email')
    .eq('subject_id', subjectId);

  for (const row of directAssignments || []) {
    const email = String(row.assignee_email || '').trim().toLowerCase();
    if (email) candidateEmails.add(email);
  }

  const { data: profileLinks } = await supabaseServer
    .from('support_subject_permission_profiles')
    .select('profile_id')
    .eq('subject_id', subjectId);

  const profileIds = Array.from(new Set((profileLinks || []).map((row: any) => String(row.profile_id || '').trim()).filter(Boolean)));

  if (profileIds.length > 0) {
    const { data: usersByProfile } = await supabaseServer
      .from('holding_user_permission_profiles')
      .select('user_email')
      .in('profile_id', profileIds);

    for (const row of usersByProfile || []) {
      const email = String((row as any).user_email || '').trim().toLowerCase();
      if (email) candidateEmails.add(email);
    }

    const { data: profileRows } = await supabaseServer
      .from('holding_permission_profiles')
      .select('name')
      .in('id', profileIds);

    const profileNames = Array.from(new Set((profileRows || []).map((row: any) => String(row.name || '').trim()).filter(Boolean)));

    let usersByCargo: any[] = [];
    if (profileNames.length > 0) {
      const { data } = await supabaseServer
        .from('equipe_791')
        .select('email, cargo')
        .in('cargo', profileNames);

      usersByCargo = data || [];
    }

    for (const row of usersByCargo || []) {
      const email = String((row as any).email || '').trim().toLowerCase();
      if (email) candidateEmails.add(email);
    }
  }

  const candidates = Array.from(candidateEmails).filter(Boolean);
  if (candidates.length === 0) return null;

  const counts = await Promise.all(candidates.map(async (email) => {
    const { count } = await supabaseServer
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to_email', email)
      .in('status', OPEN_STATUSES);

    return { email, activeCount: count || 0 };
  }));

  counts.sort((a, b) => {
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    return a.email.localeCompare(b.email);
  });

  return counts[0]?.email || null;
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
    const contentType = req.headers.get('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');
    const body = isMultipart ? await req.formData() : await req.json();

    const readValue = (key: string) => {
      if (isMultipart) return body.get(key);
      return (body as any)?.[key];
    };

    const tenantSlug = String(readValue('tenantSlug') || '').trim();
    const tenantNameValue = readValue('tenantName');
    const tenantName = tenantNameValue ? String(tenantNameValue).trim() : null;
    const tenantIdValue = readValue('tenantId');
    const tenantId = tenantIdValue ? String(tenantIdValue).trim() : null;
    const title = String(readValue('title') || '').trim();
    const description = String(readValue('description') || '').trim();
    const subjectIdValue = readValue('subjectId');
    const subjectId = subjectIdValue ? String(subjectIdValue).trim() : null;

    if (!tenantSlug) {
      return NextResponse.json({ error: 'tenantSlug e obrigatorio.' }, { status: 400 });
    }

    if (!title || !description) {
      return NextResponse.json({ error: 'Titulo e descricao sao obrigatorios.' }, { status: 400 });
    }

    const requesterNameValue = readValue('requesterName');
    const requesterEmailValue = readValue('requesterEmail');
    const requesterPhoneValue = readValue('requesterPhone');

    const requesterName = requesterNameValue ? String(requesterNameValue).trim() : auth.user.email || null;
    const requesterEmail = requesterEmailValue ? String(requesterEmailValue).trim().toLowerCase() : auth.user.email ? String(auth.user.email).trim().toLowerCase() : null;
    const requesterPhone = requesterPhoneValue ? String(requesterPhoneValue).trim() : null;

    const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
    const priorityValue = String(readValue('priority') || 'normal');
    const priority = allowedPriorities.has(priorityValue)
      ? priorityValue
      : 'normal';

    const allowedStatuses = new Set(['new', 'in_progress', 'waiting_customer', 'resolved', 'closed']);
    const statusValue = String(readValue('status') || 'new');
    const status = allowedStatuses.has(statusValue)
      ? statusValue
      : 'new';

    const assignedToEmailValue = readValue('assignedToEmail');
    let assignedToEmail = assignedToEmailValue
      ? String(assignedToEmailValue).trim().toLowerCase()
      : null;

    if (!assignedToEmail && subjectId) {
      assignedToEmail = await pickLeastBusyAssignee(subjectId);
    }

    if (subjectId) {
      const allowedSubjectIds = await getUserSubjectIds(auth.user.email);
      if (allowedSubjectIds !== null && !allowedSubjectIds.includes(subjectId)) {
        return NextResponse.json({ error: 'Seu perfil nao pode abrir ticket neste assunto.' }, { status: 403 });
      }
    }

    const dueAtValue = readValue('dueAt');
    const dueAt = dueAtValue
      ? new Date(String(dueAtValue)).toISOString()
      : await resolveDueAtByPriority(priority);

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

    const firstMessageOrigin = String(readValue('messageOrigin') || '') === 'tenant' ? 'tenant' : 'holding';
    const firstMessageAuthorNameValue = readValue('messageAuthorName');
    const firstMessageAuthorName = firstMessageAuthorNameValue ? String(firstMessageAuthorNameValue).trim() : null;

    const attachmentEntry = isMultipart ? body.get('attachment') : null;
    const attachmentFile = attachmentEntry instanceof File && attachmentEntry.size > 0 ? attachmentEntry : null;

    const attachmentData: Record<string, unknown> = {};
    if (attachmentFile) {
      if (!isAllowedAttachment(attachmentFile)) {
        return NextResponse.json({ error: 'Anexo invalido. Envie imagem, PDF ou video.' }, { status: 400 });
      }

      if (attachmentFile.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: 'O anexo deve ter no maximo 25MB.' }, { status: 400 });
      }

      const safeName = attachmentFile.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const filePath = `support-ticket-attachments/${created.id}/${randomUUID()}-${safeName}`;
      const uploadPayload = Buffer.from(await attachmentFile.arrayBuffer());

      const { error: uploadError } = await supabaseServer.storage
        .from(ATTACHMENT_BUCKET)
        .upload(filePath, uploadPayload, {
          contentType: attachmentFile.type || 'application/octet-stream',
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json({ error: uploadError.message || 'Falha ao enviar anexo do ticket.' }, { status: 500 });
      }

      attachmentData.attachment_file_name = attachmentFile.name;
      attachmentData.attachment_path = filePath;
      attachmentData.attachment_content_type = attachmentFile.type || null;
      attachmentData.attachment_size_bytes = attachmentFile.size;
    }

    const { error: messageError } = await supabaseServer
      .from('support_ticket_messages')
      .insert({
        ticket_id: created.id,
        origin: firstMessageOrigin,
        author_email: requesterEmail || auth.user.email,
        author_name: firstMessageAuthorName,
        message: description,
        is_internal: false,
        ...attachmentData,
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
