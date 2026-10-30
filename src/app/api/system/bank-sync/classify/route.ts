import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { userCanAccessResource } from '@/lib/holding-permissions';
import { classifyImportedRecord } from '@/lib/bank-sync';

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req, 'Acesso negado.');
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (!(await userCanAccessResource(auth.user.email, 'menu.financeiro'))) {
    return NextResponse.json({ success: false, error: 'Sem permissão no financeiro.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Requisição inválida.' }, { status: 400 });
  }
  const recordId = String(body?.recordId || '');
  const categoryId = String(body?.categoryId || '');
  if (!recordId || !categoryId) {
    return NextResponse.json({ success: false, error: 'Informe o lançamento e a categoria.' }, { status: 400 });
  }

  try {
    const result = await classifyImportedRecord({
      recordId,
      categoryId,
      createRule: Boolean(body?.createRule),
      pattern: body?.pattern ? String(body.pattern) : undefined,
      ruleScopeAccount: Boolean(body?.ruleScopeAccount),
      userEmail: auth.user.email,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Falha ao classificar.' }, { status: 400 });
  }
}
