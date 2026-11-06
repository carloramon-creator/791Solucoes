import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

test('legacy project endpoint still validates access and never exposes session tokens', async () => {
  let session = { user: { id: 'staff-id', email: 'staff@example.test' }, permissions: { manage: true } };
  let inspections = 0;
  const queries = [];
  const { GET } = load('src/app/api/websites/projects/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-websites-sso': {
      isSsoValue: (token) => token === 't'.repeat(43),
      ssoHeaders: { 'Cache-Control': 'private, no-store' },
      inspectWebsitesSession: async () => { inspections++; return session; },
    },
    '@/lib/website-projects': { websiteProjects: async (...args) => { queries.push(args); return []; } },
  });
  const request = () => new Request('https://holding.test/api/websites/projects', {
    headers: { authorization: `Bearer ${'t'.repeat(43)}` },
  });
  const response = await GET(request());
  assert.deepEqual(await response.json(), { projects: [], manager: true });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(inspections, 1);
  assert.deepEqual(queries, [['staff@example.test', true]]);
  session = null;
  assert.equal((await GET(request())).status, 401);
  assert.equal(queries.length, 1);
  assert.equal((await GET(new Request('https://holding.test'))).status, 401);
  assert.equal(inspections, 2);
});

test('only active linked subscriptions for the same customer release assigned projects; no payment required', async () => {
  const contracts = [
    { id: 'a', customer_id: 'c', customer_snapshot: { name: 'Cliente' }, plan_snapshot: { name: 'Plano', scope: 'Escopo', website_features: ['configuration', 'briefing', 'templates', 'domain_managed', 'customer_dns', 'email_setup'] }, project_type: 'store', designer_email: 'designer@example.test' },
    { id: 'b', customer_id: 'c', customer_snapshot: { name: 'Cliente' }, plan_snapshot: { name: 'Plano', scope: 'Escopo' }, project_type: 'store', designer_email: 'other@example.test' },
  ];
  let subscriptions = [];
  const { websiteProjects } = load('src/lib/website-projects.ts', {
    '@/lib/website-plans': load('src/lib/website-plans.ts'),
    '@/lib/supabase-server': { supabaseServer: {
      from(table) {
        let rows = table === 'holding_website_contracts' ? contracts : subscriptions;
        return {
          select() { return this; }, not() { return this; }, order() { return this; },
          range(start, end) { rows = rows.slice(start, end + 1); return this; },
          in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
          eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
          then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
        };
      },
    } },
  });
  assert.deepEqual(await websiteProjects('designer@example.test', false), []);
  subscriptions = [{ contract_id: 'a', customer_id: 'wrong', lifecycle_status: 'active' }];
  assert.deepEqual(await websiteProjects('designer@example.test', false), []);
  subscriptions = [{ contract_id: 'a', customer_id: 'c', lifecycle_status: 'paused' }];
  assert.deepEqual(await websiteProjects('designer@example.test', false), []);
  subscriptions = contracts.map((row) => ({ contract_id: row.id, customer_id: row.customer_id, lifecycle_status: 'active' }));
  assert.deepEqual((await websiteProjects(' DESIGNER@EXAMPLE.TEST ', false)).map((row) => row.contractId), ['a']);
  const managerProjects = await websiteProjects('manager@example.test', true);
  assert.deepEqual(managerProjects.map((row) => row.contractId), ['a', 'b']);
  assert.deepEqual(managerProjects[0].websiteFeatures, ['configuration', 'briefing', 'templates', 'domain_managed', 'customer_dns', 'email_setup']);
  assert.deepEqual(managerProjects[1].websiteFeatures, ['configuration', 'briefing', 'templates', 'content', 'images', 'catalog']);
  contracts[0].designer_email = 'other@example.test';
  assert.deepEqual(await websiteProjects('designer@example.test', false), []);
});

test('projection source paginates contracts and subscriptions without dropping projects beyond the first database page', async () => {
  const contracts = Array.from({ length: 501 }, (_, index) => ({
    id: `contract-${index}`, customer_id: 'customer', customer_snapshot: { name: 'Cliente' },
    plan_snapshot: { name: 'Plano', scope: 'Escopo' }, project_type: 'institutional', designer_email: null,
  }));
  const subscriptions = [
    ...Array.from({ length: 500 }, (_, index) => ({ id: index, contract_id: contracts[0].id, customer_id: 'wrong', lifecycle_status: 'active' })),
    ...contracts.map((row, index) => ({ id: index + 500, contract_id: row.id, customer_id: row.customer_id, lifecycle_status: 'active' })),
  ];
  const { websiteProjects } = load('src/lib/website-projects.ts', {
    '@/lib/website-plans': load('src/lib/website-plans.ts'),
    '@/lib/supabase-server': { supabaseServer: { from(table) {
      let rows = table === 'holding_website_contracts' ? contracts : subscriptions;
      let start = 0, end = Infinity;
      return {
        select() { return this; }, not() { return this; }, order() { return this; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
        range(first, last) { start = first; end = last; return this; },
        then(resolve, reject) { return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject); },
      };
    } } },
  });
  const projects = await websiteProjects('', true);
  assert.equal(projects.length, 501);
  assert.equal(projects[0].contractId, contracts[0].id);
  assert.equal(projects[500].contractId, contracts[500].id);
});

test('project type is mandatory for creation and strictly validated for every plan category', () => {
  const { validateWebsitePlan, WEBSITE_PROJECT_TYPES } = load('src/lib/website-plans.ts');
  const plan = { name: 'Plano', description: '', scope: 'Escopo', category: 'creation', billing_cycle: 'one_time', price_cents: 1, active: true };
  for (const project_type of Object.keys(WEBSITE_PROJECT_TYPES)) assert.equal(validateWebsitePlan({ ...plan, project_type }).ok, true);
  for (const project_type of [undefined, null, '', '__proto__', 'all', {}]) assert.equal(validateWebsitePlan({ ...plan, project_type }).ok, false);
  assert.equal(validateWebsitePlan({ ...plan, category: 'hosting', billing_cycle: 'monthly', project_type: null }).ok, true);
});

test('assignment API requires explicit manager permission, never owner-name fallback or client claims', async () => {
  for (const permissions of [
    { menu: true, view: true, edit: true, manage: false },
    { menu: false, view: true, edit: true, manage: true },
    { menu: true, view: false, edit: true, manage: true },
  ]) {
    const route = load('src/app/api/admin/website-projects/route.ts', {
      'next/server': { NextResponse: Response },
      '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true, user: { email: 'designer@example.test' } }) },
      '@/lib/holding-websites-permissions': { getHoldingWebsitesPermissions: async () => permissions },
      '@/lib/holding-customers': {}, '@/lib/website-plans': {},
      '@/lib/supabase-server': { supabaseServer: { from() { throw new Error('Unauthorized database access'); } } },
    });
    for (const method of ['GET', 'PUT']) assert.equal((await route[method](new Request('https://holding.test', { method }))).status, 403);
  }
});

test('PostgreSQL preserves old contracts pending review and snapshots technical type independently from future catalog edits', async (t) => {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table holding_website_plans(id uuid primary key,category text);
    create table holding_website_contracts(id uuid primary key,plan_id uuid references holding_website_plans,customer_id uuid,plan_snapshot jsonb);
    create table holding_website_subscriptions(id uuid primary key,contract_id uuid references holding_website_contracts,plan_id uuid references holding_website_plans,customer_id uuid);
    create table holding_permission_profiles(id uuid primary key default gen_random_uuid(),name text,active boolean,is_system boolean);
    create table holding_permission_resources(code text primary key,label text,category text,parent_code text,sort_order integer,active boolean,updated_at timestamptz);
    create table holding_profile_resource_permissions(profile_id uuid,resource_code text,enabled boolean,primary key(profile_id,resource_code));
    insert into holding_website_plans values('10000000-0000-4000-8000-000000000001','creation');
    insert into holding_website_contracts values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','{}');
  `);
  await db.exec(readFileSync('supabase/migrations/20261105220000_website_project_scope.sql', 'utf8'));
  assert.equal((await db.query('select project_type from holding_website_contracts')).rows[0].project_type, null);
  const insert = `insert into holding_website_contracts values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','{}',null,null)`;
  await assert.rejects(db.exec(insert), /Revise/);
  await db.exec("update holding_website_plans set project_type='store';");
  await db.exec(insert);
  assert.equal((await db.query("select plan_snapshot->>'project_type' as type from holding_website_contracts where id='20000000-0000-4000-8000-000000000002'")).rows[0].type, 'store');
  await db.exec("update holding_website_plans set project_type='landing';");
  assert.equal((await db.query("select project_type from holding_website_contracts where id='20000000-0000-4000-8000-000000000002'")).rows[0].project_type, 'store');
  await assert.rejects(db.exec("update holding_website_contracts set project_type='landing' where project_type='store'"), /bloqueados/);
  await db.exec("update holding_website_contracts set project_type='institutional' where project_type is null");
  await assert.rejects(db.exec("insert into holding_website_subscriptions values(gen_random_uuid(),'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001')"), /mesmo cliente e tipo/);
  await db.exec("update holding_website_plans set project_type='store';");
  await db.exec("insert into holding_website_subscriptions values(gen_random_uuid(),'20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001')");
  await db.exec("update holding_website_plans set project_type='landing';");
  await db.exec("update holding_website_subscriptions set customer_id=customer_id;");
  await db.exec("insert into holding_website_contracts values('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','{}',null,null)");
  await db.exec("alter table holding_website_contracts disable trigger holding_website_project_scope; update holding_website_contracts set project_type=null where id='20000000-0000-4000-8000-000000000003'; alter table holding_website_contracts enable trigger holding_website_project_scope;");
  await db.exec(readFileSync('supabase/migrations/20261105235000_website_inherit_plan_type.sql', 'utf8'));
  const inherited = (await db.query("select project_type,plan_snapshot->>'project_type' as snapshot from holding_website_contracts where id='20000000-0000-4000-8000-000000000003'")).rows[0];
  assert.deepEqual(inherited, { project_type: 'landing', snapshot: 'landing' });
  await db.exec("update holding_website_plans set project_type='catalog'");
  assert.equal((await db.query("select project_type from holding_website_contracts where id='20000000-0000-4000-8000-000000000003'")).rows[0].project_type, 'landing');
  await db.exec("insert into holding_website_plans(id,category) values('10000000-0000-4000-8000-000000000002','creation'); alter table holding_website_contracts disable trigger holding_website_project_scope; insert into holding_website_contracts values(gen_random_uuid(),'10000000-0000-4000-8000-000000000002',null,'{}',null,null); alter table holding_website_contracts enable trigger holding_website_project_scope;");
  await db.exec("update holding_website_contracts set project_type='store' where plan_id='10000000-0000-4000-8000-000000000002'");
  assert.equal((await db.query("select project_type from holding_website_contracts where plan_id='10000000-0000-4000-8000-000000000002'")).rows[0].project_type, null);
  await db.exec("update holding_website_plans set project_type='portfolio' where id='10000000-0000-4000-8000-000000000002'");
  assert.equal((await db.query("select project_type from holding_website_contracts where plan_id='10000000-0000-4000-8000-000000000002'")).rows[0].project_type, 'portfolio');
});

test('assignment ignores client-supplied type and updates only the designer', async () => {
  let update;
  const route = load('src/app/api/admin/website-projects/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true, user: { email: 'manager@example.test' } }) },
    '@/lib/holding-websites-permissions': { getHoldingWebsitesPermissions: async () => ({ menu: true, view: true, edit: true, manage: true }) },
    '@/lib/holding-customers': { isUuid: () => true },
    '@/lib/supabase-server': { supabaseServer: { from(table) {
      return {
        select() { return this; }, eq() { return this; },
        single() { return Promise.resolve({ data: table === 'holding_website_plans' ? { category: 'creation', project_type: 'catalog' } : { id: 'contract', plan_id: 'plan', project_type: 'institutional' }, error: null }); },
        update(value) { update = value; return this; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
    } } },
  });
  for (const project_type of [undefined, 'store']) {
    const response = await route.PUT(new Request('https://holding.test', { method: 'PUT', body: JSON.stringify({ id: 'contract', designer_email: ' DESIGNER@example.test ', project_type }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(update, { designer_email: 'designer@example.test' });
  }
});
