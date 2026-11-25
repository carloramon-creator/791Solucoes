import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';
import { getGlassClient } from '@/lib/glass-client';
import { validarHistorico, validarIntegridade } from '@/lib/monitoramento-glass';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

async function consultar(query: () => PromiseLike<{ data: unknown; error: unknown }>) {
  try {
    return await query();
  } catch {
    return { data: null, error: true };
  }
}

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

    const tempoMs = Math.round(performance.now() - start);
    const [historico, integridade] = await Promise.all([
      consultar(() => glass.rpc('monitoramento_banco_glass_historico').abortSignal(AbortSignal.timeout(10000))),
      consultar(() => glass.rpc('monitoramento_integridade_glass_ultimo').abortSignal(AbortSignal.timeout(10000))),
    ]);
    const historicoValido = !historico.error && validarHistorico(historico.data);
    const integridadeValida = !integridade.error && validarIntegridade(integridade.data);
    if (!historicoValido) console.error('[monitoramento-glass] Falha ao consultar histórico de métricas.');
    if (!integridadeValida) console.error('[monitoramento-glass] Falha ao consultar integridade das tabelas.');

    return NextResponse.json({
      status: 'disponivel',
      verificadoEm: new Date().toISOString(),
      tempoMs,
      historico: historicoValido ? historico.data : null,
      historicoErro: historicoValido ? null : 'Histórico indisponível. Verifique a migração de métricas no Glass.',
      integridade: integridadeValida ? integridade.data : null,
      integridadeErro: integridadeValida ? null : 'Verificação de tabelas indisponível. Verifique a migração de integridade e o acesso ao amcheck.',
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
