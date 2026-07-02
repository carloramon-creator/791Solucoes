import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getPeriodStart(period: string) {
  const now = new Date();
  const startDate = new Date(now);

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
      startDate.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
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
    default:
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      break;
  }

  return startDate;
}

function getDateFromParam(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Patrocinadores não podem consultar resumo financeiro.');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'mes';
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');
    const section = url.searchParams.get('section') || 'saldo-atual';

    // Calcular datas baseado no período
    const now = new Date();
    const startDate = getDateFromParam(startDateParam, getPeriodStart(period));
    const endDate = getDateFromParam(endDateParam, now);
    const rangeStart = startDate <= endDate ? startDate : endDate;
    const rangeEnd = startDate <= endDate ? endDate : startDate;

    let data: any[] = [];

    if (section === 'saldo-atual') {
      // Buscar saldo de cada conta bancária real da holding
      const { data: bankAccounts, error: accountsError } = await supabaseServer
        .from('system_bank_accounts')
        .select('*')
        .order('bank_name', { ascending: true })
        .order('name', { ascending: true });

      if (accountsError && accountsError.code !== 'PGRST116') {
        console.log('Aviso ao buscar contas bancárias:', accountsError.message);
      }

      if (bankAccounts && bankAccounts.length > 0) {
        data = bankAccounts.map((account: any) => ({
          id: account.id,
          descricao: [account.bank_name, account.name].filter(Boolean).join(' - ') || 'Conta bancária',
          detalhes: [account.agency ? `Ag. ${account.agency}` : null, account.account_number ? `Conta ${account.account_number}` : null]
            .filter(Boolean)
            .join(' | '),
          valor: toNumber(account.balance, 0),
          data_vencimento: account.updated_at,
          atualizado_em: account.updated_at,
        }));
      }

    } else if (section === 'contas-receber') {
      // Buscar receitas pendentes no período
      const { data: records, error: recordsError } = await supabaseServer
        .from('system_finance_records')
        .select('id, type, value, description, category, status, created_at, payment_method, metadata')
        .eq('type', 'revenue')
        .eq('status', 'pending')
        .gte('created_at', rangeStart.toISOString())
        .lte('created_at', rangeEnd.toISOString());

      if (recordsError && recordsError.code !== 'PGRST116') {
        console.log('Aviso ao buscar contas a receber:', recordsError.message);
      }

      data = (records || []).map((record: any) => ({
        id: record.id,
        titulo: record.description,
        descricao: record.category || record.payment_method || 'Receita pendente',
        valor: toNumber(record?.value, 0),
        data_vencimento: record.created_at,
        status: record.status,
        data_emissao: record.created_at,
      }));

    } else if (section === 'contas-pagar') {
      // Buscar despesas pendentes no período
      const { data: records, error: recordsError } = await supabaseServer
        .from('system_finance_records')
        .select('id, type, value, description, category, status, created_at, payment_method, metadata')
        .eq('type', 'expense')
        .eq('status', 'pending')
        .gte('created_at', rangeStart.toISOString())
        .lte('created_at', rangeEnd.toISOString())
        .order('created_at', { ascending: false });

      if (recordsError && recordsError.code !== 'PGRST116') {
        console.log('Aviso ao buscar contas a pagar:', recordsError.message);
      }

      if (records && records.length > 0) {
        data = records.map((record: any) => ({
          id: record.id,
          titulo: record.description,
          descricao: record.category || record.payment_method || 'Despesa pendente',
          valor: toNumber(record.value, 0),
          data_vencimento: record.created_at,
          status: record.status,
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
