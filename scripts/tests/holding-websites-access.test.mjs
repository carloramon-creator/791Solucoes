import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

function loadModule(path, dependencies) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

const codes = ['menu.websites', 'action.websites.view', 'action.websites.create', 'action.websites.edit', 'action.websites.manage'];
const denied = { menu: false, view: false, create: false, edit: false, manage: false };

function permissionsFixture(overrides = {}) {
  const tables = {
    holding_user_permission_profiles: [{ user_email: 'staff@example.test', profile_id: 'staff' }],
    holding_permission_profiles: [{ id: 'staff', name: 'Administrador', active: true }],
    holding_permission_resources: codes.map((code) => ({ code, active: true })),
    holding_profile_resource_permissions: codes.map((resource_code) => ({ profile_id: 'staff', resource_code, enabled: true })),
    ...overrides.tables,
  };
  const calls = [];
  const supabaseServer = {
    from(table) {
      calls.push(table);
      let rows = tables[table] || [];
      const query = {
        select() { return query; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return query; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        then(resolve, reject) {
          return Promise.resolve({
            data: overrides.failedTable === table ? null : rows,
            error: overrides.failedTable === table ? new Error('Database unavailable') : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const dependencies = { '@/lib/supabase-server': { supabaseServer }, 'next/server': { NextResponse: Response } };
  return { calls, ...loadModule('src/lib/holding-websites-permissions.ts', dependencies),
    ...loadModule('src/lib/holding-permission-management.ts', dependencies) };
}

test('requires explicit grants for each Websites capability and normalizes identity', async () => {
  const helper = permissionsFixture();
  assert.deepEqual(await helper.getHoldingWebsitesPermissions(' STAFF@EXAMPLE.TEST '),
    { menu: true, view: true, create: true, edit: true, manage: true });
  for (const [index, capability] of ['menu', 'view', 'create', 'edit', 'manage'].entries()) {
    const helper = permissionsFixture({
      tables: { holding_profile_resource_permissions: [{ profile_id: 'staff', resource_code: codes[index], enabled: true }] },
    });
    assert.deepEqual(await helper.getHoldingWebsitesPermissions('staff@example.test'), { ...denied, [capability]: true });
  }
});

test('missing profiles, inactive profiles, inactive resources and disabled grants fail closed', async () => {
  for (const tables of [
    { holding_user_permission_profiles: [] },
    { holding_permission_profiles: [{ id: 'staff', name: 'Administrador', active: false }] },
    { holding_permission_resources: codes.map((code) => ({ code, active: false })) },
    { holding_profile_resource_permissions: codes.map((resource_code) => ({ profile_id: 'staff', resource_code, enabled: false })) },
    { holding_profile_resource_permissions: codes.map((resource_code) => ({ profile_id: 'another-person', resource_code, enabled: true })) },
  ]) {
    assert.deepEqual(await permissionsFixture({ tables }).getHoldingWebsitesPermissions('staff@example.test'), denied);
  }
  const helper = permissionsFixture();
  assert.deepEqual(await helper.getHoldingWebsitesPermissions(null), denied);
  assert.deepEqual(await helper.getHoldingWebsitesPermissions('unknown@example.test'), denied);
});

test('permission query failures propagate instead of granting bootstrap access', async () => {
  for (const failedTable of [
    'holding_user_permission_profiles', 'holding_permission_profiles',
    'holding_permission_resources', 'holding_profile_resource_permissions',
  ]) {
    await assert.rejects(permissionsFixture({ failedTable }).getHoldingWebsitesPermissions('staff@example.test'), /Database unavailable/);
  }
});

test('only explicit permission managers or the active system owner can change staff grants', async () => {
  const email = 'staff@example.test';
  assert.equal((await permissionsFixture().authorizePermissionManagement(email)).status, 403);
  assert.equal((await permissionsFixture({ tables: { holding_user_permission_profiles: [] } }).authorizePermissionManagement(email)).status, 403);
  const systemOwner = permissionsFixture({ tables: { holding_permission_profiles: [{ id: 'staff', name: 'Dono', is_system: true, active: true }] } });
  assert.equal(await systemOwner.authorizePermissionManagement(email), null);
  const fakeOwner = permissionsFixture({ tables: { holding_permission_profiles: [{ id: 'staff', name: 'Dono', is_system: false, active: true }] } });
  assert.equal((await fakeOwner.authorizePermissionManagement(email)).status, 403);
  const managerTables = {
    holding_permission_resources: [{ code: 'action.permissions.manage_profiles', active: true }],
    holding_profile_resource_permissions: [{ profile_id: 'staff', resource_code: 'action.permissions.manage_profiles', enabled: true }],
  };
  assert.equal(await permissionsFixture({ tables: managerTables }).authorizePermissionManagement(email), null);
  assert.equal((await permissionsFixture({ tables: { ...managerTables, holding_permission_profiles: [{ id: 'staff', active: false }] } }).authorizePermissionManagement(email)).status, 403);
  assert.equal((await permissionsFixture({ failedTable: 'holding_user_permission_profiles' }).authorizePermissionManagement(email)).status, 503);
});

test('all permission mutation endpoints reject nonmanagers before writing to the database', async () => {
  for (const [path, methods] of [
    ['src/app/api/admin/permissions/route.ts', ['POST']],
    ['src/app/api/admin/permissions/[id]/route.ts', ['PATCH', 'DELETE']],
    ['src/app/api/admin/permissions/users/[email]/route.ts', ['PATCH']],
  ]) {
    const route = loadModule(path, {
      'next/server': { NextResponse: Response },
      '@/lib/supabase-server': { supabaseServer: { from() { throw new Error('Unauthorized database access'); } } },
      '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true, user: { email: 'staff@example.test' } }) },
      '@/lib/holding-permission-management': { authorizePermissionManagement: async () => Response.json({ error: 'Denied' }, { status: 403 }) },
      '@/lib/holding-permissions': {},
    });
    for (const method of methods) assert.equal((await route[method](new Request('https://holding.test', { method }))).status, 403);
  }
});

function routeFixture({ authStatus = 200, permissions = { ...denied, menu: true }, fail = false, modulePath = 'src/app/api/admin/websites/access/route.ts' } = {}) {
  let permissionCalls = 0;
  const route = loadModule(modulePath, {
    '@/lib/supabase-server': { supabaseServer: {} },
    '@/lib/holding-websites-sso': {},
    'next/server': { NextResponse: Response },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => authStatus === 200
        ? { ok: true, user: { email: 'staff@example.test' } }
        : { ok: false, status: authStatus, error: 'Access denied' },
    },
    '@/lib/holding-websites-permissions': {
      WEBSITE_PERMISSION_CODES: Object.fromEntries(['menu', 'view', 'create', 'edit', 'manage'].map((key, index) => [key, codes[index]])),
      getHoldingWebsitesPermissions: async () => {
        permissionCalls++;
        if (fail) throw new Error('Database unavailable');
        return permissions;
      },
    },
    '@/lib/holding-permissions': {
      getUserProfileIds: async () => ['staff'],
      getUserPermissionCodes: async () => new Set(['menu.planos', ...codes]),
    },
  });
  return { request: () => route.GET(new Request('https://holding.example.test/api/admin/websites/access')), calls: () => permissionCalls };
}

test('launcher authenticates and rechecks the menu permission without granting access through action permissions', async () => {
  for (const authStatus of [401, 403]) {
    const route = routeFixture({ authStatus });
    assert.equal((await route.request()).status, authStatus);
    assert.equal(route.calls(), 0);
  }
  const route = routeFixture({ permissions: { menu: false, view: true, create: true, edit: true } });
  assert.equal((await route.request()).status, 403);
  const granted = await routeFixture().request();
  assert.equal(granted.status, 200);
  assert.equal(granted.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await granted.json(), { url: 'https://websites.791solucoes.com.br/auth/holding/start' });
  assert.equal((await routeFixture({ fail: true }).request()).status, 503);
});

test('permissions/me replaces legacy owner grants with the explicit Websites capabilities', async () => {
  const modulePath = 'src/app/api/admin/permissions/me/route.ts';
  const response = await routeFixture({ modulePath, permissions: denied }).request();
  assert.deepEqual((await response.json()).permissionCodes, ['menu.planos']);
  const granted = await routeFixture({ modulePath, permissions: { ...denied, menu: true, view: true } }).request();
  assert.deepEqual((await granted.json()).permissionCodes, ['action.websites.view', 'menu.planos', 'menu.websites']);
  assert.equal((await routeFixture({ modulePath, fail: true }).request()).status, 503);
});

test('sidebar places Websites below Cupons, honors explicit permission and supports collapsed navigation', () => {
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const granted of [true, false]) {
    for (const fallback of [true, false]) {
      for (const collapsed of [true, false]) {
        const states = [{}, false, 'STAFF', '', new Set(granted ? ['menu.websites', 'menu.cupons', 'menu.configuracoes'] : ['menu.cupons', 'menu.configuracoes']), fallback, true, 0, 0];
        let stateIndex = 0;
        const { Sidebar } = loadModule('src/components/Sidebar.tsx', {
          react: { useEffect() {}, useMemo: (fn) => fn(), useState: () => [states[stateIndex++], () => {}] },
          'react/jsx-runtime': require('react/jsx-runtime'),
          'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
          'next/navigation': { usePathname: () => '/websites' },
          'lucide-react': require('lucide-react'),
          '@/lib/supabase-browser': { createSupabaseBrowser: () => ({}) },
        });
        const html = renderToStaticMarkup(React.createElement(Sidebar, { collapsed, onToggle() {} }));
        const destination = 'href="https://websites.791solucoes.com.br/auth/holding/start"';
        assert.equal(html.includes(destination), granted);
        if (granted) {
          assert.ok(html.indexOf('href="/cupons"') < html.indexOf(destination));
          assert.ok(html.indexOf(destination) < html.indexOf('href="/configuracoes"'));
          assert.match(html, /href="https:\/\/websites\.791solucoes\.com\.br\/auth\/holding\/start" target="_blank" rel="noopener noreferrer"/);
        }
      }
    }
  }
});

test('Websites authorization never mounts the administrative layout or its auth effects', () => {
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const pathname of ['/websites', '/', '/assinaturas/websites', '/planos/websites']) {
    let panelInitialization = 0;
    const { MainLayoutWrapper } = loadModule('src/components/MainLayoutWrapper.tsx', {
      react: { useEffect() {}, useState: (initial) => [initial, () => {}] },
      'react/jsx-runtime': require('react/jsx-runtime'),
      'next/navigation': { usePathname: () => pathname, useRouter: () => ({}) },
      '@/lib/supabase-browser': { createSupabaseBrowser: () => { panelInitialization++; return {}; } },
      '@/components/Sidebar': { Sidebar: () => React.createElement('aside', null, 'Sidebar') },
      '@/components/Topbar': { Topbar: () => null },
      '@/components/InternalTenantChatWidget': { default: () => null },
      'lucide-react': require('lucide-react'),
    });
    const html = renderToStaticMarkup(React.createElement(MainLayoutWrapper, null, 'Autorizando Websites'));
    if (pathname === '/websites') {
      assert.equal(panelInitialization, 0);
      assert.match(html, /Autorizando Websites/);
      assert.doesNotMatch(html, /Carregando painel|Sidebar/);
    } else {
      assert.equal(panelInitialization, 1);
      assert.match(html, /Carregando painel/);
    }
  }
});
