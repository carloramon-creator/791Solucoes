import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}
function environment(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
const project = { contractId: 'contract' };
const session = { user: { id: 'staff', email: 'staff@example.test' }, permissions: { menu: true, view: true, manage: false }, expiresAt: '2099-01-01' };
function fixture() {
  const state = { revision: 1, delivered_revision: 0 };
  const calls = [];
  let reads = 0, changed = false;
  const db = {
    from(table) {
      let updated = null;
      const query = {
        select() { return this; }, eq() { return this; }, gt() { return this; }, order() { return this; },
        range: async () => ({ data: [{ token_hash: 'a'.repeat(64) }, { token_hash: 'b'.repeat(64) }] }),
        in: async () => ({ data: [{ id: 'contract', production_stage: 'briefing', production_version: 2 }] }),
        single: async () => {
          reads++;
          if (changed && reads === 2) state.revision++;
          return { data: { ...state } };
        },
        update(value) { updated = value; calls.push({ table, updated }); return this; },
        then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
      };
      return query;
    },
    rpc: async (name, args) => { calls.push({ name, args }); state.delivered_revision = args.p_revision; return { error: null }; },
  };
  const api = load('src/lib/websites-sync.ts', {
    'node:crypto': require('node:crypto'), '@/lib/supabase-server': { supabaseServer: db },
    '@/lib/holding-websites-sso': { inspectWebsitesSession: async (hash, hashed) => {
      assert.equal(hashed, true);
      return hash.startsWith('a') ? session : null;
    } },
    '@/lib/website-projects': { websiteProjects: async (email, manager) => { assert.equal(manager, true); return [project]; } },
    '@/lib/holding-websites-permissions': { getHoldingWebsitesPermissions: async () => session.permissions },
  });
  return { api, db, calls, state, changeDuringRead() { changed = true; } };
}

test('snapshot excludes revoked sessions and retries when a mutation commits during collection', async () => {
  const f = fixture();
  f.changeDuringRead();
  assert.deepEqual(await f.api.websitesSnapshot(), { revision: 2, sessions: [{ tokenHash: 'a'.repeat(64), ...session }],
    projects: [project], progress: [{ contractId: 'contract', stage: 'briefing', version: 2 }] });
});

test('delivery signs exact bytes and acknowledges the outbox only after durable remote confirmation', async (t) => {
  environment(t, 'WEBSITES_SYNC_SECRET', 'test-only-shared-key-with-at-least-32-characters');
  const f = fixture();
  let status = 200, ack = { revision: 1 };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://websites.791solucoes.com.br/api/holding/events');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['x-holding-signature'], createHmac('sha256', process.env.WEBSITES_SYNC_SECRET)
      .update(`${init.headers['x-holding-timestamp']}.${init.body}`).digest('hex'));
    return Response.json(ack, { status });
  });
  await f.api.deliverWebsitesSnapshot();
  assert.equal(f.state.delivered_revision, 1);
  f.state.revision = 2; status = 503;
  await assert.rejects(f.api.deliverWebsitesSnapshot(), /recusou/);
  assert.equal(f.state.delivered_revision, 1);
  status = 200; ack = { revision: 1 };
  await assert.rejects(f.api.deliverWebsitesSnapshot(), /não confirmou/);
  assert.equal(f.state.delivered_revision, 1);
  ack = { revision: 3 };
  await f.api.deliverWebsitesSnapshot();
  assert.equal(f.state.delivered_revision, 2);
  assert.equal(f.calls.filter((call) => call.name === 'acknowledge_websites_sync').length, 2);
  assert.equal(f.calls.filter((call) => call.updated?.last_error).length, 2);
});

test('bootstrap endpoint never exposes the global projection to a staff bearer token', async (t) => {
  environment(t, 'WEBSITES_SYNC_SECRET', 'test-only-shared-key-with-at-least-32-characters');
  const f = fixture();
  const { GET } = load('src/app/api/websites/snapshot/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/websites-sync': f.api,
  });
  assert.equal((await GET(new Request('https://holding.test', { headers: { authorization: 'Bearer staff-token' } }))).status, 401);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', process.env.WEBSITES_SYNC_SECRET).update(`${timestamp}.`).digest('hex');
  const response = await GET(new Request('https://holding.test', {
    headers: { 'x-holding-timestamp': timestamp, 'x-holding-signature': signature },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('transactional outbox covers scope, assignment, subscription, profiles, origin logout and bans; rollback loses no event', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema vault; create schema net; create schema cron;
      create table auth.users(id uuid primary key,email text,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create table holding_websites_sessions(token_hash text,user_id uuid,auth_session_id uuid,expires_at timestamptz);
      create table holding_website_contracts(id integer);
      create table holding_website_subscriptions(id integer);
      create table holding_permission_profiles(id integer);
      create table holding_permission_resources(id integer);
      create table holding_profile_resource_permissions(id integer);
      create table holding_user_permission_profiles(id integer);
      create table vault.secrets(name text);
      insert into vault.secrets values ('websites_sync_cron_secret');
      create view vault.decrypted_secrets as select name,repeat('s',32) decrypted_secret from vault.secrets;
      create table net.requests(id bigint generated always as identity,url text,headers jsonb);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint
        language sql as $$ insert into net.requests(url,headers) values(url,headers) returning id $$;
      create function cron.schedule(name text,schedule text,command text) returns bigint
        language sql as $$ select 1::bigint $$;
    `);
    const migration = readFileSync('supabase/migrations/20261106011000_websites_event_outbox.sql', 'utf8')
      .replace(/^create extension if not exists pg_(cron|net);$/gm, '');
    await db.exec(migration);
    assert.equal((await db.query('select revision from holding_websites_sync_outbox')).rows[0].revision, 1);
    await db.exec('select acknowledge_websites_sync(1)');
    const requests = Number((await db.query('select count(*) n from net.requests')).rows[0].n);
    await db.exec('select request_websites_sync()');
    assert.equal(Number((await db.query('select count(*) n from net.requests')).rows[0].n), requests);
    for (const table of ['holding_website_contracts', 'holding_website_subscriptions',
      'holding_permission_profiles', 'holding_permission_resources', 'holding_profile_resource_permissions', 'holding_user_permission_profiles']) {
      const before = (await db.query('select revision from holding_websites_sync_outbox')).rows[0].revision;
      await db.exec(`insert into ${table} values (1)`);
      assert.equal((await db.query('select revision from holding_websites_sync_outbox')).rows[0].revision, before + 1);
    }
    const before = (await db.query('select revision from holding_websites_sync_outbox')).rows[0].revision;
    const queued = Number((await db.query('select count(*) n from net.requests')).rows[0].n);
    await db.exec("begin; update holding_website_contracts set id=2; update holding_website_subscriptions set id=2; rollback;");
    assert.equal((await db.query('select revision from holding_websites_sync_outbox')).rows[0].revision, before);
    assert.equal(Number((await db.query('select count(*) n from net.requests')).rows[0].n), queued);
    await db.exec("begin; update holding_website_contracts set id=2; update holding_website_subscriptions set id=2; commit;");
    assert.equal(Number((await db.query('select count(*) n from net.requests')).rows[0].n), queued + 1);
    await db.exec("delete from auth.sessions; update auth.users set banned_until=now(); delete from holding_websites_sessions;");
    assert.equal((await db.query('select revision from holding_websites_sync_outbox')).rows[0].revision, before + 5);
    await db.exec(`select acknowledge_websites_sync(${before + 2}); select acknowledge_websites_sync(1);`);
    const state = (await db.query('select revision,delivered_revision from holding_websites_sync_outbox')).rows[0];
    assert.equal(state.delivered_revision, before + 2);
    assert.ok(state.revision > state.delivered_revision);
    await db.exec(`
      insert into auth.users values ('10000000-0000-4000-8000-000000000001','staff@example.test',null);
      insert into auth.sessions values ('20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',now()+interval '1 hour');
      insert into holding_websites_sessions values (repeat('a',64),'10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',now()+interval '8 hours');
    `);
    assert.equal((await db.query(`select expires_at=(select not_after from auth.sessions) limited
      from inspect_holding_websites_session(repeat('a',64))`)).rows[0].limited, true);
    await db.exec("update auth.users set banned_until=now()+interval '1 day'");
    assert.equal((await db.query("select * from inspect_holding_websites_session(repeat('a',64))")).rows.length, 0);
    await db.exec('set role authenticated');
    await assert.rejects(db.exec('select * from holding_websites_sync_outbox'), /permission denied/);
    await assert.rejects(db.exec('select request_websites_sync()'), /permission denied/);
  } finally { await db.close(); }
});
