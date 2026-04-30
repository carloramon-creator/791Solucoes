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
    const cleanCpfCnpj = cpfCnpj.replace(/\D/g, '');
    let customer = await asaas.getCustomerByCpfCnpj(cleanCpfCnpj);
    
    // Se não achar por CPF, tenta pelo e-mail (fallback)
    if (!customer) {
      customer = await asaas.getCustomerByEmail(email);
    }
    
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
        city: city,
        state: state
      });
    }

    // 3. Criar a Cobrança (Payment) - Lógica de Ciclo e Desconto
    const baseValue = typeof valor === 'string' 
      ? parseFloat(valor.replace(/\./g, '').replace(',', '.')) 
      : parseFloat(valor);
    
    if (isNaN(baseValue) || baseValue <= 0) {
      throw new Error('Valor da cobrança inválido.');
    }

    let months = 1;
    let discountPercent = 0;

    if (ciclo === 'QUARTERLY') {
      months = 3;
      discountPercent = 5; // 5% de desconto para trimestral
    } else if (ciclo === 'SEMI_ANNUAL') {
      months = 6;
      discountPercent = 10; // 10% de desconto para semestral
    } else if (ciclo === 'YEARLY') {
      months = 12;
      discountPercent = 15; // 15% de desconto para anual
    }

    const subtotal = baseValue * months;
    const discountAmount = subtotal * (discountPercent / 100);
    const totalValue = subtotal - discountAmount;

    const cycleMap: any = {
      'MONTHLY': 'Mensal',
      'QUARTERLY': 'Trimestral',
      'SEMI_ANNUAL': 'Semestral',
      'YEARLY': 'Anual'
    };
    const cycleLabel = cycleMap[ciclo] || 'Mensal';

    const paymentPayload: any = {
        customer: customer.id,
        billingType: 'UNDEFINED', 
        value: totalValue,
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
        description: description || `Adesão Patrocínio 791glass (${cycleLabel}) - ${nome}${discountPercent > 0 ? ` (Desc. ${discountPercent}%)` : ''}`,
        externalReference: `sponsor|${patrocinadorId}`,
    };

    const payment = await asaas.createPayment(paymentPayload);

    // 4. Salvar dados de cobrança no Supabase (Holding)
    const { error: sError } = await supabaseHolding
      .from('patrocinadores')
      .update({
        asaas_customer_id: customer.id,
        last_charge_id: payment.id,
        last_charge_link: payment.invoiceUrl
      })
      .eq('id', patrocinadorId);

    if (sError) {
      console.error('[ASAAS SPONSOR] Erro ao salvar dados no Supabase:', sError.message);
    }

    return NextResponse.json({ 
      success: true, 
      id: payment.id,
      invoiceUrl: payment.invoiceUrl
    });

  } catch (err: any) {
    console.error('[ASAAS SPONSOR ERROR]:', err.message);
    return NextResponse.json({ 
      success: false, 
      error: `Asaas rejeitou: ${err.message}`
    }, { status: 500 });
  }
}
