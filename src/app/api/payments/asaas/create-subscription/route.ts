import { NextResponse } from 'next/server';
import AsaasClient from '@/services/asaas-service';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { 
      tenantId,
      customerName,
      customerEmail,
      customerCpfCnpj,
      planValue,
      planDescription,
      cycle, // 'MONTHLY', 'SEMIANNUALLY', 'YEARLY'
    } = await req.json();

    // 1. Buscar Config do Asaas na Holding
    const { data: configData } = await supabase
      .from('system_settings')
      .select('value')
      .eq('id', 'finance_api')
      .single();

    if (!configData?.value) {
      throw new Error('Configuração do Asaas não encontrada na Holding');
    }

    const config = configData.value as any;
    const asaas = new AsaasClient({
      apiKey: config.apiKey,
      environment: config.environment
    });

    // 2. Buscar ou Criar Cliente no Asaas
    let customer = await asaas.getCustomerByEmail(customerEmail);
    
    if (!customer) {
      customer = await asaas.createCustomer({
        name: customerName,
        email: customerEmail,
        cpfCnpj: customerCpfCnpj.replace(/\D/g, ''),
        notificationDisabled: false
      });
    }

    // 3. Criar a Assinatura
    // Usamos UNDEFINED para o cliente escolher o método no checkout
    const subscription = await asaas.createSubscription({
      customer: customer.id,
      billingType: 'UNDEFINED',
      value: parseFloat(planValue),
      cycle: cycle || 'MONTHLY',
      nextDueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Amanhã
      description: planDescription || `Assinatura SaaS 791glass - ${customerName}`,
      externalReference: `glass|${tenantId}`
    });

    return NextResponse.json({ 
      success: true, 
      subscriptionId: subscription.id,
      invoiceUrl: subscription.invoiceUrl, // Link do checkout
      invoiceCustomizationUrl: subscription.invoiceCustomizationUrl
    });

  } catch (err: any) {
    console.error('[ASAAS SUBSCRIPTION] Erro:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.message 
    }, { status: 500 });
  }
}
