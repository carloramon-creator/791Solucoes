import { NextResponse } from 'next/server';
import AsaasClient from '@/services/asaas-service';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ROTA DE ASSINATURA PREMIUM (VIDRAÇARIAS)
 */
export async function POST(req: Request) {
  try {
    const { 
      tenantId,
      customerName,
      customerEmail,
      customerCpfCnpj,
      customerPhone,
      customerPostalCode,
      customerAddress,
      customerAddressNumber,
      customerProvince,
      planValue,
      planDescription,
      cycle, 
      items 
    } = await req.json();

    console.log('[ASAAS API] Iniciando assinatura para:', customerEmail);

    // 1. Conectar ao Supabase com Service Role Key (Backend)
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
       throw new Error('Configuração de conexão (Supabase URL/Key) ausente no servidor.');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 2. Buscar Config do Asaas na Holding
    const { data: configData, error: configError } = await supabaseAdmin
      .from('system_settings')
      .select('value')
      .eq('id', 'finance_api')
      .single();

    if (configError || !configData?.value) {
      throw new Error('Configuração do Asaas (finance_api) não encontrada no banco.');
    }

    const config = configData.value as any;
    const environment = config.asaasEnv || 'sandbox';
    const apiKey = config.asaasApiKey;
    
    const asaas = new AsaasClient({
      apiKey: apiKey,
      environment: environment as any
    });

    // 3. Buscar ou Criar Cliente no Asaas
    const effectiveEmail = customerEmail.includes('@791.com.br') ? 'teste@791solucoes.com.br' : customerEmail;
    let customer = await asaas.getCustomerByEmail(effectiveEmail);
    
    let cleanPhone = (customerPhone || '11987654321').replace(/\D/g, '');
    if (cleanPhone.length < 10) cleanPhone = '11987654321';
    
    const cleanCep = (customerPostalCode || '01001000').replace(/\D/g, '');

    if (!customer) {
      customer = await asaas.createCustomer({
        name: customerName,
        email: effectiveEmail,
        cpfCnpj: customerCpfCnpj.replace(/\D/g, ''),
        phone: cleanPhone,
        mobilePhone: cleanPhone,
        postalCode: cleanCep,
        address: customerAddress || 'Rua Genérica',
        addressNumber: customerAddressNumber || 'S/N',
        province: customerProvince || 'Centro',
        notificationDisabled: false
      });
    }

    // 4. Criar a Assinatura ou Link de Checkout
    let invoiceUrl = '';
    let resultId = '';

    if (cycle === 'MONTHLY' || !cycle) {
      // Assinatura Recorrente
      const result = await asaas.createSubscription({
        customer: customer.id,
        billingType: 'UNDEFINED',
        value: parseFloat(planValue),
        cycle: 'MONTHLY',
        nextDueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        description: planDescription || `Assinatura SaaS 791glass - ${customerName}`,
        externalReference: `glass|${tenantId}`
      });

      resultId = result.id;
      invoiceUrl = result.invoiceUrl;

      if (!invoiceUrl && result.id) {
        // Fallback: buscar link no primeiro pagamento
        const paymentsResponse = await asaas.getSubscriptionPreviousPayments(result.id);
        invoiceUrl = paymentsResponse.data?.[0]?.invoiceUrl;
      }
    } else {
      // Link de Checkout Premium (Semestral/Anual)
      const totalValue = parseFloat(planValue);
      const installmentCount = cycle === 'YEARLY' ? 12 : 6;
      
      const checkoutPayload: any = {
          name: `791glass - Plano ${cycle === 'YEARLY' ? 'Anual' : 'Semestral'}`,
          description: planDescription || `Plano ${cycle === 'YEARLY' ? 'Anual' : 'Semestral'} 791glass`,
          billingTypes: ['CREDIT_CARD'], 
          chargeTypes: ['DETACHED', 'INSTALLMENT'], 
          installment: {
              maxInstallmentCount: installmentCount
          },
          endDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0], 
          value: totalValue,
          dueDateDays: 3, 
          externalReference: `glass|${tenantId}`,
          customer: customer.id,
          callback: {
              successUrl: 'https://app.791glass.com.br',
              autoRedirect: false
          }
      };

      checkoutPayload.items = [{
          name: `Plano ${cycle === 'YEARLY' ? 'Anual' : 'Semestral'} + Módulos`,
          amount: totalValue,
          value: totalValue,
          quantity: 1
      }];

      const checkout = await asaas.createCheckout(checkoutPayload);
      resultId = checkout.id;
      invoiceUrl = checkout.url || checkout.paymentUrl || checkout.invoiceUrl || checkout.link || ''; 
    }

    return NextResponse.json({ 
      success: true, 
      id: resultId,
      invoiceUrl: invoiceUrl
    });

  } catch (err: any) {
    console.error('[ASAAS API ERROR]:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: `Asaas rejeitou: ${err.message}`
    }, { status: 500 });
  }
}
