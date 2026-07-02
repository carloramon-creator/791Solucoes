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

    // Dados mock para demonstração - em produção viriam do banco
    let data: any[] = [];

    if (status === 'total') {
      data = [
        { id: '1', titulo: 'Problema de configuração no sistema', vidracaria: 'Vidraçaria Juliana', data_criacao: '2026-06-28', prioridade: 'alta', status_ticket: 'aberto' },
        { id: '2', titulo: 'Dúvida sobre permissões de usuário', vidracaria: 'Test Insert', data_criacao: '2026-06-25', prioridade: 'média', status_ticket: 'em_progresso' },
        { id: '3', titulo: 'Relatório não está gerando corretamente', vidracaria: 'Vidraçaria MaySaLu', data_criacao: '2026-06-20', prioridade: 'alta', status_ticket: 'em_progresso' },
      ];
    } else if (status === 'em-dia') {
      data = [
        { id: '1', titulo: 'Dúvida sobre backup de dados', vidracaria: 'Vidraçaria Juliana', data_criacao: '2026-06-25', prioridade: 'baixa', status_ticket: 'em_progresso' },
        { id: '2', titulo: 'Integração com sistema externo', vidracaria: 'Test Insert', data_criacao: '2026-06-26', prioridade: 'média', status_ticket: 'em_progresso' },
      ];
    } else if (status === 'atrasados') {
      data = [
        { id: '1', titulo: 'Erro ao gerar nota fiscal eletrônica', vidracaria: 'Vidraçaria MaySaLu', data_criacao: '2026-06-10', dias_atraso: 22, prioridade: 'alta', status_ticket: 'aberto' },
      ];
    } else if (status === 'resolvidos') {
      data = [
        { id: '1', titulo: 'Problema de login com domínio corporativo', vidracaria: 'Vidraçaria Juliana', data_criacao: '2026-05-15', data_resolucao: '2026-05-16', prioridade: 'média' },
        { id: '2', titulo: 'Exportação de relatório lento', vidracaria: 'Test Insert', data_criacao: '2026-05-20', data_resolucao: '2026-05-22', prioridade: 'baixa' },
        { id: '3', titulo: 'Sincronização de dados incorreta', vidracaria: 'Vidraçaria MaySaLu', data_criacao: '2026-05-10', data_resolucao: '2026-05-12', prioridade: 'alta' },
      ];
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Falha ao carregar tickets.' },
      { status: 500 }
    );
  }
}
