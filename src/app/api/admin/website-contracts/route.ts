import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { validateWebsiteContract } from '@/lib/website-contracts';
import { validateWebsiteSubscription } from '@/lib/website-subscription-terms';
import { editWebsiteContract } from '@/lib/website-contract-edit';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';

const PERMISSIONS = ['menu.assinaturas', 'submenu.assinaturas.websites'];

export async function PUT(req: Request) {
  const denied = await authorizeHoldingCommercial(req, [...PERMISSIONS, 'menu.clientes']);
  if (denied) return denied;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Envie um JSON válido.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await editWebsiteContract(body, async () => {
      const auth = await authenticateHoldingAdmin(req);
      if (!auth.ok || !auth.user.email) throw new Error('Entre novamente pela Holding.');
      const permissions = await getHoldingWebsitesPermissions(auth.user.email);
      if (!permissions.menu || !permissions.view || !permissions.manage) throw new Error('Somente gestores podem trocar o produto contratado.');
      return auth.user.email.trim().toLowerCase();
    }));
  } catch (failure) {
    console.error('[WEBSITE CONTRACTS] Edição interrompida, sem emitir cobranças.');
    return NextResponse.json({ error: failure instanceof Error ? failure.message : 'Não foi possível editar a contratação.' }, { status: 409 });
  }
}

export async function GET(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, PERMISSIONS);
    if (denied) return denied;
    const { data, error } = await supabaseServer.from('holding_website_contracts')
      .select('*,holding_website_installments(*),holding_website_invoices(id,status,competence)').order('created_at', { ascending: false });
    if (error) throw error;
    const emails = [...new Set(data.flatMap((contract) => contract.designer_email ? [contract.designer_email] : []))];
    const members = emails.length ? await supabaseServer.from('equipe_791').select('email,nome').in('email', emails) : { data: [], error: null };
    if (members.error) throw members.error;
    return NextResponse.json({ contracts: data.map((contract) => ({
      ...contract, designer_name: members.data?.find((member) => member.email === contract.designer_email)?.nome || null,
    })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[WEBSITE CONTRACTS] Falha ao carregar contratos.');
    return NextResponse.json({ error: 'Não foi possível carregar as contratações de Websites.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, [...PERMISSIONS, 'menu.clientes']);
    if (denied) return denied;
    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Envie um JSON válido.' }, { status: 400 });
    }
    let input: ReturnType<typeof validateWebsiteContract>;
    let subscription: ReturnType<typeof validateWebsiteSubscription> | null = null;
    try {
      input = validateWebsiteContract(body);
      if (body && typeof body === 'object' && 'subscription' in body && body.subscription != null) {
        if (typeof body.subscription !== 'object' || Array.isArray(body.subscription)) throw new Error('Assinatura opcional inválida.');
        subscription = validateWebsiteSubscription({ ...body.subscription, customer_id: input.customer_id, request_id: input.request_id });
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Contratação inválida.' }, { status: 400 });
    }
    if (subscription) {
      const fiscalDenied = await authorizeHoldingCommercial(req, ['menu.notas_fiscais']);
      if (fiscalDenied) return fiscalDenied;
    }
    const { data, error } = await supabaseServer.rpc('holding_create_website_bundle', {
      p_request_id: input.request_id,
      p_customer_id: input.customer_id, p_plan_id: input.plan_id, p_total_cents: input.total_cents,
      p_payment_method: input.payment_method, p_schedule: input.schedule,
      p_subscription: subscription ? { ...subscription, fiscal_confirmed: true } : null,
    });
    if (error?.code === '22023') return NextResponse.json({ error: 'Esta tentativa já foi salva com outros dados. Atualize as contratações antes de continuar.' }, { status: 409 });
    if (error?.code === 'P0002' || error?.code === 'P0001') return NextResponse.json({ error: 'Confira cliente/produtos ativos, ciclo oferecido e dados fiscais confirmados da assinatura opcional.' }, { status: 400 });
    if (error) throw error;
    if (!data || typeof data.id !== 'string') throw new Error('Contrato não confirmado pelo banco.');
    return NextResponse.json({ id: data.id, subscription_id: data.subscription_id }, { status: 201 });
  } catch {
    console.error('[WEBSITE CONTRACTS] Falha ao salvar contratação.');
    return NextResponse.json({ error: 'Não foi possível salvar a contratação. Confira o cadastro e a migração do banco.' }, { status: 500 });
  }
}
