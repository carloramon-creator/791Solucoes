import { NextResponse } from 'next/server';
import AsaasClient from '@/services/asaas-service';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ROTA DE COBRANÇA PARA PATROCINADORES (HOLDING)
 */
export async function POST(req: Request) {
  try {
    const { 
      patrocinadorId,
      nome,
      email,
      cpfCnpj,
      telefone,
      valor,
      description,
      ciclo = 'MONTHLY',
      parcelas = 1,
      address,
      addressNumber,
      province,
      postalCode,
      city,
      state
    } = await req.json();

    console.log('[ASAAS SPONSOR] Iniciando cobrança para:', email);

    // 1. Buscar Config do Asaas na Holding
    const HOLDING_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const HOLDING_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    
    if (!HOLDING_URL || !HOLDING_SERVICE_KEY) {
       throw new Error('Configuração de conexão (Supabase URL/Key) ausente no ambiente.');
    }

    const supabaseHolding = createClient(HOLDING_URL, HOLDING_SERVICE_KEY);

    // Buscar a chave de API do Asaas da Holding
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

    // 2. Buscar ou Criar Cliente (Patrocinador) no Asaas
    let customer = await asaas.getCustomerByEmail(email);
    
    let cleanPhone = (telefone || '11987654321').replace(/\D/g, '');
    if (cleanPhone.length < 10) cleanPhone = '11987654321';

    if (!customer) {
      customer = await asaas.createCustomer({
        name: nome,
        email: email,
        cpfCnpj: cpfCnpj.replace(/\D/g, ''),
        phone: cleanPhone,
        mobilePhone: cleanPhone,
        notificationDisabled: false,
        address: address || 'Av. Paulista',
        addressNumber: addressNumber || '1000',
        province: province || 'Centro',
        postalCode: (postalCode || '01310-100').replace(/\D/g, ''),
        cityName: city,
        state: state
      });
    }

    // 3. Criar o Checkout Link (Tela Bonita)
    const totalValue = parseFloat(valor);
    
    const cycleMap: any = {
      'MONTHLY': 'Mensal',
      'QUARTERLY': 'Trimestral',
      'SEMI_ANNUAL': 'Semestral',
      'YEARLY': 'Anual'
    };
    const cycleLabel = cycleMap[ciclo] || 'Mensal';

    const checkoutPayload: any = {
        name: `Patrocínio 791glass - ${nome}`,
        description: description || `Renovação ${cycleLabel} - Cota de Patrocínio 791glass`,
        billingTypes: ['CREDIT_CARD'], 
        chargeTypes: ['DETACHED', 'INSTALLMENT'], 
        installment: {
            maxInstallmentCount: parcelas
        },
        endDate: new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0], // Link expira em 7 dias
        value: totalValue,
        dueDateDays: 5, 
        externalReference: `sponsor|${patrocinadorId}`,
        customer: customer.id,
        callback: {
            successUrl: 'https://app.791glass.com.br/patrocinadores',
            autoRedirect: true
        }
    };

    checkoutPayload.items = [{
        name: `Cota de Patrocínio - ${nome}`,
        amount: totalValue,
        value: totalValue,
        quantity: 1
    }];

    const checkout = await asaas.createCheckout(checkoutPayload);

    const invoiceUrl = checkout.url || checkout.paymentUrl || checkout.invoiceUrl || checkout.link || ''; 

    if (!invoiceUrl) {
        throw new Error('Checkout gerado, mas URL não encontrada no retorno do Asaas.');
    }

    return NextResponse.json({ 
      success: true, 
      id: checkout.id,
      invoiceUrl: invoiceUrl
    });

  } catch (err: any) {
    console.error('[ASAAS SPONSOR ERROR]:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: `Asaas rejeitou: ${err.message}`
    }, { status: 500 });
  }
}
