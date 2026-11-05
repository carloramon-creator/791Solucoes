import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { canAdjustGlassDueDate } from '@/lib/glass-due-date';
import { getGlassClient } from '@/lib/glass-client';
import { isUuid } from '@/lib/holding-customers';
import { isSubscriptionDueDate } from '@/lib/subscription-due-date';

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    return json({ canEdit: await canAdjustGlassDueDate(auth.user.email) });
  } catch {
    console.error('[GLASS DUE DATE] Permissão não confirmada.');
    return json({ error: 'Não foi possível verificar a permissão para ajustar vencimentos.' }, 503);
  }
}

export async function PUT(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    if (!(await canAdjustGlassDueDate(auth.user.email))) return json({ error: 'Sem permissão para ajustar vencimentos.' }, 403);
    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'Envie JSON válido.' }, 400); }
    if (!isObject(body) || !isUuid(body.id) || !isSubscriptionDueDate(body.dueDate)
      || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.trim().length > 1000
      || body.confirmed !== true
      || !(body.expectedUpdatedAt === null || (typeof body.expectedUpdatedAt === 'string'
        && Number.isFinite(Date.parse(body.expectedUpdatedAt))))) return json({ error: 'Confira data, justificativa, versão e confirmação do ajuste.' }, 400);
    const glass = await getGlassClient();
    const result = await glass.rpc('holding_adjust_subscription_due_date', {
      p_tenant: body.id, p_due_date: body.dueDate, p_expected_updated_at: body.expectedUpdatedAt,
      p_actor: auth.user.email, p_reason: body.reason.trim(),
    });
    if (result.error) {
      console.error('[GLASS DUE DATE] Ajuste não confirmado.', { code: result.error.code });
      return json({ error: result.error.code === 'P0001' ? result.error.message : 'Não foi possível confirmar o ajuste. Atualize antes de repetir.' },
        result.error.code === 'P0001' ? 409 : result.error.code === 'P0002' ? 404 : 503);
    }
    const tenant = result.data;
    if (!tenant || typeof tenant.id !== 'string' || tenant.id !== body.id || tenant.vencimento_assinatura !== body.dueDate
      || typeof tenant.ativa !== 'boolean' || typeof tenant.status_assinatura !== 'string' || typeof tenant.updated_at !== 'string') {
      console.error('[GLASS DUE DATE] Resposta de ajuste inválida.');
      return json({ error: 'O banco não retornou uma confirmação válida. Atualize para conferir antes de repetir.' }, 503);
    }
    return json({ tenant, message: 'Vencimento e situação recalculados. Nenhum pagamento, cobrança do Asaas ou bloqueio de módulos foi alterado.' });
  } catch {
    console.error('[GLASS DUE DATE] Operação interrompida.');
    return json({ error: 'Não foi possível ajustar o vencimento. Confira a conexão e as migrações.' }, 503);
  }
}
