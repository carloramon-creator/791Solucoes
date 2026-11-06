import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseServer as db } from '@/lib/supabase-server';
import { inspectWebsitesSession } from '@/lib/holding-websites-sso';
import { websiteProjects } from '@/lib/website-projects';
import { getHoldingWebsitesPermissions } from '@/lib/holding-websites-permissions';

export function validWebsitesSyncRequest(request: Request, body = '') {
  const secret = process.env.WEBSITES_SYNC_SECRET;
  if (!secret || secret.length < 32) throw new Error('Configure WEBSITES_SYNC_SECRET nos dois aplicativos.');
  const timestamp = request.headers.get('x-holding-timestamp') || '';
  const signature = request.headers.get('x-holding-signature') || '';
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)
    || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function outbox() {
  const result = await db.from('holding_websites_sync_outbox')
    .select('revision,delivered_revision').eq('id', true).single();
  if (result.error) throw result.error;
  if (!Number.isSafeInteger(result.data.revision) || result.data.revision < 1) {
    throw new Error('Revisão de sincronização inválida.');
  }
  return result.data;
}

export async function websitesSnapshot() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await outbox();
    const sessions = [];
    const now = new Date().toISOString();
    const permissions = new Map<string, ReturnType<typeof getHoldingWebsitesPermissions>>();
    const permissionsFor: typeof getHoldingWebsitesPermissions = (email) => {
      const key = email?.trim().toLowerCase() || '';
      let result = permissions.get(key);
      if (!result) {
        result = getHoldingWebsitesPermissions(email);
        permissions.set(key, result);
      }
      return result;
    };
    for (let offset = 0; ; offset += 500) {
      const result = await db.from('holding_websites_sessions').select('token_hash')
        .gt('expires_at', now).order('token_hash').range(offset, offset + 499);
      if (result.error) throw result.error;
      for (let start = 0; start < result.data.length; start += 10) {
        const batch = await Promise.all(result.data.slice(start, start + 10).map(async (row) => {
          const session = await inspectWebsitesSession(row.token_hash, true, permissionsFor);
          return session ? { tokenHash: row.token_hash, ...session } : null;
        }));
        sessions.push(...batch.filter((session) => session !== null));
      }
      if (result.data.length < 500) break;
    }
    const projects = await websiteProjects('', true);
    const progress = [];
    for (let offset = 0; offset < projects.length; offset += 100) {
      const result = await db.from('holding_website_contracts').select('id,production_stage,production_version')
        .in('id', projects.slice(offset, offset + 100).map((project) => project.contractId));
      if (result.error) throw result.error;
      progress.push(...result.data.map((row) => ({
        contractId: row.id, stage: row.production_stage, version: row.production_version,
      })));
    }
    const after = await outbox();
    if (before.revision === after.revision) return { revision: after.revision, sessions, projects, progress };
  }
  throw new Error('A Holding mudou durante a sincronização. A fila tentará novamente.');
}

export async function deliverWebsitesSnapshot() {
  const state = await outbox();
  if (state.revision <= state.delivered_revision) return { pending: false };
  try {
    const secret = process.env.WEBSITES_SYNC_SECRET;
    if (!secret || secret.length < 32) throw new Error('Configure WEBSITES_SYNC_SECRET nos dois aplicativos.');
    const snapshot = await websitesSnapshot();
    const body = JSON.stringify(snapshot);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await fetch('https://websites.791solucoes.com.br/api/holding/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-holding-timestamp': timestamp, 'x-holding-signature': signature },
      body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Websites recusou a sincronização (${response.status}).`);
    const ack: unknown = await response.json();
    if (!ack || typeof ack !== 'object' || !('revision' in ack)
      || !Number.isSafeInteger(ack.revision) || Number(ack.revision) < snapshot.revision) {
      throw new Error('Websites não confirmou a revisão enviada.');
    }
    const result = await db.rpc('acknowledge_websites_sync', { p_revision: snapshot.revision });
    if (result.error) throw result.error;
    return { revision: snapshot.revision };
  } catch (error) {
    const recorded = await db.from('holding_websites_sync_outbox')
      .update({ last_error: error instanceof Error ? error.message : 'Falha de sincronização.' }).eq('id', true);
    if (recorded.error) console.error('[WEBSITES SYNC] Falha ao registrar erro.', { code: recorded.error.code });
    throw error;
  }
}
