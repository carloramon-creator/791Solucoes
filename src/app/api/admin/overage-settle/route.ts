import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getGlassClient } from '@/lib/glass-client';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { restoreWhatsappModulesIfNeeded } from '@/lib/overage-whatsapp';
import { AsaasClient } from '@/services/asaas-service';
import { emitirNFeExcedentePago } from '@/services/payment-processor';

const OVERAGE_SETTLE_PERMISSION = 'menu.financeiro';

type SettleMode = 'received' | 'waived';

type Metadata = Record<string, unknown>;

const metadataOf = (value: unknown): Metadata =>
  value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Metadata) } : {};

const PAID_ASAAS_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);

function asaasErrorMessage(err: unknown) {
  const data = (err as { response?: { data?: { errors?: Array<{ description?: string }> } } })?.response?.data;
  return data?.errors?.[0]?.description || (err instanceof Error ? err.message : 'Falha na comunicação com o Asaas.');
}

function asaasStatusCode(err: unknown) {
  return Number((err as { response?: { status?: number } })?.response?.status || 0);
}

function todayBrt() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Baixa manual de cobrança de excedente do 791glass, para qualquer tenant.
 * - received: recebido por fora (Pix/transferência). Baixa o boleto no Asaas como recebido em dinheiro e emite a NFS-e.
 * - waived: abono. Cancela o boleto no Asaas, sem receita e sem NFS-e.
 * Nos dois casos o WhatsApp bloqueado por essa cobrança é reativado.
 */
export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (!(await userCanAccessResource(auth.user.email, OVERAGE_SETTLE_PERMISSION))) {
    return NextResponse.json({ success: false, error: 'Sem permissão para dar baixa em cobranças.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }

  const recordId = String(body?.recordId || '').trim();
  const mode = body?.mode as SettleMode;
  const note = String(body?.note || '').trim().slice(0, 500) || null;
  const bankAccountId = body?.bankAccountId ? String(body.bankAccountId) : null;
  const paymentMethod = body?.paymentMethod ? String(body.paymentMethod) : null;

  if (!recordId) return NextResponse.json({ success: false, error: 'Cobrança não informada.' }, { status: 400 });
  if (mode !== 'received' && mode !== 'waived') {
    return NextResponse.json({ success: false, error: 'Modalidade de baixa inválida.' }, { status: 400 });
  }

  const { data: record, error: recordError } = await supabaseServer
    .from('system_finance_records')
    .select('id, status, value, description, metadata')
    .eq('id', recordId)
    .single();

  if (recordError || !record) {
    return NextResponse.json({ success: false, error: 'Cobrança não encontrada.' }, { status: 404 });
  }

  const originalMetadata = metadataOf(record.metadata);
  if (originalMetadata.kind !== 'overage') {
    return NextResponse.json({ success: false, error: 'Esta baixa é exclusiva para cobranças de excedente.' }, { status: 400 });
  }
  if (record.status !== 'pending') {
    return NextResponse.json({ success: false, error: 'Esta cobrança não está mais pendente.' }, { status: 409 });
  }

  const originalValue = Number(record.value || 0);
  const paidAmount = mode === 'received' ? Number(body?.paidAmount ?? originalValue) : 0;
  if (mode === 'received' && (!Number.isFinite(paidAmount) || paidAmount <= 0)) {
    return NextResponse.json({ success: false, error: 'Valor recebido inválido.' }, { status: 400 });
  }

  const asaasPaymentId = String(originalMetadata.asaas_payment_id || '').trim();
  const { data: financeApi } = await supabaseServer.from('system_settings').select('value').eq('id', 'finance_api').single();
  const financeConfig = metadataOf(financeApi?.value);
  const asaasApiKey = String(financeConfig.asaasApiKey || '');
  const asaas = asaasPaymentId && asaasApiKey
    ? new AsaasClient({ apiKey: asaasApiKey, environment: String(financeConfig.asaasEnv || 'sandbox') as 'sandbox' | 'production' })
    : null;

  if (asaasPaymentId && !asaas) {
    return NextResponse.json({ success: false, error: 'Integração com o Asaas não configurada; não é possível baixar o boleto.' }, { status: 500 });
  }

  // Confere o boleto antes de mexer em qualquer coisa: se já foi pago, o webhook do Asaas faz a baixa.
  let asaasAlreadyRemoved = false;
  if (asaas) {
    try {
      const payment = await asaas.getPayment(asaasPaymentId);
      if (PAID_ASAAS_STATUSES.has(String(payment?.status || ''))) {
        return NextResponse.json({
          success: false,
          error: 'Este boleto já consta como pago no Asaas. A baixa será feita automaticamente pelo retorno do Asaas.',
        }, { status: 409 });
      }
      asaasAlreadyRemoved = payment?.deleted === true;
    } catch (err) {
      if (asaasStatusCode(err) === 404) {
        asaasAlreadyRemoved = true;
      } else {
        return NextResponse.json({ success: false, error: `Asaas: ${asaasErrorMessage(err)}` }, { status: 502 });
      }
    }
  }

  if (mode === 'received' && asaasAlreadyRemoved) {
    return NextResponse.json({
      success: false,
      error: 'O boleto desta cobrança foi removido no Asaas. Use a baixa comum do Financeiro para registrar o recebimento.',
    }, { status: 409 });
  }

  const settledAt = new Date().toISOString();
  const settlement = {
    kind: mode === 'waived' ? 'abono' : 'recebido_fora',
    settled_at: settledAt,
    settled_by: auth.user.email,
    original_value: originalValue,
    paid_value: paidAmount,
    difference: Number((originalValue - paidAmount).toFixed(2)),
    note,
  };

  const nextMetadata: Metadata = {
    ...originalMetadata,
    settlement,
    charge_status: mode === 'waived' ? 'cancelled' : 'received_in_cash',
  };

  const updatePayload: Record<string, unknown> = mode === 'waived'
    ? { status: 'cancelled', metadata: nextMetadata }
    : {
      status: 'paid',
      value: paidAmount,
      metadata: nextMetadata,
      ...(bankAccountId ? { bank_account_id: bankAccountId } : {}),
      ...(paymentMethod ? { payment_method: paymentMethod } : {}),
    };

  // Grava antes de chamar o Asaas: o webhook de "recebido em dinheiro" encontra o lançamento já baixado.
  const { data: updatedRows, error: updateError } = await supabaseServer
    .from('system_finance_records')
    .update(updatePayload)
    .eq('id', recordId)
    .eq('status', 'pending')
    .select('id');

  if (updateError) return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ success: false, error: 'Esta cobrança acabou de ser baixada por outro processo.' }, { status: 409 });
  }

  if (asaas && !asaasAlreadyRemoved) {
    try {
      if (mode === 'waived') {
        await asaas.deletePayment(asaasPaymentId);
      } else {
        await asaas.receivePaymentInCash(asaasPaymentId, { paymentDate: todayBrt(), value: paidAmount, notifyCustomer: false });
      }
    } catch (err) {
      await supabaseServer
        .from('system_finance_records')
        .update({ status: 'pending', value: originalValue, metadata: originalMetadata })
        .eq('id', recordId);
      return NextResponse.json({ success: false, error: `Asaas: ${asaasErrorMessage(err)}. Nada foi alterado.` }, { status: 502 });
    }
  }

  const warnings: string[] = [];
  let glass: Awaited<ReturnType<typeof getGlassClient>> | null = null;
  const wasBlocked = originalMetadata.whatsapp_block_status === 'blocked'
    || (Array.isArray(originalMetadata.whatsapp_removed_modules) && originalMetadata.whatsapp_removed_modules.length > 0);
  try {
    glass = await getGlassClient();
    if (wasBlocked) {
      await restoreWhatsappModulesIfNeeded({ holdingSupabase: supabaseServer, glassSupabase: glass, recordId, metadata: nextMetadata });
    }
  } catch (err) {
    warnings.push(`WhatsApp não foi reativado automaticamente: ${err instanceof Error ? err.message : 'erro desconhecido'}.`);
  }

  if (mode === 'received') {
    if (!asaasPaymentId) {
      warnings.push('Cobrança sem boleto no Asaas: a NFS-e precisa ser emitida manualmente.');
    } else if (glass) {
      try {
        await emitirNFeExcedentePago({
          holdingSupabase: supabaseServer,
          glassSupabase: glass,
          financeRecordId: recordId,
          metadata: nextMetadata,
          valor: paidAmount,
          asaasPaymentId,
        });
      } catch (err) {
        warnings.push(`NFS-e não emitida: ${err instanceof Error ? err.message : 'erro desconhecido'}.`);
      }
    }
  }

  return NextResponse.json({ success: true, mode, status: updatePayload.status, warnings });
}
