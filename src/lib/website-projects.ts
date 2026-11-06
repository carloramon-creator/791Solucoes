import { supabaseServer as db } from '@/lib/supabase-server';
import { isWebsiteFeature, websiteDefaultFeatures, WEBSITE_FEATURES, type WebsiteFeature, type WebsiteProjectType } from '@/lib/website-plans';

export async function websiteProjects(email: string, manager: boolean, contractId?: string) {
  let query = db.from('holding_website_contracts')
    .select('id,customer_id,customer_snapshot,plan_snapshot,project_type,designer_email,edit_revision')
    .not('project_type', 'is', null);
  if (!manager) query = query.eq('designer_email', email.trim().toLowerCase());
  if (contractId) query = query.eq('id', contractId);
  const { data, error } = await query.order('created_at');
  if (error) throw error;
  if (!data.length) return [];
  const subscriptions = await db.from('holding_website_subscriptions').select('contract_id,customer_id')
    .in('contract_id', data.map((contract) => contract.id)).eq('lifecycle_status', 'active');
  if (subscriptions.error) throw subscriptions.error;
  return data.filter((contract) => subscriptions.data.some((subscription) =>
    subscription.contract_id === contract.id && subscription.customer_id === contract.customer_id))
    .map((contract) => {
      const savedFeatures = contract.plan_snapshot.website_features;
      let websiteFeatures: WebsiteFeature[];
      if (savedFeatures === undefined) {
        websiteFeatures = websiteDefaultFeatures(contract.project_type as WebsiteProjectType);
      } else if (Array.isArray(savedFeatures)) {
        websiteFeatures = savedFeatures.map((feature: unknown) => {
          if (!isWebsiteFeature(feature) || !WEBSITE_FEATURES[feature].available) {
            throw new Error('Recursos inválidos no retrato da contratação de Websites.');
          }
          return feature;
        });
      } else {
        throw new Error('Recursos inválidos no retrato da contratação de Websites.');
      }
      return {
        contractId: contract.id, customerId: contract.customer_id,
        customerName: contract.customer_snapshot.name, planName: contract.plan_snapshot.name,
        scope: contract.plan_snapshot.scope, websiteType: contract.project_type,
        websiteFeatures,
        designerEmail: contract.designer_email,
        scopeRevision: contract.edit_revision || 0,
      };
    });
}
