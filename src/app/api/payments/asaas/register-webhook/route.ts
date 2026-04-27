import { NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(req: Request) {
  try {
    const { asaasApiKey, asaasEnv } = await req.json();

    if (!asaasApiKey) {
      return NextResponse.json({ success: false, error: 'API Key ausente' }, { status: 400 });
    }

    const baseUrl = asaasEnv === 'production' 
      ? 'https://www.asaas.com/api/v3' 
      : 'https://sandbox.asaas.com/api/v3';

    const webhookUrl = 'https://admin.791solucoes.com.br/api/webhooks/asaas';

    // Registra o webhook no Asaas
    const response = await axios.post(`${baseUrl}/webhooks`, {
      name: '791 Holding',
      url: webhookUrl,
      email: 'financeiro@791solucoes.com.br',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED']
    }, {
      headers: {
        'access_token': asaasApiKey
      }
    });

    return NextResponse.json({ success: true, data: response.data });

  } catch (err: any) {
    const errorDetail = err.response?.data?.errors?.[0]?.description || err.message;
    console.error('[ASAAS] Erro ao registrar webhook:', errorDetail);
    return NextResponse.json({ 
      success: false, 
      error: `Erro no Asaas: ${errorDetail}` 
    }, { status: 500 });
  }
}
