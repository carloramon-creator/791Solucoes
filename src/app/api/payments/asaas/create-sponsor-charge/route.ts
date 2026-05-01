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
    
    // Se não achar por CPF, tenta pelo e-mail
    if (!customer) {
      customer = await asaas.getCustomerByEmail(email);
    }
    
    let cleanPhone = (telefone || '11987654321').replace(/\D/g, '');
    if (cleanPhone.length < 10) cleanPhone = '11987654321';

    const customerData = {
      name: nome,
      email: email,
      cpfCnpj: cleanCpfCnpj,
      phone: cleanPhone,
      mobilePhone: cleanPhone,
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
      // ⚠️ IMPORTANTE: Se o nome for diferente (ex: Barbearia), atualizamos os dados para o Patrocinador atual
      if (customer.name !== nome || customer.cpfCnpj !== cleanCpfCnpj) {
        console.log('[ASAAS] Atualizando dados do cliente para coincidir com o Patrocinador:', nome);
        customer = await asaas.updateCustomer(customer.id, customerData);
      }
    }

    // 3. Limpeza do Telefone (Asaas é chato com isso)
    let cleanPhone = (telefone || '11987654321').replace(/\D/g, '');
    // Se for fixo (começa com 2-5) e tem 11 dígitos, provavelmente tem um dígito a mais no final
    if (cleanPhone.length === 11 && ['2','3','4','5'].includes(cleanPhone[2])) {
        cleanPhone = cleanPhone.substring(0, 10);
    }

    // Atualiza o cliente no Asaas com o telefone corrigido
    await asaas.updateCustomer(customer.id, {
        ...customerData,
        phone: cleanPhone,
        mobilePhone: cleanPhone
    });

    // 4. Criar o Checkout Link (Layout Moderno - Estilo Vidraçarias)
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

    // Payment Link Payload (Gera o link moderno asaas.com/c/...)
    const paymentLinkPayload: any = {
        name: `Plano de Patrocínio 791glass - ${nome}`,
        description: description || `Patrocínio ${cycleLabel} + Cota de Licenças`,
        value: totalValue,
        billingType: 'UNDEFINED', // Flexível: Cartão, Boleto, Pix
        chargeType: maxInstallments > 1 ? 'INSTALLMENT' : 'DETACHED',
        maxInstallmentCount: maxInstallments,
        dueDateLimitDays: 3,
        externalReference: `sponsor|${patrocinadorId}`,
        notificationDisabled: false,
        customer: customer.id
    };

    const paymentLink = await asaas.createPaymentLink(paymentLinkPayload);

    if (!paymentLink.url) {
        throw new Error('Checkout gerado, mas URL não encontrada.');
    }

    // 5. Salvar dados de cobrança no Supabase (Holding)
    const { error: sError } = await supabaseHolding
      .from('patrocinadores')
      .update({
        asaas_customer_id: customer.id,
        last_charge_id: paymentLink.id,
        last_charge_link: paymentLink.url
      })
      .eq('id', patrocinadorId);

    if (sError) {
      console.error('[ASAAS SPONSOR] Erro ao salvar dados no Supabase:', sError.message);
    }

    return NextResponse.json({ 
      success: true, 
      id: paymentLink.id,
      invoiceUrl: paymentLink.url
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
