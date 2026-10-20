import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { sincronizarSituacaoNfse } from '@/services/nfse/sincronizar-situacao';

export async function POST(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  try {
    const resultado = await sincronizarSituacaoNfse({ forcar: searchParams.get('forcar') === '1' });
    return NextResponse.json({ success: true, ...resultado });
  } catch (err) {
    const message = (err as Error).message || 'Erro ao consultar a prefeitura';
    console.error('[NFSe sincronizar]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
