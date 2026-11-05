import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';
import { supabaseServer as db } from '@/lib/supabase-server';

export async function approveWebsiteSubscription(req: Request, id: string) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) throw new Error('Sessão administrativa inválida.');
  const permissions = await getHoldingWebsitesPermissions(auth.user.email);
  if (!permissions.manage) {
    const approval = await db.rpc('holding_website_permission', { p_email: auth.user.email, p_code: 'action.websites.approve' });
    if (approval.error) throw new Error('Não foi possível verificar a permissão de aprovação.');
    if (approval.data !== true) throw new Error('Somente gestor ou comercial autorizado pode ativar assinaturas após aprovação do cliente.');
  }
  const { error } = await db.rpc('holding_approve_website_delivery', {
    p_actor: auth.user.email?.trim().toLowerCase(), p_user_id: auth.user.id, p_subscription_id: id,
  });
  if (error) {
    console.error('[WEBSITE APPROVAL] Aprovação transacional não confirmada.', { code: error.code });
    throw new Error(error.code === 'P0001' ? error.message : 'A aprovação e a produtividade não foram confirmadas. Atualize antes de continuar.');
  }
}
