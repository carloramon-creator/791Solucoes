import { supabaseServer as db } from '@/lib/supabase-server';

export async function websiteProjects(email: string, manager: boolean) {
  let query = db.from('holding_website_contracts')
    .select('id,customer_id,customer_snapshot,plan_snapshot,project_type,designer_email')
    .not('project_type', 'is', null);
  if (!manager) query = query.eq('designer_email', email.trim().toLowerCase());
  const { data, error } = await query.order('created_at');
  if (error) throw error;
  if (!data.length) return [];
  const subscriptions = await db.from('holding_website_subscriptions').select('contract_id,customer_id')
    .in('contract_id', data.map((contract) => contract.id)).eq('lifecycle_status', 'active');
  if (subscriptions.error) throw subscriptions.error;
  return data.filter((contract) => subscriptions.data.some((subscription) =>
    subscription.contract_id === contract.id && subscription.customer_id === contract.customer_id))
    .map((contract) => ({
      contractId: contract.id, customerId: contract.customer_id,
      customerName: contract.customer_snapshot.name, planName: contract.plan_snapshot.name,
      scope: contract.plan_snapshot.scope, websiteType: contract.project_type,
      designerEmail: contract.designer_email,
    }));
}
