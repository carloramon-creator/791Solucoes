import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

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
    .select('id, ticket_id, origin, author_email, author_name, message, is_internal, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message || 'Falha ao carregar mensagens.' }, { status: 500 });
  }

  return NextResponse.json({
    total: (data || []).length,
    messages: data || [],
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
    const body = await req.json();
    const message = String(body?.message || '').trim();
    const origin = body?.origin === 'tenant' || body?.origin === 'system' ? body.origin : 'holding';
    const isInternal = Boolean(body?.isInternal);

    if (!message) {
      return NextResponse.json({ error: 'Mensagem obrigatoria.' }, { status: 400 });
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

    const { data: created, error: createError } = await supabaseServer
      .from('support_ticket_messages')
      .insert({
        ticket_id: ticketId,
        origin,
        author_email: authorEmail,
        author_name: authorName,
        message,
        is_internal: isInternal,
      })
      .select('id, ticket_id, origin, author_email, author_name, message, is_internal, created_at')
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

    return NextResponse.json({
      ok: true,
      message: created,
      sentBy: auth.user.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao enviar mensagem.' }, { status: 500 });
  }
}
