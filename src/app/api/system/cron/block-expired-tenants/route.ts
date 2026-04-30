import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  try {
    // 1. Validar chave secreta (para evitar que qualquer um chame a URL)
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const glassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
    const glassServiceKey = process.env.SUPABASE_GLASS_SERVICE_ROLE_KEY!;
    const glassSupabase = createClient(glassUrl, glassServiceKey);

    // 2. Buscar vidraçarias ativas cujo vencimento foi há mais de 10 dias
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const deadlineStr = tenDaysAgo.toISOString().split('T')[0];

    console.log(`[CRON] Verificando vidraçarias vencidas antes de ${deadlineStr}`);

    const { data: expired, error: fetchError } = await glassSupabase
      .from('vidracarias')
      .select('id, nome, vencimento_assinatura')
      .eq('ativa', true)
      .lt('vencimento_assinatura', deadlineStr);

    if (fetchError) throw fetchError;

    if (!expired || expired.length === 0) {
      return NextResponse.json({ message: 'Nenhuma vidraçaria para bloquear hoje.' });
    }

    // 3. Bloquear as vidraçarias encontradas
    const idsToBlock = expired.map(v => v.id);
    
    const { error: updateError } = await glassSupabase
      .from('vidracarias')
      .update({ 
        ativa: false, 
        status_assinatura: 'bloqueada',
        updated_at: new Date().toISOString()
      })
      .in('id', idsToBlock);

    if (updateError) throw updateError;

    console.log(`[CRON] Bloqueadas ${idsToBlock.length} vidraçarias:`, idsToBlock);

    // --- BLOQUEIO DE PATROCINADORES (HOLDING) ---
    const holdingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const holdingServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const holdingSupabase = createClient(holdingUrl, holdingServiceKey);

    console.log(`[CRON] Verificando patrocinadores vencidos antes de ${deadlineStr}`);

    const { data: expiredSponsors, error: fetchSponsorError } = await holdingSupabase
      .from('patrocinadores')
      .select('id, nome')
      .eq('status', 'ativo')
      .lt('data_expiracao', deadlineStr);

    if (fetchSponsorError) throw fetchSponsorError;

    if (expiredSponsors && expiredSponsors.length > 0) {
      const sponsorIds = expiredSponsors.map(s => s.id);
      await holdingSupabase
        .from('patrocinadores')
        .update({ 
          status: 'bloqueado',
          updated_at: new Date().toISOString()
        })
        .in('id', sponsorIds);
      
      console.log(`[CRON] Bloqueados ${sponsorIds.length} patrocinadores:`, sponsorIds);
    }

    return NextResponse.json({ 
      success: true, 
      blockedTenantsCount: idsToBlock.length,
      blockedSponsorsCount: expiredSponsors?.length || 0,
      details: { tenants: expired, sponsors: expiredSponsors }
    });

  } catch (err: any) {
    console.error('[CRON ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
