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

    const { data: usedVouchers } = await holdingSupabase
      .from('vouchers')
      .select('usado_por_vidracaria_id')
      .eq('patrocinador_id', sponsorId)
      .not('usado_por_vidracaria_id', 'is', null);

    const vidracariaIdsFromVouchers = usedVouchers?.map(v => v.usado_por_vidracaria_id) || [];

    // 2. Buscar Vidraçarias do Patrocinador (Banco GLASS)
    // Filtramos por patrocinador_id OU por IDs que usaram voucher
    let query = glassSupabase
      .from('vidracarias')
      .select('id, nome, valor_plano, email');

    if (vidracariaIdsFromVouchers.length > 0) {
      // Formata os IDs com aspas para o filtro .in.("id1","id2")
      const idsString = vidracariaIdsFromVouchers.map(id => `"${id}"`).join(',');
      query = query.or(`patrocinador_id.eq.${sponsorId},id.in.(${idsString})`);
    } else {
      query = query.eq('patrocinador_id', sponsorId);
    }

    const { data: vidracarias, error: vError } = await query;

    if (vError) console.error('Erro vidracarias:', vError);

    // 3. Buscar Templates do Patrocinador
    const { data: templates, error: tError } = await glassSupabase
      .from('projeto_templates')
      .select('id, nome')
      .eq('patrocinador_id', sponsorId);

    if (tError) console.error('Erro templates:', tError);

    return NextResponse.json({
      success: true,
      vidracarias: vidracarias || [],
      templates: templates || []
    });

  } catch (err: any) {
    console.error('[SPONSOR DETAILS ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
