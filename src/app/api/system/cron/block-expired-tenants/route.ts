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

    return NextResponse.json({ 
      success: true, 
      blockedCount: idsToBlock.length,
      details: expired
    });

  } catch (err: any) {
    console.error('[CRON ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
