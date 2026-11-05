import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';
import { supabaseServer as db } from '@/lib/supabase-server';
import { isUuid } from '@/lib/holding-customers';

async function authorize(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const permissions = await getHoldingWebsitesPermissions(auth.user.email);
  if (!permissions.menu || !permissions.view || !permissions.manage) {
    return NextResponse.json({ error: 'Sem permissão para distribuir projetos.' }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    const [contracts, assignments, subscriptions] = await Promise.all([
      db.from('holding_website_contracts').select('id,customer_snapshot,plan_snapshot,project_type,designer_email').order('created_at'),
      db.from('holding_user_permission_profiles').select('user_email').order('user_email'),
      db.from('holding_website_subscriptions').select('id,contract_id,lifecycle_status'),
    ]);
    if (contracts.error) throw contracts.error;
    if (assignments.error) throw assignments.error;
    if (subscriptions.error) throw subscriptions.error;
    const emails = [...new Set(assignments.data.map((row) => row.user_email as string))];
    const checks = await Promise.all(emails.map(async (email) => ({ email, permissions: await getHoldingWebsitesPermissions(email) })));
    const designers = checks.filter(({ permissions }) => permissions.menu && permissions.view && permissions.edit).map(({ email }) => email);
    const members = designers.length ? await db.from('equipe_791').select('email,nome').in('email', designers) : { data: [], error: null };
    if (members.error) throw members.error;
    return NextResponse.json({ contracts: contracts.data.map((contract) => ({
      ...contract, holding_website_subscriptions: subscriptions.data.filter((subscription) => subscription.contract_id === contract.id),
    })), designers, designer_options: designers.map((email) => ({
      email, name: members.data?.find((member) => member.email === email)?.nome || email,
    })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    console.error('[WEBSITE PROJECTS] Falha ao carregar distribuição.');
    return NextResponse.json({ error: 'Não foi possível carregar a distribuição de projetos.' }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  try {
    const denied = await authorize(req);
    if (denied) return denied;
    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Envie um JSON válido.' }, { status: 400 });
    }
    if (!body || !isUuid(body.id) || typeof body.designer_email !== 'string') {
      return NextResponse.json({ error: 'Confira contratação e funcionário.' }, { status: 400 });
    }
    const email = body.designer_email.trim().toLowerCase();
    if (email) {
      const permissions = await getHoldingWebsitesPermissions(email);
      if (!permissions.menu || !permissions.view || !permissions.edit) {
        return NextResponse.json({ error: 'O funcionário precisa de acesso ativo de leitura e edição no Websites.' }, { status: 400 });
      }
    }
    const { data: contract, error: loadError } = await db.from('holding_website_contracts')
      .select('id,project_type,plan_id').eq('id', body.id).single();
    if (loadError || !contract) throw loadError || new Error('Contratação não encontrada.');
    const plan = await db.from('holding_website_plans').select('category,project_type').eq('id', contract.plan_id).single();
    if (plan.error) throw plan.error;
    if (plan.data.category !== 'creation' || (!contract.project_type && !plan.data.project_type)) {
      return NextResponse.json({ error: 'Defina o tipo de site no plano de criação antes de atribuir o projeto.' }, { status: 409 });
    }
    const { error } = await db.from('holding_website_contracts')
      .update({ designer_email: email || null }).eq('id', body.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch {
    console.error('[WEBSITE PROJECTS] Distribuição não salva.');
    return NextResponse.json({ error: 'Não foi possível salvar. Atualize e confira o tipo contratado.' }, { status: 409 });
  }
}
