import { NextResponse } from 'next/server';
import axios from 'axios';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { pickSecret, readFinanceConfig } from '@/lib/finance-config-server';

export async function POST(req: Request) {
  try {
    const auth = await authenticateHoldingAdmin(req);
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const saved = await readFinanceConfig();
    const asaasApiKey = pickSecret(body.asaasApiKey, saved.asaasApiKey);
    const asaasEnv = body.asaasEnv || saved.asaasEnv;

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
