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

    // 3. Verificar se o patrocinador tem customer_id no Asaas
    let customerId = sponsor.asaas_customer_id;

    if (!customerId) {
      // Criar ou buscar customer no Asaas
      const cleanCpfCnpj = (sponsor.cpf_cnpj || '').replace(/\D/g, '');
      let customer = await asaas.getCustomerByCpfCnpj(cleanCpfCnpj);
      if (!customer) {
        customer = await asaas.getCustomerByEmail(sponsor.email);
      }
      if (!customer) {
        customer = await asaas.createCustomer({
          name: sponsor.nome,
          email: sponsor.email,
          cpfCnpj: cleanCpfCnpj,
        });
      }
      customerId = customer.id;

      // Salvar para próxima vez
      await supabaseHolding
        .from('patrocinadores')
        .update({ asaas_customer_id: customerId })
        .eq('id', sponsorId);
    }

    // 4. Preparar valor
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

    if (totalValue <= 0) {
      throw new Error('Valor total da cobrança é zero ou negativo. Verifique o valor mensal do patrocinador.');
    }

    // 5. Criar o Checkout V3
    // Codificamos sponsor_id e quantity diretamente no externalReference
    const externalRef = `extra_quotas|${sponsorId}|${quantity}`;

    const checkoutPayload: any = {
        customer: customerId,
        name: `Solicitação de Cotas Extras - ${sponsor.nome}`,
        description: `Adicional de ${quantity} cotas de patrocínio`,
        value: totalValue,
        billingTypes: ['BOLETO', 'CREDIT_CARD', 'PIX'],
        chargeType: 'DETACHED',
        dueDateLimitDays: 3,
        externalReference: externalRef,
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
    const asaasError = err.response?.data?.errors?.[0]?.description || err.message;
    console.error('[EXTRA QUOTAS ERROR]:', asaasError, err.response?.data);
    return NextResponse.json({ success: false, error: asaasError }, { status: 500 });
  }
}
