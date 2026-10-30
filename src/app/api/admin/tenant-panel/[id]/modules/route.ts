import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { getGlassClient } from '@/lib/glass-client';
import { GLASS_COMBOS, computeGlassSubscription, rootOfSlug } from '@/lib/glass-pricing';
import {
  findTenantAsaasCustomers,
  getAsaasClient,
  listTenantAsaasSubscriptions,
  loadTenantContext,
} from '@/lib/glass-tenant-billing';

function asaasErrorMessage(err: unknown) {
  const data = (err as { response?: { data?: { errors?: Array<{ description?: string }> } } })?.response?.data;
  return data?.errors?.[0]?.description || (err instanceof Error ? err.message : 'Falha na comunicação com o Asaas.');
}

/**
 * Liga/desliga um combo do tenant (todos os módulos e menus dele) e recalcula
 * o valor das próximas mensalidades na assinatura ativa do Asaas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (!(await userCanAccessResource(auth.user.email, 'menu.assinaturas'))) {
    return NextResponse.json({ success: false, error: 'Sem permissão para alterar módulos.' }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }
  const comboId = String(body?.combo || '').trim();
  const enabled = body?.enabled === true;
  if (!comboId || typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ success: false, error: 'Combo não informado.' }, { status: 400 });
  }
  if (comboId === 'base') {
    return NextResponse.json({ success: false, error: 'O plano base não pode ser desligado.' }, { status: 400 });
  }
  const combo = GLASS_COMBOS.find((c) => c.id === comboId);
  if (!combo) return NextResponse.json({ success: false, error: 'Combo inválido.' }, { status: 400 });

  const glass = await getGlassClient();
  const { tenant, modules, plan, sponsorName } = await loadTenantContext(glass, id);
  if (!tenant) return NextResponse.json({ success: false, error: 'Vidraçaria não encontrada.' }, { status: 404 });
  const roots = new Set(combo.roots);
  const current = tenant.modulos_ativos || [];
  const family = modules
    .filter((m) => m.slug && roots.has(String(m.parent_slug || m.slug)))
    .map((m) => String(m.slug));
  if (family.length === 0) return NextResponse.json({ success: false, error: 'Combo sem módulos cadastrados.' }, { status: 400 });
  const nextModules = enabled
    ? [...new Set([...current, ...family])]
    : current.filter((slug) => !roots.has(rootOfSlug(slug, modules)));
  const removed = current.filter((slug) => !nextModules.includes(slug));

  if (enabled ? family.every((slug) => current.includes(slug)) : removed.length === 0) {
    return NextResponse.json({ success: true, unchanged: true });
  }

  const sponsored = Boolean(sponsorName);
  const before = computeGlassSubscription({ tenant, plan, modules, sponsored }).total;
  const after = computeGlassSubscription({ tenant: { ...tenant, modulos_ativos: nextModules }, plan, modules, sponsored }).total;
  const warnings: string[] = [];

  // Assinatura recorrente (mensal) no Asaas: ajusta o valor antes de mexer no acesso, para poder desfazer.
  const updatedSubscriptions: Array<{ id: string; value: number }> = [];
  let asaas: Awaited<ReturnType<typeof getAsaasClient>> = null;
  if (after !== before) {
    asaas = await getAsaasClient();
    if (!asaas) {
      warnings.push('Integração com o Asaas não configurada: o valor da assinatura não foi ajustado.');
    } else {
      try {
        const customers = await findTenantAsaasCustomers(asaas, tenant);
        const subscriptions = await listTenantAsaasSubscriptions(asaas, customers, id);
        for (const sub of subscriptions) {
          await asaas.updateSubscriptionValue(sub.id, after);
          updatedSubscriptions.push({ id: sub.id, value: Number(sub.value || 0) });
        }
        if (subscriptions.length === 0) {
          warnings.push('Sem assinatura recorrente ativa no Asaas: o novo valor vale para a próxima cobrança gerada.');
        }
      } catch (err) {
        for (const sub of updatedSubscriptions) {
          await asaas.updateSubscriptionValue(sub.id, sub.value).catch(() => null);
        }
        return NextResponse.json({ success: false, error: `Asaas: ${asaasErrorMessage(err)}. Nada foi alterado.` }, { status: 502 });
      }
    }
  }

  let query = glass.from('vidracarias').update({ modulos_ativos: nextModules, updated_at: new Date().toISOString() }).eq('id', id);
  query = tenant.updated_at ? query.eq('updated_at', tenant.updated_at) : query.is('updated_at', null);
  const { data: updatedRows, error: updateError } = await query.select('id');

  if (updateError || !updatedRows?.length) {
    if (asaas) {
      for (const sub of updatedSubscriptions) {
        await asaas.updateSubscriptionValue(sub.id, sub.value).catch(() => null);
      }
    }
    return NextResponse.json({
      success: false,
      error: updateError?.message || 'O cadastro foi alterado por outro processo. Recarregue o painel e tente de novo.',
    }, { status: updateError ? 500 : 409 });
  }

  // Desligado à mão: o bloqueio por excedente não pode devolver o módulo quando a cobrança for paga.
  if (!enabled) {
    const { data: blocks } = await glass
      .from('billing_bloqueios_excedente')
      .select('finance_record_id, modulos_removidos')
      .eq('vidracaria_id', id)
      .eq('status', 'pending');
    for (const block of blocks || []) {
      const list: string[] = block.modulos_removidos || [];
      const kept = list.filter((slug) => !roots.has(rootOfSlug(slug, modules)));
      if (kept.length !== list.length) {
        await glass.from('billing_bloqueios_excedente')
          .update({ modulos_removidos: kept, updated_at: new Date().toISOString() })
          .eq('finance_record_id', block.finance_record_id);
      }
    }
  }

  console.log(`[TENANT PANEL] ${auth.user.email} ${enabled ? 'ligou' : 'desligou'} combo ${comboId} em ${id} (valor ${before} -> ${after})`);
  return NextResponse.json({
    success: true,
    valueBefore: before,
    valueAfter: after,
    subscriptionsUpdated: updatedSubscriptions.length,
    warnings,
  });
}
