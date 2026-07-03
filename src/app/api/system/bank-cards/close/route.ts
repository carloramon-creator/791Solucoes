import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getNextDueDate(dueDay: number) {
  const now = new Date();
  const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay, 12, 0, 0, 0);

  if (dueDate <= now) {
    dueDate.setMonth(dueDate.getMonth() + 1);
  }

  return dueDate;
}

function getStatementReference(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const cardId = String(body?.cardId || '');

    if (!cardId) throw new Error('ID do cartão é obrigatório');

    const { data: card, error: cardError } = await supabaseServer
      .from('system_bank_cards')
      .select('id, account_id, name, card_type, due_day, current_balance, brand, last_digits, accounts:system_bank_accounts(id, name, bank_name)')
      .eq('id', cardId)
      .single();

    if (cardError || !card) throw new Error(cardError?.message || 'Cartão não encontrado');
    if (card.card_type !== 'credit') throw new Error('Somente cartões de crédito podem gerar fatura.');

    const { data: paidRecords, error: recordsError } = await supabaseServer
      .from('system_finance_records')
      .select('type, value, status, metadata')
      .eq('status', 'paid')
      .contains('metadata', { card_id: cardId });

    if (recordsError) throw new Error(recordsError.message);

    const signedAdjustments = (paidRecords || []).reduce((sum: number, record: any) => {
      const signed = record?.type === 'revenue' ? toNumber(record?.value, 0) : -toNumber(record?.value, 0);
      return sum + signed;
    }, 0);

    const computedCardBalance = Number((toNumber(card.current_balance, 0) + signedAdjustments).toFixed(2));
    if (computedCardBalance >= 0) {
      throw new Error('Este cartão não possui saldo para fechamento.');
    }
    const outstandingAmount = Math.abs(computedCardBalance);

    const dueDate = getNextDueDate(toNumber(card.due_day, 1));
    const statementReference = getStatementReference(dueDate);

    const { data: existingStatement } = await supabaseServer
      .from('system_finance_records')
      .select('id')
      .eq('status', 'pending')
      .eq('type', 'expense')
      .contains('metadata', { card_id: cardId, card_statement_reference: statementReference })
      .maybeSingle();

    if (existingStatement?.id) {
      throw new Error('Já existe uma fatura pendente para este cartão nesse período.');
    }

    const account = Array.isArray(card.accounts) ? card.accounts[0] : card.accounts;
    const accountLabel = [account?.bank_name, account?.name].filter(Boolean).join(' - ') || 'Conta vinculada';

    const { error: insertError } = await supabaseServer
      .from('system_finance_records')
      .insert({
        type: 'expense',
        value: outstandingAmount,
        description: `Fatura cartão ${card.name} - ${statementReference}`,
        category: 'Cartão de crédito',
        payment_method: 'CartaoCredito',
        status: 'pending',
        bank_account_id: card.account_id,
        created_at: dueDate.toISOString(),
        metadata: {
          card_id: cardId,
          card_name: card.name,
          card_brand: card.brand || null,
          card_last_digits: card.last_digits || null,
          card_statement_reference: statementReference,
          card_statement_generated: true,
          linked_account_name: accountLabel,
        },
      });

    if (insertError) throw new Error(insertError.message);

    const nextCardBalance = Number((toNumber(card.current_balance, 0) - computedCardBalance).toFixed(2));
    const { error: updateError } = await supabaseServer
      .from('system_bank_cards')
      .update({ current_balance: nextCardBalance })
      .eq('id', cardId);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ success: true, statementReference, dueDate: dueDate.toISOString(), amount: outstandingAmount });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
