import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { deliverWebsitesSnapshot } from '@/lib/websites-sync';

export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = request.headers.get('x-websites-sync-secret');
  if (!secret || secret.length < 32) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const authorization = await supabaseServer.rpc('websites_sync_secret_ok', { p_secret: secret });
  if (authorization.error) {
    console.error('[WEBSITES SYNC] Autorização indisponível.', { code: authorization.error.code });
    return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 });
  }
  if (authorization.data !== true) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await deliverWebsitesSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[WEBSITES SYNC] Entrega pendente; haverá reenvio.', error instanceof Error ? error.message : 'Falha.');
    return NextResponse.json({ error: 'Sincronização pendente. A fila tentará novamente.' }, { status: 503 });
  }
}
