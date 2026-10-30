import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { pickSecret, readFinanceConfig } from '@/lib/finance-config-server';
import { supabaseServer } from '@/lib/supabase-server';

const WEBHOOK_URL = 'https://admin.791solucoes.com.br/api/webhooks/asaas';
const DEFAULT_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'];

type AsaasWebhook = { id: string; url: string; events?: string[] };

function newToken() {
  // O Asaas recusa tokens com caracteres repetidos em sequência.
  for (;;) {
    const token = randomBytes(36).toString('base64url');
    if (!/(.)\1\1/.test(token)) return token;
  }
}

async function asaas(baseUrl: string, apiKey: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { access_token: apiKey, 'Content-Type': 'application/json', 'User-Agent': '791holding', ...(init.headers || {}) },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.[0]?.description || `HTTP ${res.status}`;
    throw new Error(res.status === 403 ? `A chave do Asaas não tem permissão de Webhooks (${detail})` : detail);
  }
  return data;
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateHoldingAdmin(req);
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const saved = await readFinanceConfig();
    const asaasApiKey = pickSecret(body.asaasApiKey, saved.asaasApiKey).trim();
    const asaasEnv = body.asaasEnv || saved.asaasEnv;
    if (!asaasApiKey) return NextResponse.json({ success: false, error: 'API Key ausente' }, { status: 400 });

    const baseUrl = asaasEnv === 'production' ? 'https://www.asaas.com/api/v3' : 'https://sandbox.asaas.com/api/v3';
    const authToken = typeof saved.asaasWebhookToken === 'string' && saved.asaasWebhookToken.trim().length >= 32
      ? saved.asaasWebhookToken.trim()
      : newToken();

    const list = await asaas(baseUrl, asaasApiKey, '/webhooks?limit=100');
    const existing = ((list?.data || []) as AsaasWebhook[]).find((w) => w.url === WEBHOOK_URL);

    const payload = {
      name: '791 Holding',
      url: WEBHOOK_URL,
      email: 'contato@791solucoes.com.br',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken,
      sendType: 'NON_SEQUENTIALLY',
      events: existing?.events?.length ? existing.events : DEFAULT_EVENTS,
    };

    const data = existing
      ? await asaas(baseUrl, asaasApiKey, `/webhooks/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await asaas(baseUrl, asaasApiKey, '/webhooks', { method: 'POST', body: JSON.stringify(payload) });

    // Só grava o token depois que o Asaas aceitou, para não recusar avisos legítimos.
    if (authToken !== saved.asaasWebhookToken) {
      const { error } = await supabaseServer
        .from('system_settings')
        .update({ value: { ...saved, asaasWebhookToken: authToken }, updated_at: new Date().toISOString() })
        .eq('id', 'finance_api');
      if (error) throw new Error(`Webhook atualizado no Asaas, mas falhou ao salvar o token: ${error.message}`);
    }

    return NextResponse.json({ success: true, action: existing ? 'updated' : 'created', id: data?.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha desconhecida';
    console.error('[ASAAS] Erro ao registrar webhook:', message);
    return NextResponse.json({ success: false, error: `Erro no Asaas: ${message}` }, { status: 500 });
  }
}
