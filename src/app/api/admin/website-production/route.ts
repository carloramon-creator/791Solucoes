import { NextResponse } from 'next/server';
import { operationsAccess } from '@/lib/holding-operations-access';
import { supabaseServer as db } from '@/lib/supabase-server';
import { isUuid } from '@/lib/holding-customers';
import { WEBSITE_PRODUCTION_STAGES } from '@/lib/website-production';

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(req: Request) {
  try {
    const auth = await operationsAccess(req);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!auth.codes.includes('menu.producao')) return json({ error: 'Sem acesso à produtividade.' }, 403);
    const manager = auth.codes.includes('action.producao.manage');
    const params = new URL(req.url).searchParams;
    const page = Number(params.get('page') || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) return json({ error: 'Página inválida.' }, 400);
    const mode = params.get('mode') || 'projects';
    if (mode === 'rates') {
      if (!manager) return json({ error: 'Somente gestores configuram valores.' }, 403);
      const plans = await db.from('holding_website_plans')
        .select('id,name,project_type,active,holding_website_productivity_rates(amount_cents,version,updated_at,updated_by)', { count: 'exact' })
        .eq('category', 'creation').order('name').order('id').range(page * 25, page * 25 + 24);
      if (plans.error) throw plans.error;
      return json({ plans: plans.data, count: plans.count, manager });
    }
    if (mode === 'earnings') {
      let query = db.from('holding_website_productivity_summary').select('*', { count: 'exact' });
      if (!manager) query = query.eq('designer_email', auth.email);
      const earnings = await query.order('approved_at', { ascending: false }).order('contract_id').range(page * 25, page * 25 + 24);
      if (earnings.error) throw earnings.error;
      return json({ earnings: earnings.data, count: earnings.count, manager });
    }
    if (mode !== 'projects') return json({ error: 'Consulta inválida.' }, 400);
    let query = db.from('holding_website_contracts').select(
      'id,customer_snapshot,plan_snapshot,designer_email,production_stage,production_completed_at,holding_website_productivity(amount_cents,designer_email,finance_record_id)', { count: 'exact' },
    ).not('project_type', 'is', null);
    if (!manager) query = query.eq('designer_email', auth.email);
    const stage = params.get('stage');
    if (stage) {
      if (!Object.hasOwn(WEBSITE_PRODUCTION_STAGES, stage)) return json({ error: 'Etapa inválida.' }, 400);
      query = query.eq('production_stage', stage);
    }
    const projects = await query.order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24);
    if (projects.error) throw projects.error;
    return json({ projects: projects.data, count: projects.count, manager });
  } catch {
    console.error('[WEBSITE PRODUCTIVITY] Consulta não concluída.');
    return json({ error: 'Não foi possível consultar a produtividade. Confira a migração e as permissões.' }, 503);
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await operationsAccess(req);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!auth.codes.includes('menu.producao') || !auth.codes.includes('action.producao.manage')) {
      return json({ error: 'Sem permissão para configurar valores.' }, 403);
    }
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Envie JSON válido.' }, 400); }
    if (!body || !isUuid(body.plan_id) || !Number.isSafeInteger(body.amount_cents)
      || body.amount_cents < 1 || body.amount_cents > 999999999 || !Number.isSafeInteger(body.version) || body.version < 0) {
      return json({ error: 'Confira plano, valor em centavos e versão.' }, 400);
    }
    const result = await db.rpc('holding_set_website_productivity_rate', {
      p_actor: auth.email, p_plan_id: body.plan_id, p_amount_cents: body.amount_cents, p_version: body.version,
    });
    if (result.error) {
      console.error('[WEBSITE PRODUCTIVITY] Valor não salvo.', { code: result.error.code });
      return json({ error: result.error.code === 'P0001' ? result.error.message : 'Valor não confirmado. Atualize antes de repetir.' }, 409);
    }
    return json({ success: true });
  } catch {
    console.error('[WEBSITE PRODUCTIVITY] Configuração interrompida.');
    return json({ error: 'Não foi possível salvar o valor de produtividade.' }, 503);
  }
}
