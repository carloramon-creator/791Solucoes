import { NextResponse } from 'next/server';
import { validWebsitesSyncRequest } from '@/lib/websites-sync';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (!validWebsitesSyncRequest(request, text)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = JSON.parse(text);
    const { tenant_id, usuario_id, funcao, referencia_id, model, status, tokens_entrada, tokens_saida, tokens_total, http_status } = body;

    const tarifas: Record<string, { entrada: number; saida: number }> = {
      'gpt-4.1-mini': { entrada: 0.15, saida: 0.60 },
      'gpt-6-astra': { entrada: 2.50, saida: 10.00 },
      'gpt-6.1-sol': { entrada: 2.50, saida: 10.00 },
    };
    const tarifa = tarifas[model] || { entrada: 0.15, saida: 0.60 };
    const inTok = Number(tokens_entrada) || 0;
    const outTok = Number(tokens_saida) || 0;
    const totTok = Number(tokens_total) || (inTok + outTok);
    const custo = ((inTok * tarifa.entrada) + (outTok * tarifa.saida)) / 1_000_000;

    let finalTenantId = tenant_id;
    if (!finalTenantId) {
      const { data: firstTenant } = await supabaseServer.from('ai_usage_events').select('tenant_id').limit(1).maybeSingle();
      finalTenantId = firstTenant?.tenant_id || '00000000-0000-0000-0000-000000000000';
    }

    const { error } = await supabaseServer.from('ai_usage_events').insert({
      tenant_id: finalTenantId,
      usuario_id: usuario_id || null,
      funcao: funcao || 'websites.criacao',
      referencia_id: referencia_id || null,
      provider: 'openai',
      model: model || 'gpt-4.1-mini',
      tentativa: 1,
      status: status || 'concluida',
      tokens_entrada: inTok,
      tokens_saida: outTok,
      tokens_total: totTok,
      custo_estimado_usd: Number(custo.toFixed(7)),
      tarifa_entrada_usd_milhao: tarifa.entrada,
      tarifa_saida_usd_milhao: tarifa.saida,
      http_status: http_status || 200,
      operacao_id: crypto.randomUUID(),
    });

    if (error) {
      console.error('[WEBSITES AI USAGE] Erro ao gravar evento:', error);
      return NextResponse.json({ error: 'Erro ao gravar evento de IA.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[WEBSITES AI USAGE] Erro na rota:', error);
    return NextResponse.json({ error: 'Falha interna.' }, { status: 500 });
  }
}
