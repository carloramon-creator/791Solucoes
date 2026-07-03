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
    const recordIds = Array.isArray(body?.recordIds) ? body.recordIds.map((value: unknown) => String(value || '')).filter(Boolean) : [];

    if (!cardId) throw new Error('ID do cartão é obrigatório');
    if (recordIds.length === 0) throw new Error('Selecione ao menos um lançamento para fechar a fatura.');

    const { data: card, error: cardError } = await supabaseServer
      .from('system_bank_cards')
      .select('id, account_id, name, card_type, due_day, brand, last_digits, accounts:system_bank_accounts(id, name, bank_name)')
      .eq('id', cardId)
      .single();

    if (cardError || !card) throw new Error(cardError?.message || 'Cartão não encontrado');
    if (!String(card.card_type || '').toLowerCase().includes('credit')) throw new Error('Somente cartões de crédito podem gerar fatura.');

    const { data: paidRecords, error: recordsError } = await supabaseServer
      .from('system_finance_records')
      .select('id, type, value, status, created_at, description, category, metadata')
      .eq('status', 'paid')
      .eq('type', 'expense')
      .contains('metadata', { card_id: cardId })
      .in('id', recordIds);

    if (recordsError) throw new Error(recordsError.message);

    if ((paidRecords || []).length !== recordIds.length) {
      throw new Error('Um ou mais lançamentos selecionados não pertencem a este cartão ou não estão pagos.');
    }

    const alreadyBilled = (paidRecords || []).find((record: any) => record?.metadata?.card_statement_reference);
    if (alreadyBilled) {
      throw new Error('Há lançamentos selecionados que já foram usados em outra fatura.');
    }

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

    const outstandingAmount = Number((paidRecords || []).reduce((sum: number, record: any) => sum + toNumber(record?.value, 0), 0).toFixed(2));
    if (outstandingAmount <= 0) {
      throw new Error('Os lançamentos selecionados não geraram um valor válido de fatura.');
    }

    const account = Array.isArray(card.accounts) ? card.accounts[0] : card.accounts;
    const accountLabel = [account?.bank_name, account?.name].filter(Boolean).join(' - ') || 'Conta vinculada';

    const { data: statementRecord, error: insertError } = await supabaseServer
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
          card_statement_item_ids: recordIds,
          linked_account_name: accountLabel,
        },
      })
      .select('id')
      .single();

    if (insertError) throw new Error(insertError.message);

    for (const record of paidRecords || []) {
      const metadata = (record?.metadata && typeof record.metadata === 'object') ? record.metadata : {};
      const { error: recordUpdateError } = await supabaseServer
        .from('system_finance_records')
        .update({
          metadata: {
            ...metadata,
            card_statement_reference: statementReference,
            card_statement_id: statementRecord?.id || null,
            card_statement_generated: true,
          },
        })
        .eq('id', record.id);

      if (recordUpdateError) {
        throw new Error(recordUpdateError.message);
      }
    }

    return NextResponse.json({ success: true, statementReference, dueDate: dueDate.toISOString(), amount: outstandingAmount, statementId: statementRecord?.id || null });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
