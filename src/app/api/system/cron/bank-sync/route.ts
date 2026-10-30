import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { syncBankAccounts } from '@/lib/bank-sync';

export const maxDuration = 60;

/** Chamado de hora em hora pelo pg_cron da holding (segredo no Vault) ou manualmente com ?secret=CRON_SECRET. */
async function authorized(req: Request) {
  const { searchParams } = new URL(req.url);
  const querySecret = searchParams.get('secret');
  if (process.env.CRON_SECRET && querySecret === process.env.CRON_SECRET) return true;
  const headerSecret = req.headers.get('x-bank-sync-secret');
  if (!headerSecret || headerSecret.length < 32) return false;
  const { data } = await supabaseServer.rpc('bank_sync_secret_ok', { p_secret: headerSecret });
  return data === true;
}

async function handle(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const results = await syncBankAccounts();
    return NextResponse.json({ success: true, results });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Falha.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
