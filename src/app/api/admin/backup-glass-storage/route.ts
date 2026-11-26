/**
 * /api/admin/backup-glass-storage
 *
 * POST → dispara o backup do Supabase Storage do Glass (executa em background, retorna 202)
 * GET  → retorna o status do progresso do backup do Storage
 */

import { NextResponse } from 'next/server';
import { authenticateHoldingAdmin } from '@/lib/holding-admin-auth';
import { hasExplicitHoldingPermission } from '@/lib/holding-route-permissions';
import { iniciarBackupStorageGlass, obterStatusStorageBackup } from '@/lib/backup-glass-storage';

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
    console.error('[backup-glass-storage] Falha ao verificar permissão.');
    return {
      ok: false as const,
      resposta: NextResponse.json({ error: 'Não foi possível verificar sua permissão.' }, { status: 503, headers }),
    };
  }

  return { ok: true as const };
}

export async function GET(req: Request) {
  const perm = await verificarPermissao(req);
  if (!perm.ok) return perm.resposta;

  return NextResponse.json({ status: obterStatusStorageBackup() }, { headers });
}

export async function POST(req: Request) {
  const perm = await verificarPermissao(req);
  if (!perm.ok) return perm.resposta;

  const statusAtual = obterStatusStorageBackup();
  if (statusAtual.fase === 'listando' || statusAtual.fase === 'baixando' || statusAtual.fase === 'enviando') {
    return NextResponse.json(
      { error: 'Um backup do Storage já está em andamento. Aguarde a conclusão.' },
      { status: 409, headers },
    );
  }

  void iniciarBackupStorageGlass().catch((err) => {
    console.error('[backup-glass-storage] Erro em background:', err);
  });

  return NextResponse.json(
    { mensagem: 'Backup do Storage iniciado com sucesso.' },
    { status: 202, headers },
  );
}
