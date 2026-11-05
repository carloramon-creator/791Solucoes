import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';
import { supabaseServer as db } from '@/lib/supabase-server';

export async function approveWebsiteSubscription(req: Request, id: string) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) throw new Error('Sessão administrativa inválida.');
  const permissions = await getHoldingWebsitesPermissions(auth.user.email);
  if (!permissions.manage) throw new Error('Somente gestores autorizados podem ativar assinaturas após aprovação do cliente.');
  const { data: row, error } = await db.from('holding_website_subscriptions')
    .select('approval_status,billing_state,lifecycle_status').eq('id', id).single();
  if (error || !row) throw new Error('Não foi possível verificar a aprovação da assinatura.');
  if (row.billing_state !== 'local' || row.lifecycle_status !== 'active') {
    throw new Error('Assinatura não está disponível para ativação. Atualize e consulte sua situação.');
  }
  if (row.approval_status === 'approved') return;
  const { data, error: saveError } = await db.from('holding_website_subscriptions')
    .update({ approval_status: 'approved', approved_at: new Date().toISOString(), approved_by: auth.user.id })
    .eq('id', id).eq('approval_status', 'pending').eq('billing_state', 'local').eq('lifecycle_status', 'active')
    .select('id').maybeSingle();
  if (saveError || !data) throw new Error('A aprovação não foi confirmada. Atualize antes de continuar.');
}
