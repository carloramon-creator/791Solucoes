import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { getGlassClient } from '@/lib/glass-client';
import { comboOfRoot, computeGlassSubscription, rootOfSlug } from '@/lib/glass-pricing';
import { loadTenantContext, loadTenantInvoices } from '@/lib/glass-tenant-billing';

/** Painel de controle do tenant: módulos, bloqueios por excedente e faturas. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  try {
    const glass = await getGlassClient();
    const [{ tenant, modules, plan, sponsorName }, blocksResult, canModules, canInvoices] = await Promise.all([
      loadTenantContext(glass, id),
      glass.from('billing_bloqueios_excedente')
        .select('finance_record_id, ref_month, valor, vencimento, bloqueia_whatsapp, bloqueia_consultflex, whatsapp_bloqueado_em, modulos_removidos')
        .eq('vidracaria_id', id)
        .eq('status', 'pending'),
      userCanAccessResource(auth.user.email, 'menu.assinaturas'),
      userCanAccessResource(auth.user.email, 'menu.financeiro'),
    ]);
    if (!tenant) return NextResponse.json({ error: 'Vidraçaria não encontrada.' }, { status: 404 });

    const { invoices, warnings } = await loadTenantInvoices(id, tenant);
    const pricing = computeGlassSubscription({ tenant, plan, modules, sponsored: Boolean(sponsorName) });

    const active = new Set((tenant.modulos_ativos || []).map((slug) => rootOfSlug(slug, modules)));
    const blockedSlugs = new Set((blocksResult.data || []).filter((b) => b.whatsapp_bloqueado_em).flatMap((b) => b.modulos_removidos || []));

    const rootModules = modules
      .filter((m) => !m.parent_slug && m.slug)
      .map((m) => {
        const slug = String(m.slug);
        const combo = comboOfRoot(slug);
        return {
          slug,
          nome: m.nome,
          active: active.has(slug),
          comboId: combo?.id || null,
          comboNome: combo?.nome || null,
          base: !combo,
          locked: slug === 'configuracoes',
          blockedByOverage: blockedSlugs.has(slug),
          menus: modules.filter((child) => child.parent_slug === slug).length,
        };
      });

    return NextResponse.json({
      tenant,
      sponsorName,
      pricing,
      modules: rootModules,
      blocks: blocksResult.data || [],
      invoices,
      warnings,
      permissions: { modules: canModules, invoices: canInvoices },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao carregar o painel.' }, { status: 500 });
  }
}
