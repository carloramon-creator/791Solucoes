import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { getGlassClient } from '@/lib/glass-client';
import { GLASS_COMBOS, comboOfRoot, comboPrice, computeGlassSubscription, rootOfSlug } from '@/lib/glass-pricing';
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
    const blockedRoots = new Set((blocksResult.data || [])
      .filter((b) => b.whatsapp_bloqueado_em)
      .flatMap((b) => (b.modulos_removidos || []).map((slug: string) => rootOfSlug(slug, modules))));
    const rootName = (slug: string) => modules.find((m) => m.slug === slug && !m.parent_slug)?.nome || slug;

    // Plano base (sempre ligado) + um item por combo cobrado.
    const rows = [
      {
        id: 'base',
        nome: 'Plano base (Standard)',
        price: Number(plan?.base_price || 0),
        sponsored: Boolean(sponsorName),
        active: true,
        locked: true,
        blockedByOverage: false,
        modulos: modules.filter((m) => !m.parent_slug && m.slug && !comboOfRoot(String(m.slug))).map((m) => m.nome),
      },
      ...GLASS_COMBOS.map((combo) => ({
        id: combo.id,
        nome: combo.nome,
        price: comboPrice(plan, combo.id),
        active: combo.roots.some((root) => active.has(root)),
        locked: false,
        blockedByOverage: combo.roots.some((root) => blockedRoots.has(root)),
        modulos: combo.roots.map(rootName),
      })),
    ];

    return NextResponse.json({
      tenant,
      sponsorName,
      pricing,
      modules: rows,
      blocks: blocksResult.data || [],
      invoices,
      warnings,
      permissions: { modules: canModules, invoices: canInvoices },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao carregar o painel.' }, { status: 500 });
  }
}
