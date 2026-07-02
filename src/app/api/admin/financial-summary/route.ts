import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getGlassClient } from '@/lib/glass-client';

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

    let data: any[] = [];

    if (section === 'saldo-atual') {
      // Buscar notas pagas para calcular saldo
      const { data: paidInvoices, error: invoicesError } = await supabaseServer
        .from('system_invoices')
        .select('value')
        .in('status', ['pago', 'authorized']);

      if (invoicesError) {
        return NextResponse.json({ error: invoicesError.message }, { status: 500 });
      }

      let totalSaldo = 0;
      (paidInvoices || []).forEach((inv: any) => {
        totalSaldo += Number(inv?.value || 0);
      });

      data = [
        { 
          id: '1', 
          descricao: 'Saldo Total Acumulado - Notas Pagas',
          valor: totalSaldo,
          data_vencimento: null 
        },
      ];

    } else if (section === 'contas-receber') {
      // Buscar notas fiscais em aberto (pending/authorized mas não pagas)
      const { data: invoices, error: invoicesError } = await supabaseServer
        .from('system_invoices')
        .select('invoice_number, value, created_at, metadata')
        .eq('status', 'pending')
        .gte('created_at', startDate.toISOString());

      if (invoicesError) {
        return NextResponse.json({ error: invoicesError.message }, { status: 500 });
      }

      data = (invoices || []).map((inv: any) => ({
        id: inv.invoice_number,
        descricao: `Nota Fiscal ${inv.invoice_number} - Consultoria`,
        valor: Number(inv?.value || 0),
        data_vencimento: inv?.created_at ? new Date(new Date(inv.created_at).getTime() + 30*24*60*60*1000).toISOString() : null,
        status: 'em_aberto'
      }));

    } else if (section === 'contas-pagar') {
      // Buscar despesas em aberto (essa tabela pode não existir ainda)
      // Por enquanto, retornar vazio, pois não há tabela específica
      data = [
        {
          id: '1',
          descricao: 'Despesa aguardando mapeamento no banco',
          valor: 0,
          data_vencimento: null,
          status: 'em_aberto'
        }
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
