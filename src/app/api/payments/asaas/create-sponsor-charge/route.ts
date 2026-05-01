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

    // 2. Preparar dados do Cliente (Patrocinador)
    const cleanCpfCnpj = cpfCnpj.replace(/\D/g, '');
    let cleanPhone = (telefone || '').replace(/\D/g, '');
    let phoneToUse = '';
    let mobileToUse = '';

    // Lógica de Telefone para o Asaas não rejeitar e permitir preenchimento automático
    if (cleanPhone.length >= 10) {
      const isMobile = !(['2','3','4','5'].includes(cleanPhone[2]));
      if (isMobile && cleanPhone.length === 11) {
        mobileToUse = cleanPhone;
      } else {
        // Se for fixo ou tiver 11 dígitos mas for fixo, trunca para 10
        phoneToUse = cleanPhone.length > 10 ? cleanPhone.substring(0, 10) : cleanPhone;
      }
    }

    let customer = await asaas.getCustomerByCpfCnpj(cleanCpfCnpj);
    if (!customer) {
      customer = await asaas.getCustomerByEmail(email);
    }
    
    const customerData: any = {
      name: nome,
      email: email,
      cpfCnpj: cleanCpfCnpj,
      phone: phoneToUse || mobileToUse || '1149320232', // Backup landline
      mobilePhone: mobileToUse || phoneToUse || '11987654321', // Backup mobile
      address: address || 'Endereço não informado',
      addressNumber: addressNumber || 'S/N',
      province: province || 'Bairro não informado',
      postalCode: (postalCode || '00000-000').replace(/\D/g, ''),
      city: city,
      state: state
    };

    if (!customer) {
      customer = await asaas.createCustomer(customerData);
    } else {
      // ⚠️ Sincronização Total: Garante que o Asaas tenha TUDO para pré-preencher o checkout
      console.log('[ASAAS] Sincronizando dados completos do cliente:', nome);
      customer = await asaas.updateCustomer(customer.id, customerData);
    }

    // 3. Cálculo de Valores e Ciclo
    const baseValue = typeof valor === 'string' 
      ? parseFloat(valor.replace(/\./g, '').replace(',', '.')) 
      : parseFloat(valor);
    
    if (isNaN(baseValue) || baseValue <= 0) {
      throw new Error('Valor da cobrança inválido.');
    }

    let months = 1;
    let discountPercent = 0;
    let maxInstallments = 1;

    if (ciclo === 'QUARTERLY') {
      months = 3;
      discountPercent = 5;
      maxInstallments = 3;
    } else if (ciclo === 'SEMI_ANNUAL') {
      months = 6;
      discountPercent = 10;
      maxInstallments = 6;
    } else if (ciclo === 'YEARLY') {
      months = 12;
      discountPercent = 15;
      maxInstallments = 12;
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

    // 4. Criar o Checkout V3 (Moderno e Pré-preenchido)
    const checkoutPayload: any = {
        customer: customer.id,
        name: `Plano de Patrocínio 791glass - ${nome}`,
        description: `Cota de Patrocínio (${cycleLabel}) + Módulos de Licenças`,
        value: totalValue,
        billingType: 'UNDEFINED',
        chargeType: maxInstallments > 1 ? 'INSTALLMENT' : 'DETACHED',
        installment: {
            maxInstallmentCount: maxInstallments
        },
        dueDateLimitDays: 3,
        externalReference: `sponsor|${patrocinadorId}`,
        items: [{
            name: `Patrocínio 791glass (${cycleLabel})`,
            description: `Patrocinador: ${nome}`,
            value: totalValue,
            amount: totalValue,
            quantity: 1
        }],
        callback: {
            successUrl: 'https://admin.791solucoes.com.br/patrocinadores',
            autoRedirect: true
        }
    };

    console.log('[ASAAS] Gerando Checkout V3 para:', customer.id);
    const checkout = await asaas.createCheckout(checkoutPayload);

    const checkoutUrl = checkout.url || checkout.paymentUrl;

    if (!checkoutUrl) {
        throw new Error('Checkout gerado, mas URL não encontrada na resposta do Asaas.');
    }

    // 5. Salvar dados de cobrança no Supabase (Holding)
    await supabaseHolding
      .from('patrocinadores')
      .update({
        asaas_customer_id: customer.id,
        last_charge_id: checkout.id,
        last_charge_link: checkoutUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', patrocinadorId);

    return NextResponse.json({ 
      success: true, 
      id: checkout.id,
      invoiceUrl: checkoutUrl
    });

  } catch (err: any) {
    const asaasError = err.response?.data?.errors?.[0]?.description || err.message;
    console.error('[ASAAS SPONSOR ERROR]:', asaasError, err.response?.data);
    return NextResponse.json({ 
      success: false, 
      error: `Asaas rejeitou: ${asaasError}`
    }, { status: 500 });
  }
}
