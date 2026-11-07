import { supabaseServer as db } from '@/lib/supabase-server';
import { isWebsiteFeature, websiteDefaultFeatures, WEBSITE_FEATURES, type WebsiteFeature, type WebsiteProjectType } from '@/lib/website-plans';

export async function websiteProjects(email: string, manager: boolean, contractId?: string) {
  let query = db.from('holding_website_contracts')
    .select('id,customer_id,customer_snapshot,plan_snapshot,project_type,designer_email,edit_revision')
    .not('project_type', 'is', null);
  if (!manager) query = query.eq('designer_email', email.trim().toLowerCase());
  if (contractId) query = query.eq('id', contractId);
  query = query.order('created_at').order('id');
  const eligible = [];
  for (let offset = 0; ; offset += 500) {
    const contracts = await query.range(offset, offset + 499);
    if (contracts.error) throw contracts.error;
    for (let start = 0; start < contracts.data.length; start += 100) {
      const batch = contracts.data.slice(start, start + 100);
      const active = new Set<string>();
      for (let page = 0; ; page += 500) {
        const subscriptions = await db.from('holding_website_subscriptions').select('id,contract_id,customer_id')
          .in('contract_id', batch.map((contract) => contract.id)).eq('lifecycle_status', 'active')
          .order('id').range(page, page + 499);
        if (subscriptions.error) throw subscriptions.error;
        subscriptions.data.forEach((row) => active.add(`${row.contract_id}:${row.customer_id}`));
        if (subscriptions.data.length < 500) break;
      }
      eligible.push(...batch.filter((contract) => active.has(`${contract.id}:${contract.customer_id}`)));
    }
    if (contracts.data.length < 500) break;
  }
  return eligible
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
        translationMonthlyCharacters: websiteFeatures.includes('translation') ? contract.plan_snapshot.translation_monthly_characters : 0,
        designerEmail: contract.designer_email,
        scopeRevision: contract.edit_revision || 0,
      };
    });
}
