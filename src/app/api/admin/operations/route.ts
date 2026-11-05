import { NextResponse } from 'next/server';
import { supabaseServer as db } from '@/lib/supabase-server';
import { operationsAccess } from '@/lib/holding-operations-access';
import { getGlassClient } from '@/lib/glass-client';
import { isUuid } from '@/lib/holding-customers';
import { validDate } from '@/lib/website-contracts';
import { OPERATIONS_PRODUCTS, operationsStages, type OperationsArea } from '@/lib/holding-operations';

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const failed = (message: string, status = 400) => json({ error: message }, status);
const isArea = (value: string | null): value is OperationsArea => value === 'comercial' || value === 'producao';

export async function GET(req: Request) {
  try {
    const auth = await operationsAccess(req);
    if (!auth.ok) return failed(auth.error, auth.status);
    const params = new URL(req.url).searchParams;
    const mode = params.get('mode');
    const product = params.get('product');
    if (product && !Object.hasOwn(OPERATIONS_PRODUCTS, product)) return failed('Produto inválido.');
    if (mode === 'metrics') {
      if (!auth.codes.includes('menu.gestao')) return failed('Sem acesso aos indicadores.', 403);
      if (!validDate(params.get('start')) || !validDate(params.get('end'))) return failed('Informe o período.');
      const result = await db.rpc('holding_operations_metrics', {
        p_actor: auth.email, p_start: params.get('start'), p_end: params.get('end'), p_product: product || null,
      });
      if (result.error) throw result.error;
      const members = await db.from('equipe_791').select('email,nome').order('nome');
      if (members.error) throw members.error;
      const production = !product || product === 'websites' ? await db.rpc('holding_website_production_metrics', {
        p_actor: auth.email, p_start: params.get('start'), p_end: params.get('end'),
      }) : { data: [], error: null };
      if (production.error) throw production.error;
      return json({ metrics: [...result.data.filter((metric: { area: string }) => metric.area === 'comercial'), ...production.data], members: members.data });
    }
    const area = params.get('area');
    if (!isArea(area)) return failed('Módulo inválido.');
    if (!auth.codes.includes(`menu.${area}`)) return failed('Sem acesso ao módulo.', 403);
    if (area === 'producao') return failed('As etapas são avançadas no Websites. Consulte a produtividade em Produção.', 410);
    const manager = auth.codes.includes(`action.${area}.manage`);
    const page = Number(params.get('page') || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) return failed('Página inválida.');
    if (mode === 'members') {
      if (!manager) return failed('Somente gestores distribuem registros.', 403);
      const result = await db.from('holding_user_permission_profiles').select('user_email');
      if (result.error) throw result.error;
      const names = await db.from('equipe_791').select('email,nome');
      if (names.error) throw names.error;
      const candidates = await Promise.all([...new Set(result.data.map((row) => String(row.user_email)))].map(async (email) => {
        const permissions = await db.rpc('holding_operations_permissions', { p_email: email });
        if (permissions.error) throw permissions.error;
        return permissions.data.includes(`menu.${area}`) ? { email, name: names.data.find((row) => row.email === email)?.nome || email } : null;
      }));
      const members = candidates.filter((member) => member !== null);
      return json({ members });
    }
    if (mode === 'sources') {
      if (!manager) return failed('Somente gestores importam registros.', 403);
      if (product === 'glass' && area === 'comercial') {
        const glass = await getGlassClient();
        let query = glass.from('vidracarias').select('id,nome,email,status_assinatura,created_at', { count: 'exact' });
        const status = params.get('source_status');
        if (status) query = query.eq('status_assinatura', status);
        const result = await query.order('created_at', { ascending: false }).range(page * 25, page * 25 + 24);
        if (result.error) {
          console.error('[HOLDING OPERATIONS] Origem Glass indisponível.', { code: result.error.code });
          return failed('Não foi possível consultar os assinantes. Revise a conexão Glass em Configurações. O cadastro manual continua disponível.', 503);
        }
        return json({ sources: result.data.map((row) => ({ id: row.id, name: row.nome, contact: row.email || '', status: row.status_assinatura, type: 'glass_subscriber' })), count: result.count });
      }
      if (product === 'websites') {
        const result = await db.from('holding_website_contracts').select('id,customer_snapshot,plan_snapshot', { count: 'exact' })
          .order('created_at', { ascending: false }).range(page * 25, page * 25 + 24);
        if (result.error) throw result.error;
        return json({ sources: result.data.map((row) => ({ id: row.id, name: row.customer_snapshot.name, contact: row.customer_snapshot.email || '', status: 'Contratação', type: 'website_contract', title: row.plan_snapshot.name })), count: result.count });
      }
      return failed('Este produto ainda não tem conector comercial. Cadastre o registro manualmente.');
    }
    if (mode === 'commissions') {
      if (area !== 'comercial') return failed('Comissões pertencem ao Comercial.');
      let query = db.from('holding_operation_commissions').select('*,holding_operations!inner(customer_name,title,product)', { count: 'exact' });
      if (!manager) query = query.eq('seller_email', auth.email);
      if (product) query = query.eq('holding_operations.product', product);
      const result = await query.order('converted_at', { ascending: false }).range(page * 25, page * 25 + 24);
      if (result.error) throw result.error;
      return json({ commissions: result.data, count: result.count });
    }
    if (mode && mode !== 'history') return failed('Consulta inválida.');
    const id = params.get('id');
    let query = db.from('holding_operations').select('*', { count: 'exact' }).eq('area', area);
    if (!manager) query = query.eq('owner_email', auth.email);
    if (product) query = query.eq('product', product);
    const owner = params.get('owner');
    if (manager && owner) query = owner === 'unassigned' ? query.is('owner_email', null) : query.eq('owner_email', owner);
    const stage = params.get('stage');
    if (stage) {
      if (!Object.hasOwn(operationsStages(area), stage)) return failed('Etapa inválida.');
      query = query.eq('stage', stage);
    }
    if (mode === 'history') {
      if (!id || !isUuid(id)) return failed('Registro inválido.');
      const record = await db.from('holding_operations').select('id,owner_email,area').eq('id', id).maybeSingle();
      if (record.error) throw record.error;
      if (!record.data || record.data.area !== area || (!manager && record.data.owner_email !== auth.email)) return failed('Registro indisponível.', 404);
      const result = await db.from('holding_operation_events').select('id,record_id,actor_email,owner_email,stage,previous_stage,note,created_at', { count: 'exact' })
        .eq('record_id', id).order('created_at', { ascending: false }).range(page * 25, page * 25 + 24);
      if (result.error) throw result.error;
      return json({ events: result.data, count: result.count });
    }
    const result = await query.order('created_at', { ascending: false }).range(page * 25, page * 25 + 24);
    if (result.error) throw result.error;
    return json({ records: result.data, count: result.count, manager, email: auth.email });
  } catch (failure) {
    console.error('[HOLDING OPERATIONS] Consulta não concluída.', failure instanceof Error ? failure.message : 'Falha de banco ou integração.');
    return failed('Não foi possível carregar. Confira as permissões, a conexão e a migração de operações.', 503);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await operationsAccess(req);
    if (!auth.ok) return failed(auth.error, auth.status);
    let body: Record<string, unknown>;
    try {
      const input: unknown = await req.json();
      if (!input || typeof input !== 'object' || Array.isArray(input)) return failed('Envie um objeto JSON.');
      body = { ...input };
    } catch { return failed('Envie um JSON válido.'); }
    if (body.id !== undefined && !isUuid(body.id)) return failed('Registro inválido.');
    if (body.id === undefined && (!isArea(typeof body.area === 'string' ? body.area : null) || !isUuid(body.request_id)
      || typeof body.product !== 'string' || !Object.hasOwn(OPERATIONS_PRODUCTS, body.product))) return failed('Confira módulo, produto e identificador.');
    for (const [field, max] of Object.entries({ customer_name: 200, title: 200, contact: 300, owner_email: 320, next_action: 2000, loss_reason: 2000, note: 5000 })) {
      if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > max)) return failed(`Confira o campo ${field}.`);
    }
    if (body.due_date && !validDate(body.due_date)) return failed('Prazo inválido.');
    if (body.id && (!Number.isSafeInteger(body.version) || Number(body.version) < 1)) return failed('Atualize o registro antes de salvar.');
    if (!body.id) {
      const area = String(body.area);
      if (!auth.codes.includes(`menu.${area}`) || !auth.codes.includes(`action.${area}.manage`)) return failed('Sem permissão para criar ou importar.', 403);
      if (body.source_type === 'glass_subscriber') {
        if (body.area !== 'comercial' || body.product !== 'glass' || !isUuid(body.source_id)) return failed('Origem inválida.');
        const glass = await getGlassClient();
        const source = await glass.from('vidracarias').select('id,nome,email,status_assinatura').eq('id', body.source_id).single();
        if (source.error) {
          console.error('[HOLDING OPERATIONS] Importação Glass não confirmada.', { code: source.error.code });
          return failed('O Glass não confirmou este assinante. Confira a conexão e consulte a origem novamente; nenhum lead foi salvo.', 503);
        }
        body = { ...body, customer_name: source.data.nome, contact: source.data.email || '', source_status: source.data.status_assinatura };
      } else if (body.source_type === 'website_contract') {
        if (body.product !== 'websites' || !isUuid(body.source_id)) return failed('Origem inválida.');
        const source = await db.from('holding_website_contracts').select('id,customer_snapshot,plan_snapshot').eq('id', body.source_id).single();
        if (source.error) throw source.error;
        body = { ...body, customer_name: source.data.customer_snapshot.name, contact: source.data.customer_snapshot.email || '', source_status: 'Contratação' };
      } else if (body.source_type && body.source_type !== 'manual') return failed('Origem inválida.');
      if (typeof body.customer_name !== 'string' || !body.customer_name.trim() || typeof body.title !== 'string' || !body.title.trim()) return failed('Informe cliente e título.');
    }
    const result = await db.rpc('holding_save_operation', { p_actor: auth.email, p_data: body });
    if (result.error) {
      console.error('[HOLDING OPERATIONS] Gravação rejeitada.', result.error.code);
      return failed(result.error.code === '23505' ? 'Este registro já foi importado ou salvo. Atualize a lista antes de repetir.' : result.error.message, 409);
    }
    return json({ id: result.data, success: true });
  } catch {
    console.error('[HOLDING OPERATIONS] Gravação não concluída.');
    return failed('Não foi possível salvar. Atualize antes de repetir; nenhuma cobrança ou comissão foi paga.', 503);
  }
}
