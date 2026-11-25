/**
 * /api/admin/backup-glass
 *
 * POST → dispara o backup (retorna 202 imediatamente, executa em background)
 * GET  → retorna o status atual do backup
 *
 * Requer: permissão holding 'submenu.configuracoes.financeiro'
 * (mesma permissão do monitoramento-glass)
 */

import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';
import { iniciarBackupGlass, obterStatusBackup } from '@/lib/backup-glass';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

async function verificarPermissao(req: Request) {
  const auth = await authenticateHoldingAdmin(req);
  if (!auth.ok) return { ok: false as const, resposta: NextResponse.json({ error: auth.error }, { status: auth.status, headers }) };

  try {
    const temPermissao = await hasExplicitHoldingPermission(auth.user.email, ['submenu.configuracoes.financeiro']);
    if (!temPermissao) {
      return {
        ok: false as const,
        resposta: NextResponse.json(
          { error: 'Sem permissão para executar backups. Solicite acesso a Configurações > Financeiro e API.' },
          { status: 403, headers },
        ),
      };
    }
  } catch {
    console.error('[backup-glass] Falha ao verificar permissão.');
    return {
      ok: false as const,
      resposta: NextResponse.json({ error: 'Não foi possível verificar sua permissão.' }, { status: 503, headers }),
    };
  }

  return { ok: true as const };
}

// GET /api/admin/backup-glass → status atual
export async function GET(req: Request) {
  const perm = await verificarPermissao(req);
  if (!perm.ok) return perm.resposta;

  return NextResponse.json({ status: obterStatusBackup() }, { headers });
}

// POST /api/admin/backup-glass → disparar backup
export async function POST(req: Request) {
  const perm = await verificarPermissao(req);
  if (!perm.ok) return perm.resposta;

  const statusAtual = obterStatusBackup();
  if (statusAtual.fase === 'exportando' || statusAtual.fase === 'enviando') {
    return NextResponse.json(
      { error: 'Um backup já está em andamento. Aguarde a conclusão antes de iniciar outro.' },
      { status: 409, headers },
    );
  }

  // Disparar em background — não await para retornar 202 imediatamente
  void iniciarBackupGlass().catch((err) => {
    console.error('[backup-glass] Erro não tratado no backup:', err);
  });

  return NextResponse.json(
    { mensagem: 'Backup iniciado. Acompanhe o progresso pelo status.' },
    { status: 202, headers },
  );
}
