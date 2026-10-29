import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * O bloqueio por excedente vencido roda sozinho no banco do glass (pg_cron diário, função
 * aplicar_bloqueios_excedente). Esta rota só antecipa a execução, se for chamada.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (!process.env.CRON_SECRET || searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const glassSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!,
    process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await glassSupabase.rpc('aplicar_bloqueios_excedente', { p_carencia_dias: 5 });
  if (error) {
    return NextResponse.json({ error: error.message || 'Falha ao aplicar bloqueios de excedente.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, blockedCount: Number(data || 0) });
}
