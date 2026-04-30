import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sponsorId = params.id;

    // Conectar ao Banco GLASS
    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;
    const glassSupabase = createClient(glassUrl, glassServiceKey);

    // 1. Buscar Vidraçarias do Patrocinador
    const { data: vidracarias, error: vError } = await glassSupabase
      .from('vidracarias')
      .select('id, nome, valor_plano')
      .eq('patrocinador_id', sponsorId);

    if (vError) console.error('Erro vidracarias:', vError);

    // 2. Buscar Templates do Patrocinador
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
