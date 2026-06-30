import { NextResponse } from 'next/server';
import AsaasClient from '@/services/asaas-service';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { sponsorId, quantity, cycle } = await req.json();

    const HOLDING_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const HOLDING_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabaseHolding = createClient(HOLDING_URL, HOLDING_SERVICE_KEY);

    // 1. Buscar Patrocinador
    const { data: sponsor, error: sponsorError } = await supabaseHolding
      .from('patrocinadores')
      .select('*')
      .eq('id', sponsorId)
      .single();

    if (sponsorError || !sponsor) throw new Error('Patrocinador não encontrado.');

    // 2. Buscar Config do Asaas
    const { data: configData, error: configError } = await supabaseHolding
      .from('system_settings')
      .select('value')
      .eq('id', 'finance_api')
      .single();

    if (configError || !configData?.value) {
      throw new Error('Configuração do Asaas (finance_api) não encontrada na Holding.');
    }

    const config = configData.value as any;
    const environment = config.asaasEnv || 'sandbox';
    const apiKey = config.asaasApiKey;

    const asaas = new AsaasClient({
      apiKey: apiKey,
      environment: environment as any
    });

    // 3. Preparar valor
    const valorMensalAtual = Number(sponsor.valor_mensal) || 0;
    const licencasAtuais = Number(sponsor.total_licencas) || 1;
    const valorPorCotaMensal = valorMensalAtual / licencasAtuais;
    const baseValue = valorPorCotaMensal * Number(quantity);

    let months = 1;
    let discountPercent = 0;

    if (cycle === 'QUARTERLY') {
      months = 3;
      discountPercent = 5;
    } else if (cycle === 'SEMI_ANNUAL') {
      months = 6;
      discountPercent = 10;
    } else if (cycle === 'YEARLY') {
      months = 12;
      discountPercent = 15;
    }

    const subtotal = baseValue * months;
    const discountAmount = subtotal * (discountPercent / 100);
    const totalValue = subtotal - discountAmount;

    // 4. Criar registro pendente no BD
    const { data: record, error: recordError } = await supabaseHolding
      .from('system_finance_records')
      .insert([{
        tenant_id: sponsorId, // Aqui usamos tenant_id como sponsorId
        kind: 'extra_quotas',
        status: 'pending',
        value: totalValue,
        description: `Cotas extras de Patrocínio: ${quantity} unidades`,
        metadata: {
           sponsor_id: sponsorId,
           quantity: Number(quantity),
           cycle: cycle
        }
      }])
      .select()
      .single();

    if (recordError) throw recordError;

    // 5. Criar o Checkout V3
    const checkoutPayload: any = {
        customer: sponsor.asaas_customer_id,
        name: `Solicitação de Cotas Extras - ${sponsor.nome}`,
        description: `Adicional de ${quantity} cotas de patrocínio`,
        value: totalValue,
        billingTypes: ['BOLETO', 'CREDIT_CARD', 'PIX'],
        chargeType: 'DETACHED',
        dueDateLimitDays: 3,
        externalReference: `finance_record|${record.id}`,
        items: [{
            name: `Cotas Extras (${quantity}x)`,
            description: `Expansão do plano para suportar mais vidraçarias.`,
            value: totalValue,
            amount: totalValue,
            quantity: 1
        }],
        callback: {
            successUrl: `https://admin.791solucoes.com.br/portal/${sponsorId}`,
            autoRedirect: true
        }
    };

    const checkout = await asaas.createCheckout(checkoutPayload);
    const checkoutUrl = checkout.url || checkout.paymentUrl;

    if (!checkoutUrl) throw new Error('Falha ao gerar link no Asaas.');

    return NextResponse.json({ 
      success: true, 
      invoiceUrl: checkoutUrl
    });

  } catch (err: any) {
    console.error('[EXTRA QUOTAS ERROR]:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
