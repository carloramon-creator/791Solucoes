import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function formatTicketStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    new: 'Novo',
    in_progress: 'Em andamento',
    waiting_customer: 'Aguardando cliente',
    resolved: 'Resolvido',
    closed: 'Fechado',
  };
  const normalized = String(status || '').trim();
  return labels[normalized] || normalized || '--';
}

function formatTicketPriorityLabel(priority: string | null | undefined) {
  const labels: Record<string, string> = {
    low: 'Baixa',
    normal: 'Normal',
    high: 'Alta',
    urgent: 'Urgente',
  };
  const normalized = String(priority || '').trim();
  return labels[normalized] || normalized || '--';
}

function formatQueueLabel(status: string) {
  const labels: Record<string, string> = {
    total: 'Total',
    'em-dia': 'Em dia',
    atrasados: 'Atrasados',
    resolvidos: 'Resolvidos',
  };
  return labels[status] || status;
}

function mapTicketSummary(ticket: any, queueLabel: string) {
  const createdAt = String(ticket?.created_at || '');
  const createdDate = createdAt ? new Date(createdAt) : null;
  const sourceName = String(ticket?.tenant_name || ticket?.tenant_slug || '').trim();
  const sourceType = sourceName ? 'Vidracaria' : 'Holding';

  return {
    id: ticket.id,
    protocolo: ticket.protocol,
    assunto: ticket.title,
    vidracaria: sourceName || 'Holding',
    origem: sourceType,
    fila_label: queueLabel,
    usuario: String(ticket?.requester_name || ticket?.requester_email || 'Nao informado'),
    status_ticket: ticket.status,
    status_label: formatTicketStatusLabel(ticket.status),
    prioridade: ticket.priority,
    prioridade_label: formatTicketPriorityLabel(ticket.priority),
    data_criacao: ticket.created_at,
    hora_criacao: createdDate && Number.isFinite(createdDate.getTime())
      ? createdDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '--:--',
    due_at: ticket.due_at,
    data_resolucao: ticket.resolved_at || null,
  };
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores não podem consultar tickets.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'mes';
    const status = url.searchParams.get('status') || 'total';
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');

    const now = new Date();
    const startDate = startDateParam ? new Date(startDateParam) : (() => {
      const date = new Date(now);
      switch (period) {
        case 'dia':
          date.setHours(0, 0, 0, 0);
          break;
        case 'semana':
          date.setDate(now.getDate() - 6);
          date.setHours(0, 0, 0, 0);
          break;
        case 'quinzena':
          date.setDate(now.getDate() - 14);
          date.setHours(0, 0, 0, 0);
          break;
        case 'mes':
          date.setDate(now.getDate() - 29);
          date.setHours(0, 0, 0, 0);
          break;
        case 'trimestre':
          date.setDate(now.getDate() - 89);
          date.setHours(0, 0, 0, 0);
          break;
        case 'semestre':
          date.setDate(now.getDate() - 179);
          date.setHours(0, 0, 0, 0);
          break;
        case 'ano':
          date.setDate(now.getDate() - 364);
          date.setHours(0, 0, 0, 0);
          break;
      }
      return date;
    })();
    const endDate = endDateParam ? new Date(endDateParam) : now;
    const rangeStart = Number.isFinite(startDate.getTime()) ? startDate : new Date(now.getFullYear(), now.getMonth(), 1);
    const rangeEnd = Number.isFinite(endDate.getTime()) ? endDate : now;
    const fromDate = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const toDate = rangeStart <= rangeEnd ? rangeEnd : rangeStart;

    // Buscar todos os tickets do período
    const { data: allTickets, error: ticketsError } = await supabaseServer
      .from('support_tickets')
      .select('id, protocol, title, description, tenant_slug, tenant_name, requester_name, requester_email, priority, status, created_at, due_at, resolved_at')
      .gte('created_at', fromDate.toISOString())
      .lte('created_at', toDate.toISOString())
      .order('created_at', { ascending: false });

    if (ticketsError) {
      return NextResponse.json({ error: ticketsError.message }, { status: 500 });
    }

    let data: any[] = [];
    const queueLabel = formatQueueLabel(status);

    if (status === 'total') {
      // Todos os tickets do período
      data = (allTickets || []).map((ticket: any) => mapTicketSummary(ticket, queueLabel));

    } else if (status === 'em-dia') {
      // Tickets onde a data de vencimento não foi ultrapassada
      data = (allTickets || [])
        .filter((ticket: any) => ticket.due_at && new Date(ticket.due_at) >= now && ticket.status !== 'closed' && ticket.status !== 'resolved')
        .map((ticket: any) => mapTicketSummary(ticket, queueLabel));

    } else if (status === 'atrasados') {
      // Tickets onde a data de vencimento foi ultrapassada e não foram resolvidos
      data = (allTickets || [])
        .filter((ticket: any) => ticket.due_at && new Date(ticket.due_at) < now && ticket.status !== 'closed' && ticket.status !== 'resolved')
        .map((ticket: any) => {
          const diasAtraso = Math.floor((now.getTime() - new Date(ticket.due_at).getTime()) / (1000 * 60 * 60 * 24));
          return {
            ...mapTicketSummary(ticket, queueLabel),
            dias_atraso: diasAtraso,
          };
        });

    } else if (status === 'resolvidos') {
      // Tickets resolvidos
      data = (allTickets || [])
        .filter((ticket: any) => ticket.status === 'closed' || ticket.status === 'resolved')
        .map((ticket: any) => mapTicketSummary(ticket, queueLabel));
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Falha ao carregar tickets.' },
      { status: 500 }
    );
  }
}

