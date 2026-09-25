import { createHash, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getGlassClient } from '@/lib/glass-client';

const ATTACHMENT_BUCKET = 'internal-chat-attachments';
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const VALID_STATUSES = new Set(['available', 'away', 'busy']);

function identityEmail(holdingEmail: string, tenantId: string) {
  const hash = createHash('sha256').update(`${holdingEmail.trim().toLowerCase()}:${tenantId}`).digest('hex').slice(0, 24);
  return `holding-chat-${hash}@support.791glass.invalid`;
}

async function findOrCreateIdentity(glass: Awaited<ReturnType<typeof getGlassClient>>, holdingEmail: string, tenantId: string) {
  const email = identityEmail(holdingEmail, tenantId);
  let page = 1;
  while (page <= 10) {
    const { data, error } = await glass.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const existing = (data.users || []).find((user) => user.email?.toLowerCase() === email);
    if (existing) return existing;
    if ((data.users || []).length < 1000) break;
    page += 1;
  }
  const { data, error } = await glass.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { holding_chat: true, holding_email: holdingEmail, tenant_id: tenantId },
  });
  if (error || !data.user) throw new Error(error?.message || 'Falha ao criar identidade do chat.');
  return data.user;
}

async function isParticipant(glass: Awaited<ReturnType<typeof getGlassClient>>, conversationId: string, userId: string, tenantId: string) {
  const { data } = await glass.from('internal_chat_participants').select('user_id')
    .eq('conversation_id', conversationId).eq('user_id', userId).eq('vidracaria_id', tenantId).maybeSingle();
  return Boolean(data);
}

async function resolveContext(req: Request, tenantId: string) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso ao chat interno nao autorizado.');
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!tenantId || !auth.user.email) return { response: NextResponse.json({ error: 'Tenant ou usuario invalido.' }, { status: 400 }) };
  const glass = await getGlassClient();
  const { data: tenant } = await glass.from('vidracarias').select('id, nome, slug').eq('id', tenantId).maybeSingle();
  if (!tenant) return { response: NextResponse.json({ error: 'Tenant nao encontrado.' }, { status: 404 }) };
  const identity = await findOrCreateIdentity(glass, auth.user.email, tenantId);
  return { auth, glass, tenant, identity };
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const tenantId = String(params.get('tenantId') || '').trim();
    const context = await resolveContext(req, tenantId);
    if ('response' in context) return context.response;
    const { glass, tenant, identity } = context;
    const action = params.get('action') || 'bootstrap';

    if (action === 'messages') {
      const conversationId = String(params.get('conversationId') || '').trim();
      if (!(await isParticipant(glass, conversationId, identity.id, tenantId))) {
        return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
      }
      const { data, error } = await glass.from('internal_chat_messages')
        .select('id, conversation_id, sender_id, body, content_type, created_at, internal_chat_attachments(*)')
        .eq('conversation_id', conversationId).eq('vidracaria_id', tenantId).order('created_at');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const messages = await Promise.all((data || []).map(async (message) => ({
        ...message,
        internal_chat_attachments: await Promise.all((message.internal_chat_attachments || []).map(async (attachment) => {
          const { data: signed } = await glass.storage.from(ATTACHMENT_BUCKET).createSignedUrl(String(attachment.storage_path), 3600);
          return { ...attachment, url: signed?.signedUrl || null };
        })),
      })));
      return NextResponse.json({ messages });
    }

    if (action === 'reminders') {
      const { data, error } = await glass.from('internal_chat_reminders')
        .select('id, conversation_id, texto, lembrar_em, status, criado_por')
        .eq('vidracaria_id', tenantId).eq('destinatario_id', identity.id)
        .in('status', ['pending', 'notified']).lte('lembrar_em', new Date().toISOString()).order('lembrar_em');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ reminders: data || [] });
    }

    const [{ data: users, error: usersError }, { data: conversations, error: conversationsError }, authUsers] = await Promise.all([
      glass.from('user_profiles').select('user_id, nome_exibicao, ativo').eq('vidracaria_id', tenantId).eq('ativo', true).order('nome_exibicao'),
      glass.from('internal_chat_conversations').select('id, titulo, tipo, updated_at, participants:internal_chat_participants(user_id)').eq('vidracaria_id', tenantId).order('updated_at', { ascending: false }),
      glass.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    const firstError = usersError || conversationsError || authUsers.error;
    if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });
    const tenantNameById = new Map((users || []).map((user) => [user.user_id, user.nome_exibicao || 'Usuario do tenant']));
    const ownConversations = (conversations || [])
      .filter((conversation) => (conversation.participants || []).some((participant) => participant.user_id === identity.id))
      .map((conversation) => {
        const otherParticipant = (conversation.participants || []).find((participant) => participant.user_id !== identity.id);
        return { ...conversation, titulo: otherParticipant ? tenantNameById.get(otherParticipant.user_id) || conversation.titulo : conversation.titulo };
      });
    const relevantIds = new Set([identity.id, ...(users || []).map((user) => user.user_id)]);
    const presence = (authUsers.data.users || []).filter((user) => relevantIds.has(user.id)).map((user) => ({
      user_id: user.id,
      status: VALID_STATUSES.has(user.user_metadata?.internal_chat_status) ? user.user_metadata.internal_chat_status : 'available',
      updated_at: user.user_metadata?.internal_chat_status_updated_at || user.updated_at,
    }));
    return NextResponse.json({ tenant, currentUserId: identity.id, users: users || [], conversations: ownConversations, presence });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao carregar chat.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const isMultipart = (req.headers.get('content-type') || '').includes('multipart/form-data');
    const payload = isMultipart ? await req.formData() : await req.json().catch(() => ({}));
    const value = (key: string) => String(isMultipart ? payload.get(key) || '' : payload?.[key] || '').trim();
    const tenantId = value('tenantId');
    const action = value('action');
    const context = await resolveContext(req, tenantId);
    if ('response' in context) return context.response;
    const { glass, identity } = context;

    if (action === 'presence') {
      const status = value('status');
      if (!VALID_STATUSES.has(status)) return NextResponse.json({ error: 'Status invalido.' }, { status: 400 });
      const { error } = await glass.auth.admin.updateUserById(identity.id, {
        user_metadata: {
          ...identity.user_metadata,
          internal_chat_status: status,
          internal_chat_status_updated_at: new Date().toISOString(),
        },
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'start') {
      const recipientId = value('recipientId');
      const { data: recipient } = await glass.from('user_profiles').select('user_id, nome_exibicao')
        .eq('user_id', recipientId).eq('vidracaria_id', tenantId).eq('ativo', true).maybeSingle();
      if (!recipient) return NextResponse.json({ error: 'Usuario nao pertence ao tenant.' }, { status: 403 });
      const { data: conversation, error } = await glass.from('internal_chat_conversations').insert({
        vidracaria_id: tenantId, tipo: 'support', criado_por: identity.id, titulo: recipient.nome_exibicao || 'Conversa',
      }).select('id, titulo, tipo, updated_at').single();
      if (error || !conversation) return NextResponse.json({ error: error?.message || 'Falha ao criar conversa.' }, { status: 500 });
      const { error: participantsError } = await glass.from('internal_chat_participants').insert([
        { conversation_id: conversation.id, vidracaria_id: tenantId, user_id: identity.id },
        { conversation_id: conversation.id, vidracaria_id: tenantId, user_id: recipientId },
      ]);
      if (participantsError) return NextResponse.json({ error: participantsError.message }, { status: 500 });
      return NextResponse.json({ conversation: { ...conversation, participants: [{ user_id: identity.id }, { user_id: recipientId }] } });
    }

    if (action === 'reminder') {
      const conversationId = value('conversationId');
      const recipientId = value('recipientId') || identity.id;
      const text = value('text');
      const remindAt = new Date(value('remindAt'));
      if (!text || !Number.isFinite(remindAt.getTime()) || !(await isParticipant(glass, conversationId, identity.id, tenantId))) {
        return NextResponse.json({ error: 'Lembrete invalido.' }, { status: 400 });
      }
      if (recipientId !== identity.id && !(await isParticipant(glass, conversationId, recipientId, tenantId))) {
        return NextResponse.json({ error: 'Destinatario invalido.' }, { status: 403 });
      }
      const { error } = await glass.from('internal_chat_reminders').insert({ conversation_id: conversationId, vidracaria_id: tenantId, criado_por: identity.id, destinatario_id: recipientId, texto: text, lembrar_em: remindAt.toISOString() });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'reminder-status') {
      const { data, error } = await glass.from('internal_chat_reminders').update({ status: value('status') })
        .eq('id', value('reminderId')).eq('vidracaria_id', tenantId).eq('destinatario_id', identity.id).select('id').maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: 'Lembrete nao encontrado.' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'send') {
      const conversationId = value('conversationId');
      if (!(await isParticipant(glass, conversationId, identity.id, tenantId))) return NextResponse.json({ error: 'Conversa nao encontrada.' }, { status: 404 });
      const messageBody = value('body');
      const entry = isMultipart ? payload.get('attachment') : null;
      const attachment = entry instanceof File && entry.size > 0 ? entry : null;
      if (!messageBody && !attachment) return NextResponse.json({ error: 'Mensagem ou arquivo obrigatorio.' }, { status: 400 });
      if (attachment && attachment.size > MAX_ATTACHMENT_SIZE) return NextResponse.json({ error: 'O arquivo deve ter no maximo 10 MB.' }, { status: 400 });
      const { data: message, error } = await glass.from('internal_chat_messages').insert({ conversation_id: conversationId, vidracaria_id: tenantId, sender_id: identity.id, body: messageBody, content_type: attachment ? 'file' : 'text' }).select('id').single();
      if (error || !message) return NextResponse.json({ error: error?.message || 'Falha ao enviar mensagem.' }, { status: 500 });
      if (attachment) {
        const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const storagePath = `${tenantId}/${conversationId}/${randomUUID()}-${safeName}`;
        const upload = await glass.storage.from(ATTACHMENT_BUCKET).upload(storagePath, Buffer.from(await attachment.arrayBuffer()), { contentType: attachment.type || 'application/octet-stream' });
        if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
        const { error: attachmentError } = await glass.from('internal_chat_attachments').insert({ message_id: message.id, vidracaria_id: tenantId, storage_path: storagePath, file_name: attachment.name, content_type: attachment.type || null, size_bytes: attachment.size });
        if (attachmentError) return NextResponse.json({ error: attachmentError.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao atualizar chat.' }, { status: 500 });
  }
}