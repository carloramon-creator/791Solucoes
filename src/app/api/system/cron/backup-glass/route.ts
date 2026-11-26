/**
 * /api/system/cron/backup-glass
 * Rota chamada de hora em hora para executar o backup automático do Glass (Banco e/ou Storage).
 * Autenticação via segredo compartilhado:
 *   - ?secret=CRON_SECRET ou Authorization: Bearer CRON_SECRET
 */

import { NextResponse } from 'next/server';
import { iniciarBackupGlass, obterStatusBackup } from '@/lib/backup-glass';
import { iniciarBackupStorageGlass, obterStatusStorageBackup } from '@/lib/backup-glass-storage';

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

  const statusBanco = obterStatusBackup();
  const statusStorage = obterStatusStorageBackup();

  const bancoOcupado = statusBanco.fase === 'exportando' || statusBanco.fase === 'enviando';
  const storageOcupado = statusStorage.fase === 'listando' || statusStorage.fase === 'baixando' || statusStorage.fase === 'enviando';

  if (bancoOcupado && storageOcupado) {
    return NextResponse.json({
      status: 'ignorado',
      mensagem: 'Tanto o backup do Banco quanto do Storage já estão em execução.',
    }, { status: 200 });
  }

  try {
    // 1. Disparar backup do Banco se não estiver ocupado
    if (!bancoOcupado) {
      void iniciarBackupGlass().catch(err => {
        console.error('[CRON BACKUP GLASS - BANCO] Erro:', err);
      });
    }

    // 2. Disparar backup do Storage se não estiver ocupado
    if (!storageOcupado) {
      void iniciarBackupStorageGlass().catch(err => {
        console.error('[CRON BACKUP GLASS - STORAGE] Erro:', err);
      });
    }

    return NextResponse.json({
      status: 'disparado',
      mensagem: 'Backup horário completo do Glass (Banco + Storage) disparado com sucesso.',
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
