import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';
import { getGlassClient } from '@/lib/glass-client';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });

  try {
    if (!await hasExplicitHoldingPermission(auth.user.email, ['submenu.configuracoes.financeiro'])) {
      return NextResponse.json({ error: 'Sem permissão para monitorar o Glass. Solicite acesso a Configurações > Financeiro e API.' }, { status: 403, headers });
    }
  } catch {
    console.error('[monitoramento-glass] Falha ao verificar permissão.');
    return NextResponse.json({ error: 'Não foi possível verificar sua permissão.' }, { status: 503, headers });
  }

  const start = performance.now();
  try {
    const glass = await getGlassClient();
    const { error } = await glass.from('vidracarias').select('id').limit(1).abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;

    return NextResponse.json({
      status: 'disponivel',
      verificadoEm: new Date().toISOString(),
      tempoMs: Math.round(performance.now() - start),
    }, { headers });
  } catch {
    console.error('[monitoramento-glass] Falha na verificação de leitura do Glass.');
    return NextResponse.json({
      status: 'indisponivel',
      verificadoEm: new Date().toISOString(),
      error: 'Não foi possível consultar o Glass. Verifique a configuração e a disponibilidade da integração.',
    }, { status: 503, headers });
  }
}
