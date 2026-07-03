import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function normalizeTemplateName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function generateVoucherCode(sponsorName: string) {
  const base = String(sponsorName || 'SPON').trim().toUpperCase().replace(/\s+/g, '');
  const prefix = (base || 'SPON').slice(0, 4);
  const random = Math.floor(1000 + Math.random() * 9000);
  const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
  return `791-${prefix}-${random}-${suffix}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sponsorId } = await params;

    // Conectar ao Banco GLASS
    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;
    const glassSupabase = createClient(glassUrl, glassServiceKey);

    // 1. Buscar Vidraçarias que usaram Vouchers deste Patrocinador (Banco HOLDING)
    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const holdingSupabase = createClient(holdingUrl, holdingServiceKey);

    // Buscar TODOS os vouchers do patrocinador (usados e não usados)
    const { data: initialVouchers } = await holdingSupabase
      .from('vouchers')
      .select('id, codigo, usado_por_vidracaria_id, usado_em, created_at')
      .eq('patrocinador_id', sponsorId)
      .order('created_at', { ascending: true });

    const usedVoucherIdsInitial = Array.from(new Set((initialVouchers || [])
      .filter(v => v.usado_por_vidracaria_id)
      .map(v => String(v.usado_por_vidracaria_id))));

    let existingTenantIdSet = new Set<string>();
    if (usedVoucherIdsInitial.length > 0) {
      const { data: existingGlassTenants, error: existingTenantsError } = await glassSupabase
        .from('vidracarias')
        .select('id')
        .in('id', usedVoucherIdsInitial);

      if (existingTenantsError) console.error('[GLASS TENANTS EXISTS ERROR]', existingTenantsError);
      existingTenantIdSet = new Set((existingGlassTenants || []).map((tenant: any) => String(tenant.id)));
    }

    // Se houver token "ativo" sem vidraçaria existente, recicla automaticamente.
    const orphanVouchers = (initialVouchers || []).filter((voucher) => {
      const tenantId = voucher.usado_por_vidracaria_id ? String(voucher.usado_por_vidracaria_id) : '';
      return Boolean(tenantId) && !existingTenantIdSet.has(tenantId);
    });

    if (orphanVouchers.length > 0) {
      const { data: sponsor } = await holdingSupabase
        .from('patrocinadores')
        .select('nome')
        .eq('id', sponsorId)
        .single();

      const orphanIds = orphanVouchers.map((voucher) => voucher.id);
      await holdingSupabase.from('vouchers').delete().in('id', orphanIds);

      const replacementVouchers = Array.from({ length: orphanVouchers.length }, () => ({
        codigo: generateVoucherCode(sponsor?.nome || 'SPON'),
        patrocinador_id: sponsorId,
      }));

      if (replacementVouchers.length > 0) {
        await holdingSupabase.from('vouchers').insert(replacementVouchers);
      }
    }

    const { data: allVouchers } = await holdingSupabase
      .from('vouchers')
      .select('id, codigo, usado_por_vidracaria_id, usado_em, created_at')
      .eq('patrocinador_id', sponsorId)
      .order('created_at', { ascending: true });

    const usedVoucherIds = Array.from(new Set((allVouchers || [])
      .filter(v => v.usado_por_vidracaria_id)
      .map(v => String(v.usado_por_vidracaria_id))));

    // 2. Buscar nomes das vidraçarias no Glass (para enriquecer os tokens)
    let vidracariaMap: Record<string, { nome: string; email: string }> = {};
    if (usedVoucherIds.length > 0) {
      const { data: glassTenants, error: gtError } = await glassSupabase
        .from('vidracarias')
        .select('id, nome, email')
        .in('id', usedVoucherIds);

      if (gtError) console.error('[GLASS TENANTS BY ID ERROR]', gtError);

      (glassTenants || []).forEach(v => {
        vidracariaMap[v.id] = { nome: v.nome, email: v.email };
      });
    }

    // Montar lista de tokens enriquecida
    const tokens = (allVouchers || []).map(v => ({
      id: v.id,
      codigo: v.codigo,
      usado: !!v.usado_por_vidracaria_id && !!vidracariaMap[String(v.usado_por_vidracaria_id)]?.nome,
      data_ativacao: !!v.usado_por_vidracaria_id && !!vidracariaMap[String(v.usado_por_vidracaria_id)]?.nome ? (v.usado_em || null) : null,
      created_at: v.created_at,
      vidracaria_id: v.usado_por_vidracaria_id || null,
      vidracaria_nome: v.usado_por_vidracaria_id ? (vidracariaMap[v.usado_por_vidracaria_id]?.nome || null) : null,
      vidracaria_email: v.usado_por_vidracaria_id ? (vidracariaMap[v.usado_por_vidracaria_id]?.email || null) : null,
    }));

    // 3. Buscar Vidraçarias do Patrocinador (compatibilidade)
    let vidracarias: any[] = [];
    if (usedVoucherIds.length > 0) {
      const { data, error: vError } = await glassSupabase
        .from('vidracarias')
        .select('id, nome, email')
        .in('id', usedVoucherIds);
      if (vError) console.error('Erro vidracarias:', vError);
      else vidracarias = data || [];
    }

    // 4. Buscar Templates do Patrocinador
    const { data: templates, error: tError } = await glassSupabase
      .from('projeto_templates')
      .select('id, nome')
      .eq('patrocinador_id', sponsorId);

    if (tError) console.error('Erro templates:', tError);

    const uniqueTemplatesMap = new Map<string, any>();
    (templates || []).forEach((template) => {
      const key = normalizeTemplateName(template?.nome);
      if (!key) return;
      if (!uniqueTemplatesMap.has(key)) {
        uniqueTemplatesMap.set(key, template);
      }
    });

    const uniqueTemplates = Array.from(uniqueTemplatesMap.values());

    return NextResponse.json({
      success: true,
      tokens: tokens,
      vidracarias: vidracarias,
      templates: uniqueTemplates
    });

  } catch (err: any) {
    console.error('[SPONSOR DETAILS ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
