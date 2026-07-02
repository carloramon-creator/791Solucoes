import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

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
      // Buscar saldo de cada conta bancária
      const { data: bankAccounts, error: accountsError } = await supabaseServer
        .from('bank_accounts')
        .select('id, bank_name, account_number, balance, updated_at')
        .eq('active', true);

      if (accountsError && accountsError.code !== 'PGRST116') {
        // PGRST116 = tabela não existe, que é aceitável
        console.log('Aviso ao buscar contas bancárias:', accountsError.message);
      }

      if (bankAccounts && bankAccounts.length > 0) {
        data = bankAccounts.map((account: any) => ({
          id: account.id,
          descricao: `${account.bank_name} - Conta ${account.account_number}`,
          valor: toNumber(account.balance, 0),
          data_vencimento: null,
          atualizado_em: account.updated_at,
        }));
      } else {
        // Se não existir tabela de contas bancárias, buscar do histórico de notas pagas
        const { data: paidInvoices } = await supabaseServer
          .from('system_invoices')
          .select('value, status, created_at')
          .in('status', ['pago', 'authorized'])
          .order('created_at', { ascending: false });

        let totalSaldo = 0;
        (paidInvoices || []).forEach((inv: any) => {
          totalSaldo += toNumber(inv?.value, 0);
        });

        data = [
          {
            id: '1',
            descricao: 'Saldo Total Acumulado (Notas Pagas)',
            valor: totalSaldo,
            data_vencimento: null,
          },
        ];
      }

    } else if (section === 'contas-receber') {
      // Buscar notas fiscais pendentes (não pagas) no período
      const { data: invoices, error: invoicesError } = await supabaseServer
        .from('system_invoices')
        .select('invoice_number, value, created_at, metadata')
        .eq('status', 'pending')
        .gte('created_at', startDate.toISOString());

      if (invoicesError) {
        console.log('Aviso ao buscar contas a receber:', invoicesError.message);
      }

      data = (invoices || []).map((inv: any) => ({
        id: inv.invoice_number,
        descricao: `Nota Fiscal ${inv.invoice_number}`,
        valor: toNumber(inv?.value, 0),
        data_vencimento: inv?.created_at ? new Date(new Date(inv.created_at).getTime() + 30*24*60*60*1000).toISOString() : null,
        status: 'em_aberto',
        data_emissao: inv?.created_at,
      }));

    } else if (section === 'contas-pagar') {
      // Buscar despesas pendentes no período
      const { data: expenses, error: expensesError } = await supabaseServer
        .from('expenses')
        .select('id, description, amount, due_date, status')
        .eq('status', 'pending')
        .gte('due_date', startDate.toISOString())
        .order('due_date');

      if (expensesError && expensesError.code !== 'PGRST116') {
        console.log('Aviso ao buscar contas a pagar:', expensesError.message);
      }

      if (expenses && expenses.length > 0) {
        data = expenses.map((exp: any) => ({
          id: exp.id,
          descricao: exp.description,
          valor: toNumber(exp.amount, 0),
          data_vencimento: exp.due_date,
          status: exp.status,
        }));
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Falha ao carregar resumo financeiro.' },
      { status: 500 }
    );
  }
}
