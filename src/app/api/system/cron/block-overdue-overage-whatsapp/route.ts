import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasExceededGraceDays(dueDate: Date, graceDays: number) {
  const threshold = new Date(dueDate);
  threshold.setDate(threshold.getDate() + graceDays);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today > threshold;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;

    const holdingSupabase = createClient(holdingUrl, holdingServiceKey);
    const glassSupabase = createClient(glassUrl, glassServiceKey);

    const { data: rows, error: rowsError } = await holdingSupabase
      .from('system_finance_records')
      .select('id, status, metadata')
      .eq('metadata->>kind', 'overage');

    if (rowsError) throw rowsError;

    const { data: whatsappModules, error: modulesError } = await glassSupabase
      .from('modules')
      .select('id, slug, nome')
      .or('slug.ilike.%whatsapp%,nome.ilike.%whatsapp%');

    if (modulesError) throw modulesError;

    const whatsappModuleIds = new Set((whatsappModules || []).map((m: any) => String(m.id)));
    const blockedTenantIds: string[] = [];

    for (const row of rows || []) {
      const status = String(row.status || '').toLowerCase();
      if (status === 'paid') continue;

      const metadata = (row.metadata && typeof row.metadata === 'object') ? row.metadata as any : {};
      if (String(metadata.whatsapp_block_status || '') === 'blocked') continue;

      const tenantId = String(metadata.tenant_id || '');
      const dueDate = toDate(String(metadata.due_date || ''));
      if (!tenantId || !dueDate) continue;
      if (!hasExceededGraceDays(dueDate, 5)) continue;

      const { data: tenant, error: tenantError } = await glassSupabase
        .from('vidracarias')
        .select('id, modulos_ativos')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant) continue;

      const activeModules: string[] = Array.isArray(tenant.modulos_ativos)
        ? tenant.modulos_ativos.map((id: any) => String(id))
        : [];

      const removedModules = activeModules.filter((id) => whatsappModuleIds.has(id));
      const remainingModules = activeModules.filter((id) => !whatsappModuleIds.has(id));

      if (removedModules.length > 0) {
        const { error: updateTenantError } = await glassSupabase
          .from('vidracarias')
          .update({
            modulos_ativos: remainingModules,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        if (updateTenantError) continue;
      }

      const { error: updateFinanceError } = await holdingSupabase
        .from('system_finance_records')
        .update({
          metadata: {
            ...metadata,
            whatsapp_block_status: 'blocked',
            whatsapp_blocked_at: new Date().toISOString(),
            whatsapp_removed_modules: removedModules,
            whatsapp_block_reason: 'overage_overdue_5_days',
          },
        })
        .eq('id', row.id);

      if (updateFinanceError) continue;

      blockedTenantIds.push(tenantId);
    }

    return NextResponse.json({
      success: true,
      blockedCount: blockedTenantIds.length,
      blockedTenantIds,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Falha ao bloquear WhatsApp por excedente em atraso.' }, { status: 500 });
  }
}
