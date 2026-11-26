import { NextResponse } from 'next/server';
import { getGlassClient } from '@/lib/glass-client';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';

const NOTIFICATION_PERMISSION = 'action.assinaturas.new_tenant_notification';
const json = (body: object, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    const [canReceive, canOpenSubscriptions] = await Promise.all([
      hasExplicitHoldingPermission(auth.user.email, [NOTIFICATION_PERMISSION]),
      hasExplicitHoldingPermission(auth.user.email, ['menu.assinaturas']),
    ]);
    if (!canReceive) {
      return json({ error: 'Sem permissão para receber avisos de novos tenants Glass.' }, 403);
    }

    const since = new URL(req.url).searchParams.get('since');
    if (since && !Number.isFinite(Date.parse(since))) {
      return json({ error: 'Cursor de data inválido.' }, 400);
    }

    const glass = await getGlassClient();
    let query = glass
      .from('vidracarias')
      .select('id, nome, nome_fantasia, slug, email, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(since ? 50 : 1);
    if (since) query = query.gt('created_at', since);

    const { data, error } = await query;
    if (error) {
      console.error('[TENANT NOTIFICATIONS] Falha ao consultar o Glass.', { code: error.code });
      return json({ error: 'Não foi possível consultar novos tenants no Glass.' }, 503);
    }

    return json({
      userEmail: auth.user.email,
      tenants: data || [],
      canOpenSubscriptions,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[TENANT NOTIFICATIONS] Verificação interrompida.', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Não foi possível verificar novos tenants.' }, 503);
  }
}
