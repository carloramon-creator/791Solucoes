/** Reativa os módulos de WhatsApp removidos por inadimplência de excedente e marca o lançamento como desbloqueado. */
export async function restoreWhatsappModulesIfNeeded(params: {
  holdingSupabase: any;
  glassSupabase: any;
  recordId: string;
  metadata: Record<string, any>;
}) {
  const { holdingSupabase, glassSupabase, recordId, metadata } = params;

  const tenantId = String(metadata?.tenant_id || '');
  if (!tenantId) return;

  const removedModules: string[] = Array.isArray(metadata?.whatsapp_removed_modules)
    ? metadata.whatsapp_removed_modules.map((id: any) => String(id))
    : [];

  if (removedModules.length > 0) {
    const { data: tenant, error: tenantError } = await glassSupabase
      .from('vidracarias')
      .select('id, modulos_ativos')
      .eq('id', tenantId)
      .single();

    if (!tenantError && tenant) {
      const currentModules = Array.isArray(tenant.modulos_ativos)
        ? tenant.modulos_ativos.map((id: any) => String(id))
        : [];

      const merged = Array.from(new Set([...currentModules, ...removedModules]));

      await glassSupabase
        .from('vidracarias')
        .update({
          modulos_ativos: merged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantId);
    }
  }

  await holdingSupabase
    .from('system_finance_records')
    .update({
      metadata: {
        ...metadata,
        whatsapp_block_status: 'unblocked',
        whatsapp_unblocked_at: new Date().toISOString(),
      },
    })
    .eq('id', recordId);
}
