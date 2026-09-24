import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';

const INVESTIGATE_TENANT_PERMISSION = 'action.support.investigate_tenant';
const SESSION_TTL_MINUTES = 30;

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores nao podem investigar tenants.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const allowed = await userCanAccessResource(auth.user.email, INVESTIGATE_TENANT_PERMISSION);
  if (!allowed) {
    return NextResponse.json({ error: 'Sem permissao para investigar o tenant deste ticket.' }, { status: 403 });
  }

  const { id } = await context.params;
  const ticketId = String(id || '').trim();
  if (!ticketId) {
    return NextResponse.json({ error: 'ID do ticket invalido.' }, { status: 400 });
  }

  const { data: ticket, error: ticketError } = await supabaseServer
    .from('support_tickets')
    .select('id, protocol, tenant_id, tenant_slug, tenant_name')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json({ error: ticketError?.message || 'Ticket nao encontrado.' }, { status: 404 });
  }

  const tenantSlug = String(ticket.tenant_slug || '').trim();
  if (!tenantSlug) {
    return NextResponse.json({ error: 'O ticket nao possui tenant vinculado.' }, { status: 422 });
  }

  const openedAt = new Date();
  const expiresAt = new Date(openedAt.getTime() + SESSION_TTL_MINUTES * 60 * 1000);
  const investigatorEmail = String(auth.user.email || '').trim().toLowerCase();

  const { data: investigation, error: investigationError } = await supabaseServer
    .from('support_tenant_investigations')
    .insert({
      ticket_id: ticket.id,
      tenant_id: ticket.tenant_id ? String(ticket.tenant_id) : null,
      tenant_slug: tenantSlug,
      investigator_email: investigatorEmail,
      opened_at: openedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select('id, opened_at, expires_at')
    .single();

  if (investigationError || !investigation) {
    return NextResponse.json({ error: investigationError?.message || 'Falha ao registrar a investigacao.' }, { status: 500 });
  }

  await supabaseServer.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    origin: 'system',
    author_email: investigatorEmail || null,
    message: `Ato: Investigacao do tenant iniciada por ${investigatorEmail || 'usuario da Holding'}.`,
    is_internal: true,
  });

  return NextResponse.json({
    ok: true,
    investigation: {
      id: investigation.id,
      ticketId: ticket.id,
      protocol: ticket.protocol,
      tenantName: ticket.tenant_name || tenantSlug,
      expiresAt: investigation.expires_at,
    },
  });
}