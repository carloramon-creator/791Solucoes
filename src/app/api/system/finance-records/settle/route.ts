import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';

type DifferenceHandling = 'adjust' | 'keep_open';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toMetadataObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const recordId = String(body?.recordId || '').trim();
    const paidAmount = toNumber(body?.paidAmount, Number.NaN);
    const bankAccountId = body?.bankAccountId ? String(body.bankAccountId) : null;
    const paymentMethod = body?.paymentMethod ? String(body.paymentMethod) : null;
    const handling: DifferenceHandling = body?.differenceHandling === 'keep_open' ? 'keep_open' : 'adjust';

    if (!recordId) {
      return NextResponse.json({ success: false, error: 'recordId é obrigatório.' }, { status: 400 });
    }

    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return NextResponse.json({ success: false, error: 'Valor pago inválido.' }, { status: 400 });
    }

    const { data: record, error: recordError } = await supabaseServer
      .from('system_finance_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (recordError || !record) {
      return NextResponse.json({ success: false, error: recordError?.message || 'Lançamento não encontrado.' }, { status: 404 });
    }

    if (record.status === 'paid') {
      return NextResponse.json({ success: false, error: 'Este lançamento já está baixado.' }, { status: 400 });
    }

    const originalValue = toNumber(record.value, 0);
    const difference = Number((originalValue - paidAmount).toFixed(2));
    const absDifference = Math.abs(difference);

    if (handling === 'keep_open' && difference <= 0) {
      return NextResponse.json({ success: false, error: 'Para manter diferença em aberto, o valor pago deve ser menor que o lançado.' }, { status: 400 });
    }

    const baseMetadata = toMetadataObject(record.metadata);
    const isInterRecord = baseMetadata.bank_link_provider === 'inter' || baseMetadata.provider === 'inter';
    if (isInterRecord && baseMetadata.bank_tx_id != null) {
      if (typeof baseMetadata.bank_tx_id !== 'string' || !baseMetadata.bank_tx_id.trim()) {
        return NextResponse.json({ success: false, error: 'O vínculo bancário do lançamento é inválido.' }, { status: 409 });
      }
      if (Math.abs(paidAmount * 100 - Math.round(paidAmount * 100)) > 0.000001) {
        return NextResponse.json({ success: false, error: 'Informe o valor pago com até duas casas decimais.' }, { status: 400 });
      }
      const { data, error } = await supabaseServer.rpc('bank_inter_settle_record', {
        p_record_id: recordId,
        p_paid_amount: paidAmount,
        p_bank_account_id: bankAccountId,
        p_payment_method: paymentMethod,
        p_handling: handling,
      });
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.code === 'P0001' ? 409 : 500 });
      }
      if (!isObject(data) || !isObject(data.settledRecord) ||
          data.settledRecord.id !== recordId || data.settledRecord.status !== 'paid' ||
          (data.remainingRecord !== null && !isObject(data.remainingRecord)) ||
          typeof data.bankReviewRequired !== 'boolean' || !isObject(data.meta) ||
          typeof data.meta.originalValue !== 'number' || typeof data.meta.paidAmount !== 'number' ||
          typeof data.meta.difference !== 'number' || data.meta.handling !== handling) {
        throw new Error('O banco retornou uma resposta inválida para a baixa.');
      }
      return NextResponse.json({ success: true, ...data });
    }

    const settledAt = new Date().toISOString();

    const settlementKind = paidAmount > originalValue
      ? 'juros'
      : paidAmount < originalValue
        ? 'desconto'
        : 'sem_diferenca';

    const settledMetadata = {
      ...baseMetadata,
      settlement: {
        settled_at: settledAt,
        original_value: originalValue,
        paid_value: paidAmount,
        difference,
        handling,
        adjustment_kind: settlementKind,
      },
    };

    const updatePayload: Record<string, unknown> = {
      status: 'paid',
      value: paidAmount,
      metadata: settledMetadata,
    };

    if (bankAccountId) {
      updatePayload.bank_account_id = bankAccountId;
    }

    if (paymentMethod) {
      updatePayload.payment_method = paymentMethod;
    }

    const { data: settledRecord, error: updateError } = await supabaseServer
      .from('system_finance_records')
      .update(updatePayload)
      .eq('id', recordId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    let remainingRecord: Record<string, unknown> | null = null;
    if (handling === 'keep_open' && absDifference > 0) {
      const remainingPayload = {
        type: record.type,
        value: absDifference,
        description: `${record.description} - Saldo em aberto`,
        category: record.category,
        payment_method: paymentMethod || record.payment_method,
        bank_account_id: bankAccountId || record.bank_account_id,
        status: 'pending',
        created_at: settledAt,
        is_recurring: false,
        recurring_period: null,
        metadata: {
          ...baseMetadata,
          settlement_parent_id: record.id,
          settlement_generated_at: settledAt,
          settlement_generated_value: absDifference,
        },
      };

      const { data: createdRemaining, error: insertError } = await supabaseServer
        .from('system_finance_records')
        .insert([remainingPayload])
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
      }

      remainingRecord = createdRemaining;
    }

    return NextResponse.json({
      success: true,
      settledRecord,
      remainingRecord,
      bankReviewRequired: false,
      meta: {
        originalValue,
        paidAmount,
        difference,
        handling,
      },
    });
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
      ? err.message
      : 'Falha ao baixar lançamento.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
