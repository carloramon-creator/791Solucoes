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

    // Calcular datas baseado no período
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case 'dia':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'semana':
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'quinzena':
        startDate.setDate(now.getDate() > 15 ? 16 : 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'mes':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'trimestre':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate.setMonth(quarter * 3, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'semestre':
        startDate.setMonth(now.getMonth() >= 6 ? 6 : 0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'ano':
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }

    // Buscar todos os tickets do período
    const { data: allTickets, error: ticketsError } = await supabaseServer
      .from('support_tickets')
      .select('id, protocol, title, description, tenant_slug, priority, status, created_at, due_at, resolved_at')
      .gte('created_at', startDate.toISOString())
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

