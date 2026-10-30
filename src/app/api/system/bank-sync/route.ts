import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { suggestRulePattern, syncBankAccounts } from '@/lib/bank-sync';

export const maxDuration = 60;

async function guard(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return { error: NextResponse.json({ success: false, error: auth.error }, { status: auth.status }) };
  if (!(await userCanAccessResource(auth.user.email, 'menu.financeiro'))) {
    return { error: NextResponse.json({ success: false, error: 'Sem permissão no financeiro.' }, { status: 403 }) };
  }
  return { auth };
}

/** Fila "A classificar", situação de cada conta (último sync, saldo no banco) e regras aprendidas. */
export async function GET(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  const rawOffset = new URL(req.url).searchParams.get('reviewOffset') || '0';
  const reviewOffset = Number(rawOffset);
  if (!/^(0|[1-9]\d*)$/.test(rawOffset) || !Number.isSafeInteger(reviewOffset) || reviewOffset > 2147483548) {
    return NextResponse.json({ success: false, error: 'Página de revisão inválida.' }, { status: 400 });
  }

  const [accountsRes, pendingRes, settleRes, reviewsRes, rulesRes] = await Promise.all([
    supabaseServer.from('system_bank_accounts')
      .select('id, name, bank_name, provider, sync_enabled, sync_start_date, last_sync_at, last_sync_error, provider_balance, provider_balance_at')
      .order('name'),
    supabaseServer.from('system_finance_records')
      .select('id, type, value, description, created_at, bank_account_id, metadata')
      .eq('metadata->>needs_classification', 'true')
      .order('created_at', { ascending: false })
      .limit(300),
    supabaseServer.from('system_bank_transactions')
      .select('id, bank_account_id, tx_date, amount, description, finance_record_id')
      .eq('status', 'pendente_baixa')
      .order('tx_date', { ascending: false })
      .limit(100),
    supabaseServer.from('system_bank_transactions')
      .select('id, bank_account_id, tx_date, amount, description, counterparty, review_reason', { count: 'exact' })
      .eq('provider', 'inter')
      .eq('status', 'revisao_duplicidade')
      .order('tx_date', { ascending: false })
      .order('id')
      .range(reviewOffset, reviewOffset + 99),
    supabaseServer.from('system_bank_classification_rules')
      .select('id, pattern, record_type, category_name, bank_account_id, hits, created_at')
      .order('created_at', { ascending: false }),
  ]);
  const error = accountsRes.error || pendingRes.error || settleRes.error || reviewsRes.error || rulesRes.error;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (reviewsRes.count === null) {
    return NextResponse.json({ success: false, error: 'Não foi possível contar as movimentações em revisão.' }, { status: 500 });
  }

  const pending = (pendingRes.data || []).map((record) => {
    const metadata = (record.metadata && typeof record.metadata === 'object') ? record.metadata as Record<string, unknown> : {};
    const counterparty = metadata.counterparty ? String(metadata.counterparty) : null;
    return {
      id: record.id,
      type: record.type,
      value: Number(record.value || 0),
      description: record.description,
      date: record.created_at,
      bank_account_id: record.bank_account_id,
      counterparty,
      provider: metadata.provider || null,
      suggested_pattern: suggestRulePattern(String(record.description || ''), counterparty),
    };
  });

  return NextResponse.json({
    success: true,
    accounts: accountsRes.data || [],
    pending,
    pendingSettlement: settleRes.data || [],
    pendingReviews: reviewsRes.data || [],
    pendingReviewCount: reviewsRes.count,
    rules: rulesRes.data || [],
  });
}

/** "Sincronizar agora". */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  let accountId: string | undefined;
  try {
    const body = await req.json();
    if (body?.accountId) accountId = String(body.accountId);
  } catch {
    accountId = undefined;
  }
  try {
    const results = await syncBankAccounts({ accountId });
    return NextResponse.json({ success: true, results });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Falha ao sincronizar.' }, { status: 500 });
  }
}
