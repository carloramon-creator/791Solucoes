import { NextResponse } from 'next/server';
import axios from 'axios';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { 
      asaasApiKey, 
      asaasEnv, 
      value, 
      description, 
      dueDate, 
      customerName, 
      customerEmail, 
      customerCpfCnpj,
      externalReference 
    } = await req.json();

    if (!asaasApiKey) {
      return NextResponse.json({ success: false, error: 'API Key do Asaas ausente' }, { status: 400 });
    }

    const baseUrl = asaasEnv === 'production' 
      ? 'https://www.asaas.com/api/v3' 
      : 'https://sandbox.asaas.com/api/v3';

    const headers = { 'access_token': asaasApiKey };

    // 1. Buscar ou Criar Cliente no Asaas
    // Usamos o CPF/CNPJ como chave principal ou um email único para evitar conflitos com cadastros antigos sem CPF
    console.log('[ASAAS] Buscando/Criando cliente:', customerCpfCnpj);
    let customerId;
    
    // Tenta buscar por CPF/CNPJ primeiro
    const customersRes = await axios.get(`${baseUrl}/customers?cpfCnpj=${customerCpfCnpj}`, { headers });
    
    if (customersRes.data.data.length > 0) {
      customerId = customersRes.data.data[0].id;
      // Opcional: Atualizar o cliente aqui se necessário
    } else {
      // Se não achou por CPF, cria um novo
      const newCustomerRes = await axios.post(`${baseUrl}/customers`, {
        name: customerName,
        email: `cliente-${Date.now()}@791solucoes.com.br`, // Email único para evitar erro de duplicidade
        cpfCnpj: customerCpfCnpj
      }, { headers });
      customerId = newCustomerRes.data.id;
    }

    // 2. Criar a Cobrança (Pix e Boleto por padrão)
    console.log('[ASAAS] Criando cobrança de R$', value);
    const chargeRes = await axios.post(`${baseUrl}/payments`, {
      customer: customerId,
      billingType: 'UNDEFINED', // Permite que o cliente escolha no checkout
      value: parseFloat(value),
      dueDate: dueDate || new Date().toISOString().split('T')[0],
      description: description,
      externalReference: externalReference, // ex: "holding|record_id"
    }, { headers });

    return NextResponse.json({ 
      success: true, 
      invoiceUrl: chargeRes.data.invoiceUrl,
      paymentId: chargeRes.data.id 
    });

  } catch (err: any) {
    console.error('[ASAAS] Erro ao criar cobrança:', err.response?.data || err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.response?.data?.errors?.[0]?.description || err.message 
    }, { status: 500 });
  }
}
