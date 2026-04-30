import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * CRON: RENOVAÇÃO AUTOMÁTICA DE PATROCINADORES
 * Executa diariamente para cobrar patrocinadores 7 dias antes do vencimento.
 */
export async function GET(req: Request) {
  try {
    // 1. Validar chave secreta
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 2. Definir a data alvo (hoje + 7 dias)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 7);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    console.log(`[CRON SPONSOR] Buscando patrocinadores que vencem em ${targetDateStr}`);

    // 3. Buscar patrocinadores que vencem na data alvo e ainda não foram cobrados neste ciclo
    const { data: sponsors, error: fetchError } = await supabase
      .from('patrocinadores')
      .select('*')
      .eq('status', 'ativo')
      .eq('data_expiracao', targetDateStr)
      .or(`ultima_cobranca_gerada.is.null,ultima_cobranca_gerada.neq.${new Date().toISOString().split('T')[0]}`);

    if (fetchError) throw fetchError;

    if (!sponsors || sponsors.length === 0) {
      return NextResponse.json({ message: 'Nenhum patrocinador para cobrar hoje.' });
    }

    const results = [];

    // 4. Gerar cobrança para cada um
    for (const sponsor of sponsors) {
      try {
        console.log(`[CRON SPONSOR] Gerando cobrança para: ${sponsor.nome}`);
        
        // Chamamos a nossa própria API de cobrança (internamente ou via fetch)
        // Por ser uma rota de API Next.js, o ideal é extrair a lógica ou fazer um fetch interno
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const chargeRes = await fetch(`${baseUrl}/api/payments/asaas/create-sponsor-charge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patrocinadorId: sponsor.id,
            nome: sponsor.nome,
            email: sponsor.email,
            cpfCnpj: sponsor.cpf_cnpj,
            telefone: sponsor.telefone,
            valor: sponsor.valor_mensal,
            description: `Renovação de Patrocínio 791glass - ${sponsor.nome}`,
            parcelas: 12
          })
        });

        const chargeData = await chargeRes.json();

        if (chargeData.success) {
          // Atualiza a data da última cobrança gerada para evitar duplicidade
          await supabase
            .from('patrocinadores')
            .update({ ultima_cobranca_gerada: new Date().toISOString().split('T')[0] })
            .eq('id', sponsor.id);
          
          results.push({ sponsor: sponsor.nome, success: true, url: chargeData.invoiceUrl });
        } else {
          results.push({ sponsor: sponsor.nome, success: false, error: chargeData.error });
        }
      } catch (err: any) {
        results.push({ sponsor: sponsor.nome, success: false, error: err.message });
      }
    }

    return NextResponse.json({ 
      success: true, 
      processedCount: sponsors.length,
      details: results
    });

  } catch (err: any) {
    console.error('[CRON SPONSOR ERROR]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
