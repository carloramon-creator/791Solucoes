import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { InterReviewError, resolveInterReview } from '@/lib/bank-sync';
import { supabaseServer } from '@/lib/supabase-server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;

type Candidate = {
  id: string;
  status: string | null;
  record_type: string | null;
  value: number;
  description: string | null;
  created_at: string | null;
  bank_account_id: string | null;
  payment_method: string | null;
  category: string | null;
  bank_id: string | null;
  source: string | null;
  blocked_reason: string | null;
  total_count: number;
};

async function guard(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return { error: NextResponse.json({ success: false, error: auth.error }, { status: auth.status }) };
  if (!(await userCanAccessResource(auth.user.email, 'menu.financeiro'))) {
    return { error: NextResponse.json({ success: false, error: 'Sem permissão no financeiro.' }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  const params = new URL(req.url).searchParams;
  const transactionId = params.get('transactionId') || '';
  const rawOffset = params.get('offset') || '0';
  const offset = Number(rawOffset);
  if (!UUID.test(transactionId) || !/^(0|[1-9]\d*)$/.test(rawOffset) ||
      !Number.isSafeInteger(offset) || offset > 2147483647) {
    return NextResponse.json({ success: false, error: 'Movimentação ou página inválida.' }, { status: 400 });
  }

  const { data: transaction, error: transactionError } = await supabaseServer
    .from('system_bank_transactions')
    .select('id')
    .eq('id', transactionId)
    .eq('provider', 'inter')
    .eq('status', 'revisao_duplicidade')
    .maybeSingle();
  if (transactionError) return NextResponse.json({ success: false, error: transactionError.message }, { status: 500 });
  if (!transaction) return NextResponse.json({ success: false, error: 'A movimentação não está mais disponível para revisão.' }, { status: 404 });

  const { data, error } = await supabaseServer.rpc('bank_inter_review_candidates', {
    p_transaction_id: transactionId,
    p_offset: offset,
    p_limit: PAGE_SIZE,
  });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  const candidates = (data || []) as Candidate[];
  const total = candidates.length ? Number(candidates[0].total_count) : 0;
  if (!Number.isSafeInteger(total) || total < 0) {
    return NextResponse.json({ success: false, error: 'O banco retornou uma contagem inválida.' }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
      record_type: candidate.record_type,
      value: candidate.value,
      description: candidate.description,
      created_at: candidate.created_at,
      bank_account_id: candidate.bank_account_id,
      payment_method: candidate.payment_method,
      category: candidate.category,
      bank_id: candidate.bank_id,
      source: candidate.source,
      blocked_reason: candidate.blocked_reason,
    })),
    total,
    offset,
    pageSize: PAGE_SIZE,
  });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const transactionId = typeof input.transactionId === 'string' ? input.transactionId : '';
  const recordId = typeof input.recordId === 'string' ? input.recordId : '';
  const action = input.action;
  if (!UUID.test(transactionId) || (action !== 'link' && action !== 'create') ||
      (action === 'link' && !UUID.test(recordId))) {
    return NextResponse.json({ success: false, error: 'Informe a movimentação e uma decisão válida.' }, { status: 400 });
  }

  try {
    const allowPaid = action === 'link'
      ? await userCanAccessResource(g.auth.user.email, 'action.finance.manage_paid_records')
      : false;
    const result = await resolveInterReview({
      transactionId,
      action,
      recordId: action === 'link' ? recordId : undefined,
      allowPaid,
      actorId: g.auth.user.id,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao conciliar a movimentação.';
    return NextResponse.json({ success: false, error: message }, { status: err instanceof InterReviewError ? err.status : 500 });
  }
}
