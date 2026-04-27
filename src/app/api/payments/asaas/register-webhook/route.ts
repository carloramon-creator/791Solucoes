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
      url: webhookUrl,
      email: 'financeiro@791solucoes.com.br', // Email para alertas
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      sendType: 'SEQUENTIALLY'
    }, {
      headers: {
        'access_token': asaasApiKey
      }
    });

    return NextResponse.json({ success: true, data: response.data });

  } catch (err: any) {
    console.error('[ASAAS] Erro ao registrar webhook:', err.response?.data || err.message);
    return NextResponse.json({ 
      success: false, 
      error: err.response?.data?.errors?.[0]?.description || err.message 
    }, { status: 500 });
  }
}
