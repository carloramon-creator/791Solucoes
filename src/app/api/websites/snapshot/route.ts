import { NextResponse } from 'next/server';
import { validWebsitesSyncRequest, websitesSnapshot } from '@/lib/websites-sync';

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    if (!validWebsitesSyncRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await websitesSnapshot(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[WEBSITES SYNC] Carga inicial indisponível.', error instanceof Error ? error.message : 'Falha.');
    return NextResponse.json({ error: 'Sincronização indisponível.' }, { status: 503 });
  }
}
