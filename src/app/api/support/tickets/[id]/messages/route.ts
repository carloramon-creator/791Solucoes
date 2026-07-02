import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { randomUUID } from 'crypto';

const AVATAR_BUCKET = 'equipe-avatars';
const ATTACHMENT_BUCKET = 'support-ticket-attachments';

async function withAuthorAvatar(messages: any[]) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const emails = Array.from(new Set(messages
    .map((msg) => String(msg.author_email || '').trim().toLowerCase())
    .filter(Boolean)));

  if (emails.length === 0) {
    return messages.map((msg) => ({ ...msg, author_avatar_url: null }));
  }

  const { data: members } = await supabaseServer
    .from('equipe_791')
    .select('email, foto_path')
    .in('email', emails);

  const avatarByEmail = new Map<string, string | null>();

  for (const row of members || []) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) continue;

    const fotoPath = row.foto_path ? String(row.foto_path).trim() : '';
    if (!fotoPath) {
      avatarByEmail.set(email, null);
      continue;
    }

    const { data: signedAvatar } = await supabaseServer.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(fotoPath, 60 * 60);

    avatarByEmail.set(email, signedAvatar?.signedUrl || null);
  }

  return messages.map((msg) => {
    const email = String(msg.author_email || '').trim().toLowerCase();
    return {
      ...msg,
      author_avatar_url: email ? (avatarByEmail.get(email) ?? null) : null,
    };
  });
}

async function withAttachmentUrl(messages: any[]) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const paths = Array.from(new Set(messages
    .map((msg) => String(msg.attachment_path || '').trim())
    .filter(Boolean)));

  if (paths.length === 0) {
    return messages.map((msg) => ({ ...msg, attachment_url: null }));
  }

  const attachmentByPath = new Map<string, string | null>();

  for (const path of paths) {
    const { data: signedAttachment } = await supabaseServer.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(path, 60 * 60);

    attachmentByPath.set(path, signedAttachment?.signedUrl || null);
  }

  return messages.map((msg) => {
    const path = String(msg.attachment_path || '').trim();
    return {
      ...msg,
      attachment_url: path ? (attachmentByPath.get(path) ?? null) : null,
    };
  });
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem visualizar mensagens do ticket.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const ticketId = String(id || '').trim();

  if (!ticketId) {
    return NextResponse.json({ error: 'ID do ticket invalido.' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('support_ticket_messages')
    .select('id, ticket_id, origin, author_email, author_name, message, is_internal, attachment_file_name, attachment_path, attachment_content_type, attachment_size_bytes, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message || 'Falha ao carregar mensagens.' }, { status: 500 });
  }

  const messages = await withAttachmentUrl(await withAuthorAvatar(data || []));

  return NextResponse.json({
    total: (data || []).length,
    messages,
  });
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem enviar mensagens no ticket.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  const ticketId = String(id || '').trim();

  if (!ticketId) {
    return NextResponse.json({ error: 'ID do ticket invalido.' }, { status: 400 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');
    const body = isMultipart ? await req.formData() : await req.json();
    const message = String((isMultipart ? body.get('message') : body?.message) || '').trim();
    const originValue = isMultipart ? body.get('origin') : body?.origin;
    const origin = originValue === 'tenant' || originValue === 'system' ? originValue : 'holding';
    const isInternalValue = isMultipart ? body.get('isInternal') : body?.isInternal;
    const isInternal = isInternalValue === true || isInternalValue === 'true' || isInternalValue === '1';
    const attachmentEntry = isMultipart ? body.get('attachment') : null;
    const attachmentFile = attachmentEntry instanceof File && attachmentEntry.size > 0 ? attachmentEntry : null;

    if (!message && !attachmentFile) {
      return NextResponse.json({ error: 'Mensagem ou anexo obrigatorio.' }, { status: 400 });
    }

    if (attachmentFile && !String(attachmentFile.type || '').startsWith('image/')) {
      return NextResponse.json({ error: 'Apenas imagens sao permitidas nos anexos.' }, { status: 400 });
    }

    if (attachmentFile && attachmentFile.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'O anexo deve ter no maximo 10MB.' }, { status: 400 });
    }

    const { data: currentTicket, error: ticketError } = await supabaseServer
      .from('support_tickets')
      .select('id, status, first_response_at, resolved_at')
      .eq('id', ticketId)
      .single();

    if (ticketError || !currentTicket) {
      return NextResponse.json({ error: ticketError?.message || 'Ticket nao encontrado.' }, { status: 404 });
    }

    const authorEmail = body?.authorEmail
      ? String(body.authorEmail).trim().toLowerCase()
      : auth.user.email?.toLowerCase() || null;

    const authorName = body?.authorName ? String(body.authorName).trim() : null;

    const attachmentData: Record<string, unknown> = {};
    if (attachmentFile) {
      const safeName = attachmentFile.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const filePath = `support-ticket-attachments/${ticketId}/${randomUUID()}-${safeName}`;
      const uploadPayload = Buffer.from(await attachmentFile.arrayBuffer());

      const { error: uploadError } = await supabaseServer.storage
        .from(ATTACHMENT_BUCKET)
        .upload(filePath, uploadPayload, {
          contentType: attachmentFile.type || 'image/png',
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json({ error: uploadError.message || 'Falha ao enviar anexo.' }, { status: 500 });
      }

      attachmentData.attachment_file_name = attachmentFile.name;
      attachmentData.attachment_path = filePath;
      attachmentData.attachment_content_type = attachmentFile.type || null;
      attachmentData.attachment_size_bytes = attachmentFile.size;
    }

    const { data: created, error: createError } = await supabaseServer
      .from('support_ticket_messages')
      .insert({
        ticket_id: ticketId,
        origin,
        author_email: authorEmail,
        author_name: authorName,
        message: message || 'Arquivo anexado',
        is_internal: isInternal,
        ...attachmentData,
      })
      .select('id, ticket_id, origin, author_email, author_name, message, is_internal, attachment_file_name, attachment_path, attachment_content_type, attachment_size_bytes, created_at')
      .single();

    if (createError || !created) {
      return NextResponse.json({ error: createError?.message || 'Falha ao enviar mensagem.' }, { status: 500 });
    }

    const ticketUpdate: Record<string, unknown> = {};

    if (origin === 'holding') {
      if (!currentTicket.first_response_at) {
        ticketUpdate.first_response_at = new Date().toISOString();
      }
      if (currentTicket.status === 'new' || currentTicket.status === 'in_progress') {
        ticketUpdate.status = 'waiting_customer';
      }
    } else if (origin === 'tenant') {
      if (['waiting_customer', 'resolved', 'closed'].includes(currentTicket.status)) {
        ticketUpdate.status = 'in_progress';
      }
      if (currentTicket.resolved_at) {
        ticketUpdate.resolved_at = null;
      }
    }

    if (Object.keys(ticketUpdate).length > 0) {
      await supabaseServer
        .from('support_tickets')
        .update(ticketUpdate)
        .eq('id', ticketId);
    }

    const messagesWithAvatar = await withAttachmentUrl(await withAuthorAvatar([created]));

    return NextResponse.json({
      ok: true,
      message: messagesWithAvatar[0] || created,
      sentBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao enviar mensagem.' }, { status: 500 });
  }
}
