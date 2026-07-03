import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatCurrencyLabel(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(toNumber(value, 0));
}

function getPeriodStart(period: string) {
  const now = new Date();
  const startDate = new Date(now);

  switch (period) {
    case 'dia':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'semana':
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'quinzena':
      startDate.setDate(now.getDate() - 14);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'mes':
      startDate.setDate(now.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'trimestre':
      startDate.setDate(now.getDate() - 89);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'semestre':
      startDate.setDate(now.getDate() - 179);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'ano':
      startDate.setDate(now.getDate() - 364);
      startDate.setHours(0, 0, 0, 0);
      break;
    default:
      startDate.setDate(now.getDate() - 29);
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

function isCurrentAccountType(type: unknown) {
  return String(type || '').toLowerCase().includes('corrente');
}

function getCardSpentAmount(cardId: string, records: any[]) {
  return (records || []).reduce((sum, record: any) => {
    const metadata = (record?.metadata && typeof record.metadata === 'object') ? record.metadata : {};
    const recordCardId = metadata?.card_id ? String(metadata.card_id) : '';

    if (recordCardId !== cardId) return sum;
    if (String(record?.type || '') !== 'expense') return sum;

    const cardStatementReference = String(metadata?.card_statement_reference || '');
    const cardStatementGenerated = Boolean(metadata?.card_statement_generated);
    const recordValue = toNumber(record?.value, 0);

    if (record?.status === 'paid' && !cardStatementReference) {
      return sum + recordValue;
    }

    if (record?.status === 'pending' && cardStatementGenerated) {
      return sum + recordValue;
    }

    return sum;
  }, 0);
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
      // Buscar contas com cartões vinculados
      const { data: bankAccounts, error: accountsError } = await supabaseServer
        .from('system_bank_accounts')
        .select('*, cards:system_bank_cards(*)')
        .order('bank_name', { ascending: true })
        .order('name', { ascending: true });

      if (accountsError && accountsError.code !== 'PGRST116') {
        console.log('Aviso ao buscar contas bancárias:', accountsError.message);
      }

      // Carrega lançamentos para saldo atual e apuração de limite disponível dos cartões.
      const { data: financeRecords, error: financeRecordsError } = await supabaseServer
        .from('system_finance_records')
        .select('type, value, status, bank_account_id, metadata');

      if (financeRecordsError && financeRecordsError.code !== 'PGRST116') {
        console.log('Aviso ao buscar lançamentos financeiros:', financeRecordsError.message);
      }

      const accountAdjustments = new Map<string, number>();

      (financeRecords || []).forEach((record: any) => {
        if (record?.status !== 'paid') return;

        const signed = record?.type === 'revenue' ? toNumber(record?.value, 0) : -toNumber(record?.value, 0);
        const metadata = (record?.metadata && typeof record.metadata === 'object') ? record.metadata : {};
        const cardId = metadata?.card_id ? String(metadata.card_id) : '';
        const accountId = record?.bank_account_id ? String(record.bank_account_id) : '';

        if (cardId) {
          return;
        }

        if (accountId) {
          accountAdjustments.set(accountId, toNumber(accountAdjustments.get(accountId), 0) + signed);
        }
      });

      if (bankAccounts && bankAccounts.length > 0) {
        const entries: any[] = [];
        let totalAccounts = 0;
        let totalCards = 0;

        entries.push({
          id: 'grupo-contas',
          tipo: 'section',
          descricao: 'Contas correntes',
        });

        bankAccounts.forEach((account: any) => {
          const accountCurrentBalance = toNumber(account.balance, 0) + toNumber(accountAdjustments.get(account.id), 0);
          const overdraftLimit = toNumber(account.overdraft_limit, 0);
          const overdraftRemaining = accountCurrentBalance < 0
            ? Math.max(overdraftLimit - Math.abs(accountCurrentBalance), 0)
            : overdraftLimit;

          if (isCurrentAccountType(account.type)) {
            totalAccounts += accountCurrentBalance;
          }

          entries.push({
            id: account.id,
            tipo: 'conta',
            descricao: [account.bank_name, account.name].filter(Boolean).join(' - ') || 'Conta bancária',
            detalhes: [
              account.agency ? `Ag. ${account.agency}` : null,
              account.account_number ? `Conta ${account.account_number}` : null,
              overdraftLimit > 0 ? `Cheque especial ${formatCurrencyLabel(overdraftLimit)}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
            valor: accountCurrentBalance,
            overdraft_available_label: overdraftLimit > 0 ? `Limite disponível ${formatCurrencyLabel(overdraftRemaining)}` : null,
            data_vencimento: account.updated_at,
            atualizado_em: account.updated_at,
          });
        });

        entries.push({
          id: 'grupo-cartoes',
          tipo: 'section',
          descricao: 'Cartões',
        });

        bankAccounts.forEach((account: any) => {
          (account.cards || []).forEach((card: any) => {
            const cardId = String(card.id || '');
            const cardType = String(card.card_type || '').toLowerCase();
            const spentAmount = getCardSpentAmount(cardId, financeRecords || []);
            const availableLimit = toNumber(card.credit_limit, 0) - spentAmount;
            const displayedValue = cardType.includes('credit')
              ? availableLimit
              : toNumber(card.current_balance, 0);

            totalCards += displayedValue;

            entries.push({
              id: card.id,
              tipo: 'cartao',
              descricao: [account.bank_name, card.name].filter(Boolean).join(' - ') || 'Cartão',
              detalhes: [
                card.card_type ? `Tipo ${String(card.card_type).toUpperCase()}` : null,
                card.last_digits ? `•••• ${card.last_digits}` : null,
                card.credit_limit ? `Limite ${formatCurrencyLabel(toNumber(card.credit_limit, 0))}` : null,
              ]
                .filter(Boolean)
                .join(' | '),
              valor: displayedValue,
              data_vencimento: account.updated_at,
              atualizado_em: account.updated_at,
            });
          });
        });

        entries.push({
          id: 'total-contas',
          tipo: 'total',
          descricao: 'Total de contas',
          valor: totalAccounts,
        });

        entries.push({
          id: 'total-cartoes',
          tipo: 'total',
          descricao: 'Total de cartões',
          valor: totalCards,
        });

        entries.push({
          id: 'total-geral',
          tipo: 'total',
          descricao: 'Total geral',
          valor: totalAccounts + totalCards,
        });

        data = entries;
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
