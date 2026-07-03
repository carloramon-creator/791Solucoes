import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const statementId = String(body?.statementId || '');

    if (!statementId) throw new Error('ID da fatura é obrigatório');

    const { data: statementRecord, error: statementError } = await supabaseServer
      .from('system_finance_records')
      .select('id, metadata')
      .eq('id', statementId)
      .maybeSingle();

    if (statementError) throw new Error(statementError.message);
    if (!statementRecord) throw new Error('Fatura não encontrada');

    const metadata = (statementRecord.metadata && typeof statementRecord.metadata === 'object') ? statementRecord.metadata : {};
    const itemIds = Array.isArray(metadata.card_statement_item_ids) ? metadata.card_statement_item_ids.map((value: unknown) => String(value || '')).filter(Boolean) : [];

    if (itemIds.length === 0) {
      throw new Error('Não foi possível localizar os lançamentos compostos desta fatura.');
    }

    const { data: itemRecords, error: itemsError } = await supabaseServer
      .from('system_finance_records')
      .select('id, metadata')
      .in('id', itemIds);

    if (itemsError) throw new Error(itemsError.message);

    for (const itemRecord of itemRecords || []) {
      const itemMetadata = (itemRecord.metadata && typeof itemRecord.metadata === 'object') ? itemRecord.metadata : {};
      const { error: recordUpdateError } = await supabaseServer
        .from('system_finance_records')
        .update({
          metadata: {
            ...itemMetadata,
            card_statement_generated: false,
            card_statement_reference: null,
            card_statement_id: null,
          },
        })
        .eq('id', itemRecord.id);

      if (recordUpdateError) throw new Error(recordUpdateError.message);
    }

    const { error: deleteError } = await supabaseServer
      .from('system_finance_records')
      .delete()
      .eq('id', statementId);

    if (deleteError) throw new Error(deleteError.message);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
