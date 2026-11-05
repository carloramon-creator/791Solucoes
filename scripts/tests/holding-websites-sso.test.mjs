import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

const userId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000002';
const value = () => randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const allowed = { menu: true, view: true, create: true, edit: true };

function fixture(options = {}) {
  const calls = [];
  let permissions = options.permissions || allowed;
  const db = {
    from(table) {
      const query = {
        insert: async (data) => { calls.push({ table, data }); return { error: options.dbError ? { code: 'unavailable' } : null }; },
        delete() { return query; },
        eq: async (key, value) => { calls.push({ table, key, value, delete: true }); return { error: null }; },
      };
      return query;
    },
    async rpc(name, data) {
      calls.push({ name, data });
      if (options.dbError) return { error: new Error('unavailable'), data: null };
      if (name === 'exchange_holding_websites_code') {
        return { error: null, data: options.rejectedCode ? [] : [{ expires_at: new Date(Date.now() + 28800000).toISOString() }] };
      }
      return { error: null, data: options.expired ? [] : [{
        user_id: userId, email: 'staff@example.test', expires_at: new Date(Date.now() + 28800000).toISOString(),
      }] };
    },
  };
  const common = {
    '@/lib/supabase-server': { supabaseServer: db },
    '@/lib/holding-websites-permissions': { getHoldingWebsitesPermissions: async () => permissions },
    'node:crypto': { createHash, randomBytes },
    'next/server': { NextResponse: Response },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => options.denied
        ? { ok: false, status: options.denied, error: 'Denied' }
        : { ok: true, user: { id: userId, email: 'staff@example.test' } },
    },
  };
  const helpers = load('src/lib/holding-websites-sso.ts', common);
  const deps = { ...common, '@/lib/holding-websites-sso': helpers };
  const issuer = load('src/app/api/admin/websites/access/route.ts', deps);
  const sessions = load('src/app/api/websites/session/route.ts', deps);
  const authToken = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.signature`;
  const request = (method, body, token = authToken) => new Request('https://holding.test/api/websites/session', {
    method, headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { calls, helpers, issuer, sessions, request, setPermissions: (next) => { permissions = next; } };
}

test('issuer requires authenticated menu/view grants and a valid state/PKCE challenge', async () => {
  for (const denied of [401, 403]) {
    const f = fixture({ denied });
    assert.equal((await f.issuer.POST(f.request('POST', { state: value(), challenge: value() }))).status, denied);
    assert.equal(f.calls.length, 0);
  }
  for (const permissions of [{ ...allowed, menu: false }, { ...allowed, view: false }]) {
    const f = fixture({ permissions });
    assert.equal((await f.issuer.POST(f.request('POST', { state: value(), challenge: value() }))).status, 403);
    assert.equal(f.calls.length, 0);
  }
  for (const body of [null, {}, '{', { state: value(), challenge: 'bad' }]) {
    const f = fixture();
    assert.equal((await f.issuer.POST(f.request('POST', body))).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.issuer.POST(f.request('POST', { state: value(), challenge: value() }, 'bad'))).status, 401);
});

test('handoff stores only a hashed code, binds it to the verified Holding session, and fixes the callback host', async () => {
  const f = fixture(), state = value(), challenge = value();
  const response = await f.issuer.POST(f.request('POST', { state, challenge, redirect_uri: 'https://attacker.test' }));
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  assert.equal(url.origin + url.pathname, 'https://websites.791solucoes.com.br/auth/holding/callback');
  assert.equal(url.searchParams.get('state'), state);
  const code = url.searchParams.get('code');
  assert.ok(f.helpers.isSsoValue(code));
  assert.deepEqual(f.calls[0].data, { code_hash: hash(code), challenge, user_id: userId, auth_session_id: sessionId });
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('session exchange uses S256, hashes the session token and rejects invalid, expired or reused codes', async () => {
  const f = fixture(), code = value(), verifier = value();
  const response = await f.sessions.POST(f.request('POST', { code, verifier }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(f.helpers.isSsoValue(payload.token));
  assert.deepEqual(f.calls[0].data, {
    p_code_hash: hash(code), p_challenge: createHash('sha256').update(verifier).digest('base64url'), p_token_hash: hash(payload.token),
  });
  assert.deepEqual(payload.permissions, allowed);
  const expired = fixture({ rejectedCode: true });
  assert.equal((await expired.sessions.POST(expired.request('POST', { code, verifier }))).status, 401);
  for (const body of ['{', {}, null, { code: 'bad', verifier }]) {
    assert.equal((await f.sessions.POST(f.request('POST', body))).status, 400);
  }
});

test('every introspection checks current grants; expiry and revocation immediately deny access', async () => {
  const f = fixture(), token = value();
  assert.equal((await f.sessions.GET(f.request('GET', undefined, token))).status, 200);
  f.setPermissions({ ...allowed, edit: false, create: false });
  const readOnly = await f.sessions.GET(f.request('GET', undefined, token));
  assert.deepEqual((await readOnly.json()).permissions, { ...allowed, edit: false, create: false });
  f.setPermissions({ ...allowed, menu: false });
  assert.equal((await f.sessions.GET(f.request('GET', undefined, token))).status, 401);
  assert.equal((await f.sessions.POST(f.request('POST', { code: value(), verifier: value() }))).status, 403);
  assert.ok(f.calls.some((call) => call.delete));
  const expired = fixture({ expired: true });
  assert.equal((await expired.sessions.GET(expired.request('GET', undefined, token))).status, 401);
  assert.equal((await f.sessions.GET(f.request('GET', undefined, 'bad'))).status, 401);
  assert.equal((await f.sessions.DELETE(f.request('DELETE', undefined, token))).status, 200);
});

test('database failures do not produce an authorized session', async () => {
  const f = fixture({ dbError: true });
  assert.equal((await f.issuer.POST(f.request('POST', { state: value(), challenge: value() }))).status, 503);
  assert.equal((await f.sessions.POST(f.request('POST', { code: value(), verifier: value() }))).status, 503);
  assert.equal((await f.sessions.GET(f.request('GET', undefined, value()))).status, 503);
});
