import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { supabaseServer } from '@/lib/supabase-server';
import { validateWebsiteContract } from '@/lib/website-contracts';

const PERMISSIONS = ['menu.assinaturas', 'submenu.assinaturas.websites'];

export async function GET(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, PERMISSIONS);
    if (denied) return denied;
    const { data, error } = await supabaseServer.from('holding_website_contracts')
      .select('*,holding_website_installments(*),holding_website_invoices(id,status,competence)').order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ contracts: data }, { headers: { 'Cache-Control': 'private, no-store' } });
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
    try { input = validateWebsiteContract(body); } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Contratação inválida.' }, { status: 400 });
    }
    const { data, error } = await supabaseServer.rpc('holding_create_website_contract', {
      p_request_id: input.request_id,
      p_customer_id: input.customer_id, p_plan_id: input.plan_id, p_total_cents: input.total_cents,
      p_payment_method: input.payment_method, p_schedule: input.schedule,
    });
    if (error?.code === '22023') return NextResponse.json({ error: 'Esta tentativa já foi salva com outros dados. Atualize as contratações antes de continuar.' }, { status: 409 });
    if (error?.code === 'P0002') return NextResponse.json({ error: 'Selecione um cliente ativo e um produto ativo de cobrança única.' }, { status: 400 });
    if (error) throw error;
    if (!data) throw new Error('Contrato não confirmado pelo banco.');
    return NextResponse.json({ id: data }, { status: 201 });
  } catch {
    console.error('[WEBSITE CONTRACTS] Falha ao salvar contratação.');
    return NextResponse.json({ error: 'Não foi possível salvar a contratação. Confira o cadastro e a migração do banco.' }, { status: 500 });
  }
}
