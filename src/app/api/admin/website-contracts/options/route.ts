import { NextResponse } from 'next/server';
import { authorizeHoldingCommercial } from '@/lib/holding-commercial-auth';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(req: Request) {
  try {
    const denied = await authorizeHoldingCommercial(req, ['menu.assinaturas', 'submenu.assinaturas.websites', 'menu.clientes']);
    if (denied) return denied;
    const [customers, plans, recurringPlans] = await Promise.all([
      supabaseServer.from('holding_customers').select('id,name,document').eq('active', true).order('name'),
      supabaseServer.from('holding_website_plans').select('id,name,price_cents,scope')
        .eq('active', true).eq('billing_cycle', 'one_time').order('name'),
      supabaseServer.from('holding_website_plans').select('id,name,scope,billing_cycle,price_cents,recurring_prices,fiscal_config')
        .eq('active', true).neq('billing_cycle', 'one_time').order('name'),
    ]);
    if (customers.error || plans.error || recurringPlans.error) throw new Error('Falha ao consultar opções.');
    return NextResponse.json({ customers: customers.data, plans: plans.data, recurring_plans: recurringPlans.data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[WEBSITE CONTRACTS] Falha ao consultar opções da contratação.');
    return NextResponse.json({ error: 'Não foi possível carregar clientes e produtos. Confira as permissões e a migração.' }, { status: 500 });
  }
}
