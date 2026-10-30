import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { getGlassClient } from '@/lib/glass-client';
import { belongsToTenant, getAsaasClient, metadataOf } from '@/lib/glass-tenant-billing';

const PAID_ASAAS_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);

function asaasErrorMessage(err: unknown) {
  const data = (err as { response?: { data?: { errors?: Array<{ description?: string }> } } })?.response?.data;
  return data?.errors?.[0]?.description || (err instanceof Error ? err.message : 'Falha na comunicação com o Asaas.');
}

const asaasStatusCode = (err: unknown) => Number((err as { response?: { status?: number } })?.response?.status || 0);

/**
 * Cancela uma fatura de assinatura ainda não paga (vencida ou a vencer): remove o boleto no Asaas
 * e mantém o registro como "cancelada" no histórico. Excedentes usam /api/admin/overage-settle (abono).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (!(await userCanAccessResource(auth.user.email, 'menu.financeiro'))) {
    return NextResponse.json({ success: false, error: 'Sem permissão para cancelar faturas.' }, { status: 403 });
  }

  const { id: tenantId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }
  const recordId = String(body?.recordId || '').trim();
  const bodyPaymentId = String(body?.asaasPaymentId || '').trim();
  const note = String(body?.note || '').trim().slice(0, 500) || null;
  if (!recordId && !bodyPaymentId) {
    return NextResponse.json({ success: false, error: 'Fatura não informada.' }, { status: 400 });
  }

  const cancellation = { kind: 'cancelamento', settled_at: new Date().toISOString(), settled_by: auth.user.email, note };

  let record: { id: string; status: string | null; value: number | null; metadata: unknown } | null = null;
  if (recordId) {
    const { data } = await supabaseServer
      .from('system_finance_records')
      .select('id, status, value, metadata')
      .eq('id', recordId)
      .eq('business_unit', 'glass')
      .maybeSingle();
    if (!data || String(metadataOf(data.metadata).tenant_id || '') !== tenantId) {
      return NextResponse.json({ success: false, error: 'Fatura não encontrada para este cliente.' }, { status: 404 });
    }
    if (metadataOf(data.metadata).kind === 'overage') {
      return NextResponse.json({ success: false, error: 'Excedentes são abonados pela baixa de excedente.' }, { status: 400 });
    }
    if (data.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Esta fatura não está mais em aberto.' }, { status: 409 });
    }
    record = data;
  }

  const paymentId = bodyPaymentId || String(metadataOf(record?.metadata).asaas_payment_id || '');
  const asaas = paymentId ? await getAsaasClient() : null;
  if (paymentId && !asaas) {
    return NextResponse.json({ success: false, error: 'Integração com o Asaas não configurada.' }, { status: 500 });
  }

  // Confere o boleto no Asaas: precisa ser deste tenant e não pode estar pago.
  let payment: Record<string, any> | null = null;
  let alreadyRemoved = false;
  if (asaas && paymentId) {
    try {
      payment = await asaas.getPayment(paymentId);
      alreadyRemoved = payment?.deleted === true;
    } catch (err) {
      if (asaasStatusCode(err) === 404) alreadyRemoved = true;
      else return NextResponse.json({ success: false, error: `Asaas: ${asaasErrorMessage(err)}` }, { status: 502 });
    }
    if (payment && !record && !belongsToTenant(payment.externalReference, tenantId)) {
      return NextResponse.json({ success: false, error: 'Esta cobrança não pertence a este cliente.' }, { status: 403 });
    }
    if (PAID_ASAAS_STATUSES.has(String(payment?.status || ''))) {
      return NextResponse.json({ success: false, error: 'Este boleto já consta como pago no Asaas.' }, { status: 409 });
    }
  }
  if (!record && (!payment || alreadyRemoved)) {
    return NextResponse.json({ success: false, error: 'Cobrança não encontrada no Asaas.' }, { status: 404 });
  }

  // Grava o histórico antes de remover o boleto; desfaz se o Asaas recusar.
  let auditId: string | null = null;
  let originalRecord: typeof record = null;
  if (record) {
    originalRecord = record;
    const { data: rows, error } = await supabaseServer
      .from('system_finance_records')
      .update({ status: 'cancelled', metadata: { ...metadataOf(record.metadata), settlement: cancellation, charge_status: 'cancelled' } })
      .eq('id', record.id)
      .eq('status', 'pending')
      .select('id');
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    if (!rows?.length) return NextResponse.json({ success: false, error: 'Esta fatura acabou de ser alterada por outro processo.' }, { status: 409 });
  } else if (payment) {
    let tenantName = tenantId;
    try {
      const glass = await getGlassClient();
      const { data } = await glass.from('vidracarias').select('nome_fantasia, nome').eq('id', tenantId).maybeSingle();
      tenantName = String(data?.nome_fantasia || data?.nome || tenantId);
    } catch {
      // nome é só informativo
    }
    const { data: inserted, error } = await supabaseServer
      .from('system_finance_records')
      .insert({
        business_unit: 'glass',
        type: 'revenue',
        status: 'cancelled',
        value: Number(payment.value || 0),
        description: `Assinatura SaaS glass - ${tenantName} (cancelada)`,
        category: 'Assinatura',
        payment_link: payment.invoiceUrl || null,
        metadata: {
          kind: 'subscription',
          tenant_id: tenantId,
          tenant_name: tenantName,
          asaas_payment_id: payment.id,
          due_date: payment.dueDate || null,
          external_reference: payment.externalReference || null,
          source: 'tenant_panel',
          charge_status: 'cancelled',
          settlement: cancellation,
        },
      })
      .select('id')
      .single();
    if (error || !inserted) return NextResponse.json({ success: false, error: error?.message || 'Falha ao registrar o cancelamento.' }, { status: 500 });
    auditId = inserted.id;
  }

  if (asaas && paymentId && !alreadyRemoved) {
    try {
      await asaas.deletePayment(paymentId);
    } catch (err) {
      if (originalRecord) {
        await supabaseServer.from('system_finance_records')
          .update({ status: 'pending', metadata: originalRecord.metadata })
          .eq('id', originalRecord.id);
      }
      if (auditId) await supabaseServer.from('system_finance_records').delete().eq('id', auditId);
      return NextResponse.json({ success: false, error: `Asaas: ${asaasErrorMessage(err)}. Nada foi alterado.` }, { status: 502 });
    }
  }

  console.log(`[TENANT PANEL] ${auth.user.email} cancelou a fatura ${paymentId || recordId} do tenant ${tenantId}`);
  return NextResponse.json({ success: true });
}
