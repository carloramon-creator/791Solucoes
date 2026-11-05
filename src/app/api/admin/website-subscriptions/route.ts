import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { supabaseServer as db } from '@/lib/supabase-server';
import { validateWebsiteSubscription } from '@/lib/website-subscription-terms';
import { isUuid } from '@/lib/holding-customers';

const PERMISSIONS = ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.clientes'];
export async function GET(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, PERMISSIONS);
    if (denied) return denied;
    const [subscriptions, customers, plans] = await Promise.all([
      db.from('holding_website_subscriptions').select(
        '*,lifecycle_status,pending_action,resume_due_date,contract_id,holding_website_subscription_payments(*,holding_website_invoices(status,system_invoice_id))',
      ).order('created_at', { ascending: false }),
      db.from('holding_customers').select('id,name,document').eq('active', true).order('name'),
      db.from('holding_website_plans').select('id,name,scope,project_type,billing_cycle,price_cents,recurring_prices,fiscal_config')
        .eq('active', true).neq('billing_cycle', 'one_time').order('name'),
    ]);
    if (subscriptions.error || customers.error || plans.error) throw new Error('Falha ao carregar dados.');
    return NextResponse.json({ subscriptions: subscriptions.data, customers: customers.data, plans: plans.data },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[WEBSITE SUBSCRIPTIONS] Falha ao carregar assinaturas.');
    return NextResponse.json({ error: 'Não foi possível carregar assinaturas. Confira as permissões e a nova migração.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, [...PERMISSIONS, 'menu.notas_fiscais']);
    if (denied) return denied;
    let input: ReturnType<typeof validateWebsiteSubscription>;
    let contractId: string | null = null;
    try {
      const body = await req.json();
      if (body?.contract_id != null) {
        if (!isUuid(body.contract_id)) throw new Error('Contratação inválida.');
        contractId = body.contract_id;
        const contract = await db.from('holding_website_contracts').select('customer_id').eq('id', contractId).single();
        if (contract.error || !contract.data) throw new Error('Contratação não encontrada.');
        body.customer_id = contract.data.customer_id;
      }
      input = validateWebsiteSubscription(body);
    } catch (failure) {
      return NextResponse.json({ error: failure instanceof Error ? failure.message : 'Dados inválidos.' }, { status: 400 });
    }
    const { data, error } = await db.rpc(contractId ? 'holding_add_contract_subscription' : 'holding_create_website_subscription', {
      p_request_id: input.request_id, ...(contractId ? { p_contract_id: contractId } : { p_customer_id: input.customer_id }), p_plan_id: input.plan_id,
      p_amount_cents: input.amount_cents, p_payment_method: input.payment_method,
      p_first_due_date: input.first_due_date, p_cycle: input.billing_cycle,
    });
    if (error?.code === '22023') return NextResponse.json({ error: 'Tentativa já salva com outros dados. Atualize antes de continuar.' }, { status: 409 });
    if (error?.code === 'P0002' || error?.code === 'P0001') {
      return NextResponse.json({ error: 'Selecione cliente/produto ativos, com ciclo oferecido e dados fiscais confirmados.' }, { status: 400 });
    }

    if (error || !data) throw new Error('Banco não confirmou a assinatura.');
    return NextResponse.json({ id: data }, { status: 201 });
  } catch {
    console.error('[WEBSITE SUBSCRIPTIONS] Falha ao salvar assinatura.');
    return NextResponse.json({ error: 'Não foi possível salvar. Confira a migração e os dados da assinatura.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, PERMISSIONS);
    if (denied) return denied;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
    if (!body || !isUuid(body.contract_id) || !isUuid(body.id)) {
      return NextResponse.json({ error: 'Selecione contratação e assinatura válidas.' }, { status: 400 });
    }
    const { data, error } = await db.rpc('holding_link_website_subscription', {
      p_contract_id: body.contract_id, p_subscription_id: body.id,
    });
    if (error || !data) {
      console.error('[WEBSITE SUBSCRIPTIONS] Vínculo não confirmado.', { code: error?.code });
      return NextResponse.json({ error: 'Não foi possível vincular. Confira cliente, tipo de projeto e vínculo anterior da assinatura.' }, { status: 409 });
    }
    return NextResponse.json({ id: data });
  } catch {
    console.error('[WEBSITE SUBSCRIPTIONS] Falha ao vincular assinatura.');
    return NextResponse.json({ error: 'Não foi possível vincular a assinatura.' }, { status: 500 });
  }
}
