import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { getGlassClient } from '@/lib/glass-client';
import { findTenantAsaasCustomers, getAsaasClient, todayBrt } from '@/lib/glass-tenant-billing';

const BILLING_TYPES = new Set(['UNDEFINED', 'BOLETO', 'PIX']);

function asaasErrorMessage(err: unknown) {
  const data = (err as { response?: { data?: { errors?: Array<{ description?: string }> } } })?.response?.data;
  return data?.errors?.[0]?.description || (err instanceof Error ? err.message : 'Falha na comunicação com o Asaas.');
}

/**
 * Emite uma cobrança avulsa para o tenant: cria o lançamento pendente na holding e o boleto/Pix no Asaas.
 * A baixa é automática pelo webhook (referência finance_record|<id>).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (!(await userCanAccessResource(auth.user.email, 'menu.financeiro'))) {
    return NextResponse.json({ success: false, error: 'Sem permissão para emitir cobranças.' }, { status: 403 });
  }

  const { id: tenantId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }

  const value = Math.round(Number(body?.value) * 100) / 100;
  const description = String(body?.description || '').trim().slice(0, 300);
  const dueDate = String(body?.dueDate || '').trim();
  const billingType = String(body?.billingType || 'UNDEFINED').toUpperCase();

  if (!Number.isFinite(value) || value < 5 || value > 100000) {
    return NextResponse.json({ success: false, error: 'Informe um valor entre R$ 5,00 e R$ 100.000,00.' }, { status: 400 });
  }
  if (description.length < 3) {
    return NextResponse.json({ success: false, error: 'Informe a descrição da cobrança.' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < todayBrt()) {
    return NextResponse.json({ success: false, error: 'O vencimento deve ser hoje ou uma data futura.' }, { status: 400 });
  }
  if (!BILLING_TYPES.has(billingType)) {
    return NextResponse.json({ success: false, error: 'Forma de pagamento inválida.' }, { status: 400 });
  }

  const glass = await getGlassClient();
  const { data: tenant } = await glass
    .from('vidracarias')
    .select('id, nome, nome_fantasia, email, cnpj')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ success: false, error: 'Vidraçaria não encontrada.' }, { status: 404 });

  const document = String(tenant.cnpj || '').replace(/\D/g, '');
  if (document.length !== 11 && document.length !== 14) {
    return NextResponse.json({ success: false, error: 'O cliente não tem CPF/CNPJ válido cadastrado; o Asaas exige o documento.' }, { status: 400 });
  }

  const asaas = await getAsaasClient();
  if (!asaas) return NextResponse.json({ success: false, error: 'Integração com o Asaas não configurada.' }, { status: 400 });

  const tenantName = String(tenant.nome || tenant.nome_fantasia || 'Cliente');
  const metadata = {
    kind: 'avulsa',
    source: 'tenant_panel',
    tenant_id: tenantId,
    tenant_name: tenantName,
    due_date: dueDate,
    created_by: auth.user.email,
  };

  const { data: record, error: insertError } = await supabaseServer
    .from('system_finance_records')
    .insert({
      business_unit: 'glass',
      type: 'revenue',
      status: 'pending',
      value,
      description,
      payment_method: 'Asaas',
      bank_id: 'Asaas',
      category: 'SaaS Avulsa',
      metadata,
    })
    .select('id')
    .single();
  if (insertError || !record?.id) {
    return NextResponse.json({ success: false, error: insertError?.message || 'Falha ao registrar a cobrança.' }, { status: 500 });
  }

  try {
    let customerId = (await findTenantAsaasCustomers(asaas, tenant))[0];
    if (!customerId) {
      const email = String(tenant.email || '').includes('@') ? String(tenant.email) : `financeiro+${tenantId}@791solucoes.com.br`;
      const customer = await asaas.createCustomer({ name: tenantName, email, cpfCnpj: document });
      customerId = customer.id;
    }

    const payment = await asaas.createPayment({
      customer: customerId,
      billingType: billingType as 'UNDEFINED' | 'BOLETO' | 'PIX',
      value,
      dueDate,
      description,
      externalReference: `finance_record|${record.id}`,
    });

    await supabaseServer
      .from('system_finance_records')
      .update({
        payment_link: payment?.invoiceUrl || null,
        metadata: { ...metadata, charge_status: 'created', asaas_payment_id: payment?.id || null, invoice_url: payment?.invoiceUrl || null },
      })
      .eq('id', record.id);

    console.log(`[TENANT PANEL] ${auth.user.email} emitiu cobrança avulsa ${record.id} (${value}) para ${tenantId}`);
    return NextResponse.json({ success: true, recordId: record.id, paymentId: payment?.id, invoiceUrl: payment?.invoiceUrl || null });
  } catch (err) {
    await supabaseServer.from('system_finance_records').delete().eq('id', record.id);
    return NextResponse.json({ success: false, error: `Asaas: ${asaasErrorMessage(err)}. Nada foi cobrado.` }, { status: 502 });
  }
}
