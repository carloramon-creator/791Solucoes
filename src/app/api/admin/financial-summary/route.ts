import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores não podem consultar resumo financeiro.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'mes';
    const section = url.searchParams.get('section') || 'saldo-atual';

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

    if (section === 'saldo-atual') {
      data = [
        { id: '1', descricao: 'Conta Bradesco - Corrente', valor: 5420.80, data_vencimento: null },
        { id: '2', descricao: 'Conta Itaú - Aplicação', valor: 3200.00, data_vencimento: null },
      ];
    } else if (section === 'contas-receber') {
      data = [
        { id: '1', descricao: 'Vidraçaria Juliana - Serviço de instalação', valor: 3500.00, data_vencimento: '2026-07-15', status: 'em_aberto' },
        { id: '2', descricao: 'Test Insert - Consultoria', valor: 2080.00, data_vencimento: '2026-07-10', status: 'em_aberto' },
        { id: '3', descricao: 'Vidraçaria MaySaLu - Produtos diversos', valor: 7000.00, data_vencimento: '2026-07-20', status: 'em_aberto' },
      ];
    } else if (section === 'contas-pagar') {
      data = [
        { id: '1', descricao: 'Fornecedor XYZ - Materiais', valor: 2500.00, data_vencimento: '2026-07-05', status: 'em_aberto' },
        { id: '2', descricao: 'Serviço de hosting - Mensal', valor: 450.00, data_vencimento: '2026-07-01', status: 'em_aberto' },
        { id: '3', descricao: 'Aluguel sala comercial', valor: 5370.00, data_vencimento: '2026-07-01', status: 'em_aberto' },
      ];
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Falha ao carregar resumo financeiro.' },
      { status: 500 }
    );
  }
}
