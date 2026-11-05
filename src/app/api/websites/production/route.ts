import { NextResponse } from 'next/server';
import { inspectWebsitesSession, isSsoValue, ssoHeaders } from '@/lib/holding-websites-sso';
import { websiteProjects } from '@/lib/website-projects';
import { supabaseServer as db } from '@/lib/supabase-server';
import { isUuid } from '@/lib/holding-customers';
import { WEBSITE_PRODUCTION_STAGES } from '@/lib/website-production';

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: ssoHeaders });
async function sessionFor(req: Request) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return isSsoValue(token) ? inspectWebsitesSession(token) : null;
}

export async function GET(req: Request) {
  try {
    const session = await sessionFor(req);
    if (!session) return json({ error: 'Sessão ausente ou revogada.' }, 401);
    const id = new URL(req.url).searchParams.get('contractId');
    if (!isUuid(id)) return json({ error: 'Contratação inválida.' }, 400);
    const projects = await websiteProjects(session.user.email, session.permissions.manage, id);
    if (!projects.some((project) => project.contractId === id)) return json({ error: 'Projeto indisponível.' }, 403);
    const result = await db.from('holding_website_contracts')
      .select('production_stage,production_version').eq('id', id).single();
    if (result.error) throw result.error;
    return json({ stage: result.data.production_stage, version: result.data.production_version });
  } catch {
    console.error('[WEBSITE PRODUCTION] Etapa não consultada.');
    return json({ error: 'Não foi possível verificar a evolução na Holding.' }, 503);
  }
}

export async function POST(req: Request) {
  try {
    const session = await sessionFor(req);
    if (!session) return json({ error: 'Sessão ausente ou revogada.' }, 401);
    if (!session.permissions.edit) return json({ error: 'Sem permissão de edição.' }, 403);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
    if (!body || !isUuid(body.contractId) || typeof body.stage !== 'string'
      || !Object.hasOwn(WEBSITE_PRODUCTION_STAGES, body.stage) || body.stage === 'completed'
      || !Number.isSafeInteger(body.version) || body.version < 1) return json({ error: 'Confira contratação, etapa e versão.' }, 400);
    const result = await db.rpc('holding_advance_website_production', {
      p_actor: session.user.email, p_contract_id: body.contractId, p_stage: body.stage, p_version: body.version,
    });
    if (result.error) {
      console.error('[WEBSITE PRODUCTION] Avanço não confirmado.', { code: result.error.code });
      return json({ error: result.error.code === 'P0001' ? result.error.message : 'Etapa não confirmada. Atualize o projeto.' }, 409);
    }
    return json(result.data);
  } catch {
    console.error('[WEBSITE PRODUCTION] Atualização interrompida.');
    return json({ error: 'Não foi possível atualizar a evolução na Holding.' }, 503);
  }
}
