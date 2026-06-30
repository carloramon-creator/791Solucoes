import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const { data: allVouchers } = await holdingSupabase
      .from('vouchers')
      .select('id, codigo, usado_por_vidracaria_id, usado_em, created_at')
      .eq('patrocinador_id', sponsorId)
      .order('created_at', { ascending: true });

    const usedVoucherIds = (allVouchers || [])
      .filter(v => v.usado_por_vidracaria_id)
      .map(v => v.usado_por_vidracaria_id);

    // 2. Buscar nomes das vidraçarias no Glass (para enriquecer os tokens)
    let vidracariaMap: Record<string, { nome: string; email: string; valor_plano: number }> = {};
    if (usedVoucherIds.length > 0) {
      const { data: glassTenants, error: gtError } = await glassSupabase
        .from('vidracarias')
        .select('id, nome, email, valor_plano')
        .in('id', usedVoucherIds);

      if (gtError) console.error('[GLASS TENANTS BY ID ERROR]', gtError);

      (glassTenants || []).forEach(v => {
        vidracariaMap[v.id] = { nome: v.nome, email: v.email, valor_plano: v.valor_plano };
      });
    }

    // Fallback: buscar vidraçarias pelo patrocinador_id no Glass (caso voucher ID != vidraçaria ID)
    const { data: glassPatrTenants } = await glassSupabase
      .from('vidracarias')
      .select('id, nome, email, valor_plano')
      .eq('patrocinador_id', sponsorId);

    (glassPatrTenants || []).forEach(v => {
      if (!vidracariaMap[v.id]) {
        vidracariaMap[v.id] = { nome: v.nome, email: v.email, valor_plano: v.valor_plano };
      }
    });

    // Montar lista de tokens enriquecida
    const tokens = (allVouchers || []).map(v => ({
      id: v.id,
      codigo: v.codigo,
      usado: !!v.usado_por_vidracaria_id,
      data_ativacao: v.usado_em || null,
      created_at: v.created_at,
      vidracaria_id: v.usado_por_vidracaria_id || null,
      vidracaria_nome: v.usado_por_vidracaria_id ? (vidracariaMap[v.usado_por_vidracaria_id]?.nome || null) : null,
      vidracaria_email: v.usado_por_vidracaria_id ? (vidracariaMap[v.usado_por_vidracaria_id]?.email || null) : null,
    }));

    // 3. Buscar Vidraçarias do Patrocinador (compatibilidade)
    let query = glassSupabase
      .from('vidracarias')
      .select('id, nome, valor_plano, email');

    if (usedVoucherIds.length > 0) {
      const idsString = usedVoucherIds.map(id => `"${id}"`).join(',');
      query = query.or(`patrocinador_id.eq.${sponsorId},id.in.(${idsString})`);
    } else {
      query = query.eq('patrocinador_id', sponsorId);
    }

    const { data: vidracarias, error: vError } = await query;
    if (vError) console.error('Erro vidracarias:', vError);

    // 4. Buscar Templates do Patrocinador
    const { data: templates, error: tError } = await glassSupabase
      .from('projeto_templates')
      .select('id, nome')
      .eq('patrocinador_id', sponsorId);

    if (tError) console.error('Erro templates:', tError);

    return NextResponse.json({
      success: true,
      tokens: tokens,
      vidracarias: vidracarias || [],
      templates: templates || []
    });

  } catch (err: any) {
    console.error('[SPONSOR DETAILS ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
