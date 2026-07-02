import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

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
      .select('id, protocol, title, description, tenant_slug, priority, status, created_at, due_at, resolved_at')
      .gte('created_at', fromDate.toISOString())
      .lte('created_at', toDate.toISOString())
      .order('created_at', { ascending: false });

    if (ticketsError) {
      return NextResponse.json({ error: ticketsError.message }, { status: 500 });
    }

    let data: any[] = [];

    if (status === 'total') {
      // Todos os tickets do período
      data = (allTickets || []).map((ticket: any) => ({
        id: ticket.id,
        titulo: ticket.title,
        vidracaria: ticket.tenant_slug || 'Sistema',
        data_criacao: ticket.created_at,
        prioridade: ticket.priority,
        status_ticket: ticket.status,
      }));

    } else if (status === 'em-dia') {
      // Tickets onde a data de vencimento não foi ultrapassada
      data = (allTickets || [])
        .filter((ticket: any) => ticket.due_at && new Date(ticket.due_at) >= now && ticket.status !== 'closed' && ticket.status !== 'resolved')
        .map((ticket: any) => ({
          id: ticket.id,
          titulo: ticket.title,
          vidracaria: ticket.tenant_slug || 'Sistema',
          data_criacao: ticket.created_at,
          prioridade: ticket.priority,
          status_ticket: ticket.status,
        }));

    } else if (status === 'atrasados') {
      // Tickets onde a data de vencimento foi ultrapassada e não foram resolvidos
      data = (allTickets || [])
        .filter((ticket: any) => ticket.due_at && new Date(ticket.due_at) < now && ticket.status !== 'closed' && ticket.status !== 'resolved')
        .map((ticket: any) => {
          const diasAtraso = Math.floor((now.getTime() - new Date(ticket.due_at).getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: ticket.id,
            titulo: ticket.title,
            vidracaria: ticket.tenant_slug || 'Sistema',
            data_criacao: ticket.created_at,
            dias_atraso: diasAtraso,
            prioridade: ticket.priority,
            status_ticket: ticket.status,
          };
        });

    } else if (status === 'resolvidos') {
      // Tickets resolvidos
      data = (allTickets || [])
        .filter((ticket: any) => ticket.status === 'closed' || ticket.status === 'resolved')
        .map((ticket: any) => ({
          id: ticket.id,
          titulo: ticket.title,
          vidracaria: ticket.tenant_slug || 'Sistema',
          data_criacao: ticket.created_at,
          data_resolucao: ticket.resolved_at,
          prioridade: ticket.priority,
        }));
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Falha ao carregar tickets.' },
      { status: 500 }
    );
  }
}

