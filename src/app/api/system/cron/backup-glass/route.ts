/**
 * /api/system/cron/backup-glass
 * Rota chamada de hora em hora para executar o backup automático do Glass (Banco e/ou Storage).
 * Autenticação via segredo compartilhado:
 *   - ?secret=CRON_SECRET ou Authorization: Bearer CRON_SECRET
 */

import { NextResponse } from 'next/server';
import { iniciarBackupGlass, obterStatusBackup } from '@/lib/backup-glass';

export const dynamic = 'force-dynamic';

function autorizar(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const url = new URL(req.url);
  const secretParam = url.searchParams.get('secret');
  if (secretParam === cronSecret) return true;

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.replace(/^Bearer\s+/i, '').trim() === cronSecret) return true;

  const xCronHeader = req.headers.get('x-cron-secret');
  if (xCronHeader === cronSecret) return true;

  return false;
}

async function executarBackup(req: Request) {
  if (!autorizar(req)) {
    return NextResponse.json({ error: 'Acesso não autorizado. Informe o segredo do cron.' }, { status: 401 });
  }

  const statusAtual = obterStatusBackup();
  if (statusAtual.fase === 'exportando' || statusAtual.fase === 'enviando') {
    return NextResponse.json({
      status: 'ignorado',
      mensagem: 'Um backup já está em andamento. Nenhuma ação disparada.',
    }, { status: 200 });
  }

  try {
    // Dispara o backup do banco de forma assíncrona
    void iniciarBackupGlass().catch(err => {
      console.error('[CRON BACKUP GLASS] Erro:', err);
    });

    return NextResponse.json({
      status: 'disparado',
      mensagem: 'Backup horário do Glass disparado com sucesso.',
      timestamp: new Date().toISOString(),
    }, { status: 202 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao disparar backup horário.';
    console.error('[CRON BACKUP GLASS] Falha:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = executarBackup;
export const POST = executarBackup;
