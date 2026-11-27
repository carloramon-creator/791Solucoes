import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

function setup({ users = [], profiles = [], tenants = [], pages, canListTechnical = true } = {}) {
  const deleted = [];
  const tables = { user_profiles: profiles, vidracarias: tenants, pessoas: [] };
  const glass = {
    from(table) {
      return {
        select() { return this; },
        order() { return this; },
        not() { return this; },
        range(start, end) {
          return Promise.resolve({ data: tables[table].slice(start, end + 1), error: null });
        },
      };
    },
    auth: { admin: {
      async listUsers({ page }) {
        return { data: pages ? pages[page - 1] : { users: page === 1 ? users : [], nextPage: null }, error: null };
      },
      async getUserById(id) {
        return { data: { user: users.find((user) => user.id === id) || null }, error: null };
      },
    } },
  };
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@supabase/supabase-js': { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'admin', email: 'admin@example.test' } }, error: null }) },
      from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } }),
    }) },
    '@/lib/glass-client': { getGlassClient: async () => glass },
    '@/lib/holding-route-permissions': {
      hasExplicitHoldingPermission: async (_email, permissions) =>
        permissions.length !== 1 || permissions[0] !== 'menu.assinaturas' || canListTechnical,
    },
    '@/lib/glass-auth-user-cleanup': { deleteGlassAuthUser: async (_glass, id) => { deleted.push(id); return true; } },
  };
  return {
    list: load('src/app/api/admin/glass-users/route.ts', dependencies).GET,
    remove: load('src/app/api/admin/auth-users/[userId]/route.ts', dependencies).DELETE,
    deleted,
  };
}

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://holding.example.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
const request = (path, method = 'GET') => new Request(`https://holding.example.test${path}`, {
  method, headers: { authorization: 'Bearer test-token' },
});

test('lists unverified and orphaned Auth users, deleted tenants and technical accounts', async () => {
  const users = [
    { id: 'orphan', email: 'orphan@example.test', created_at: '2026-01-01', email_confirmed_at: null },
    { id: 'linked', email: 'linked@example.test', email_confirmed_at: '2026-01-02' },
    { id: 'technical', user_metadata: { holding_chat: true }, email_confirmed_at: null },
  ];
  const profiles = [
    { user_id: 'linked', vidracaria_id: 'deleted', ativo: true },
    { user_id: 'technical', vidracaria_id: null, ativo: true },
  ];
  const { list } = setup({ users, profiles });
  const data = await (await list(request('/api/admin/glass-users?includeTechnical=true'))).json();
  assert.equal(data.total, 3);
  assert.equal(data.users.find((user) => user.userId === 'orphan').emailConfirmado, false);
  assert.equal(data.users.find((user) => user.userId === 'orphan').possuiPerfil, false);
  assert.equal(data.users.find((user) => user.userId === 'orphan').vidracariaExiste, false);
  assert.equal(data.users.find((user) => user.userId === 'linked').vidracariaNome, 'Vidraçaria excluída');
  assert.equal(data.users.find((user) => user.userId === 'linked').emailConfirmado, true);
  assert.equal(data.users.find((user) => user.userId === 'technical').contaTecnica, true);
  assert.equal(data.users.find((user) => user.userId === 'technical').emailConfirmado, null);
  const supportData = await (await list(request('/api/admin/glass-users'))).json();
  assert.equal(supportData.users.some((user) => user.userId === 'technical'), false);
});

test('follows Auth pagination even when a page is shorter than requested', async () => {
  const pages = [
    { users: [{ id: 'first' }], nextPage: 2 },
    { users: [{ id: 'second' }], nextPage: null },
  ];
  const { list } = setup({ pages });
  const data = await (await list(request('/api/admin/glass-users'))).json();
  assert.deepEqual(data.users.map((user) => user.userId), ['first', 'second']);
});

test('technical accounts require permission to list and explicit confirmation to delete', async () => {
  const users = [{ id: 'technical', user_metadata: { holding_support: true } }];
  const restricted = setup({ users, canListTechnical: false });
  assert.equal((await restricted.list(request('/api/admin/glass-users?includeTechnical=true'))).status, 403);
  const { remove, deleted } = setup({ users });
  const context = { params: Promise.resolve({ userId: 'technical' }) };
  assert.equal((await remove(request('/api/admin/auth-users/technical', 'DELETE'), context)).status, 409);
  assert.deepEqual(deleted, []);
  assert.equal((await remove(request('/api/admin/auth-users/technical?confirmTechnical=true', 'DELETE'), context)).status, 200);
  assert.deepEqual(deleted, ['technical']);
});
