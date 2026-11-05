import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const external = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText)((id) => {
    if (id in dependencies) return dependencies[id];
    if (id === 'react/jsx-runtime') return external(id);
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports);
  return mod.exports;
}
const dates = load('src/lib/subscription-due-date.ts');
const id = '10000000-0000-4000-8000-000000000001';

test('billing uses Sao Paulo calendar days, including leap dates and exactly ten days overdue', () => {
  assert.equal(dates.subscriptionToday(new Date('2026-11-06T02:59:59Z')), '2026-11-05');
  assert.equal(dates.subscriptionToday(new Date('2026-11-06T03:00:00Z')), '2026-11-06');
  for (const [due, days, label] of [['2026-11-07', 1, 'ATIVA'], ['2026-11-06', 0, 'ATIVA'],
    ['2026-11-05', -1, 'ATRASADA'], ['2026-10-27', -10, 'ATRASADA'], ['2026-10-26', -11, 'BLOQUEADA']]) {
    const now = new Date('2026-11-06T15:00:00Z');
    assert.equal(dates.subscriptionDaysUntilDue(due, now), days);
    assert.equal(dates.glassSubscriptionLabel({ ativa: true, status_assinatura: 'ativa', vencimento_assinatura: due }, now), label);
  }
  assert.equal(dates.subscriptionDaysUntilDue('2028-02-29', new Date('2028-03-01T04:00:00Z')), -1);
  assert.equal(dates.subscriptionBlockDeadline(new Date('2026-11-06T02:00:00Z')), '2026-10-26');
  assert.equal(dates.subscriptionDaysUntilDue(null), null);
  for (const value of ['2026-02-29', '2026-11-31', '2026-1-01', '2026-11-06T00:00:00Z', '', null]) assert.equal(dates.isSubscriptionDueDate(value), false);
  for (const status of ['inativa', 'cancelada']) assert.equal(dates.glassSubscriptionLabel({ ativa: false, status_assinatura: status, vencimento_assinatura: '2020-01-01' }), 'INATIVA');
});

test('new privileged permission requires active explicit action AND subscriptions menu', async (t) => {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create table holding_permission_profiles(id uuid primary key default gen_random_uuid(),name text,active boolean,is_system boolean);
    create table holding_permission_resources(code text primary key,label text,category text,parent_code text,sort_order integer,active boolean);
    create table holding_profile_resource_permissions(profile_id uuid,resource_code text,enabled boolean,primary key(profile_id,resource_code));
    create table holding_user_permission_profiles(user_email text,profile_id uuid);
    insert into holding_permission_profiles(name,active,is_system) values('Administrador',true,true),('Vendedor',true,false),('Inativo',false,false);
    insert into holding_permission_resources(code,active) values('menu.assinaturas',true);
    insert into holding_user_permission_profiles select lower(name)||'@test',id from holding_permission_profiles;
    insert into holding_profile_resource_permissions select id,'menu.assinaturas',true from holding_permission_profiles;
  `);
  await db.exec(readFileSync('supabase/migrations/20261106008000_glass_due_date_permission.sql', 'utf8'));
  const allowed = async email => (await db.query('select holding_can_adjust_glass_due_date($1) as allowed', [email])).rows[0].allowed;
  assert.equal(await allowed(' Administrador@test '), true);
  assert.equal(await allowed('vendedor@test'), false);
  assert.equal(await allowed('unknown@test'), false);
  await db.exec(`insert into holding_profile_resource_permissions select id,'action.assinaturas.adjust_due_date',true from holding_permission_profiles where name='Inativo'`);
  assert.equal(await allowed('inativo@test'), false);
  await db.exec(`update holding_permission_resources set active=false where code='menu.assinaturas'`);
  assert.equal(await allowed('administrador@test'), false);
  await db.exec('set role authenticated');
  await assert.rejects(allowed('administrador@test'), /permission denied/);
});

function api({ auth = { ok: true, user: { email: 'manager@test' } }, allowed = true, failure, result } = {}) {
  const calls = [];
  const routes = load('src/app/api/admin/tenant-due-date/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => auth },
    '@/lib/glass-due-date': { canAdjustGlassDueDate: async () => { if (failure) throw failure; return allowed; } },
    '@/lib/glass-client': { getGlassClient: async () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      return result || { data: { id, ativa: true, status_assinatura: 'ativa', vencimento_assinatura: args.p_due_date, updated_at: '2026-11-06T03:01:00Z' } };
    } }) },
    '@/lib/holding-customers': load('src/lib/holding-customers.ts'),
    '@/lib/subscription-due-date': dates,
  });
  const put = body => routes.PUT(new Request('https://holding.test/api/admin/tenant-due-date', {
    method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }));
  return { ...routes, put, calls };
}
const input = { id, dueDate: '2026-12-01', reason: 'Prorrogacao administrativa de teste', expectedUpdatedAt: null, confirmed: true };

test('due-date API rejects unauthorized, unconfirmed, malformed and stale changes without payments', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [options, expected] of [[{ auth: { ok: false, status: 401, error: 'Sessao invalida' } }, 401],
    [{ allowed: false }, 403], [{ failure: new Error('RPC missing') }, 503]]) {
    const h = api(options);
    assert.equal((await h.put(input)).status, expected);
    assert.equal(h.calls.length, 0);
  }
  for (const body of [null, [], { ...input, confirmed: false }, { ...input, reason: 'curta' },
    { ...input, dueDate: '2026-02-29' }, { ...input, expectedUpdatedAt: undefined }, { ...input, id: 'invalid' }]) {
    const h = api();
    assert.equal((await h.put(body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = api();
  const response = await h.put({ ...input, actor: 'attacker@test' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'holding_adjust_subscription_due_date');
  assert.equal(h.calls[0].args.p_actor, 'manager@test');
  assert.equal((await response.json()).tenant.status_assinatura, 'ativa');
  const stale = api({ result: { error: { code: 'P0001', message: 'O cadastro foi alterado. Atualize' } } });
  assert.equal((await stale.put(input)).status, 409);
  assert.equal((await api({ result: { data: null } }).put(input)).status, 503);
  assert.equal((await api({ allowed: false }).GET(new Request('https://holding.test'))).status, 200);
});

function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(item => nodes(item, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
test('clicking the due date opens a standard form, keeps the original version and refreshes the authoritative status', async () => {
  const values = [], refs = [], calls = [], updates = [];
  let cursor = 0, ref = 0, fail = true;
  const hooks = {
    useId: () => 'due-date-dialog',
    useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    useRef(initial) { return refs[ref++] ||= { current: initial }; },
  };
  const fields = { commercialInputClass: 'standard-field h-11', commercialLabelClass: 'label', commercialButtonClass: 'primary', commercialSecondaryClass: 'secondary' };
  const Component = load('src/components/GlassDueDateButton.tsx', {
    react: hooks, '@/lib/subscription-due-date': dates, './HoldingCommercialFields': fields,
    '@/lib/holding-auth-fetch': { holdingAuthFetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return fail ? Response.json({ error: 'O cadastro foi alterado. Atualize' }, { status: 409 })
        : Response.json({ tenant: { id, ativa: true, status_assinatura: 'ativa', vencimento_assinatura: '2099-01-01', updated_at: '2026-11-06T03:01:00Z' }, message: 'Atualizado sem pagamento.' });
    } },
  }).default;
  let tenant = { id, nome: 'Teste', ativa: false, status_assinatura: 'bloqueada', vencimento_assinatura: null, updated_at: '2026-11-05T00:00:00Z' };
  const render = (canEdit = true) => { cursor = 0; ref = 0; return Component({ tenant, canEdit, onUpdated: (...args) => updates.push(args) }); };
  assert.equal(nodes(render(false), n => n.type === 'button').length, 0);
  nodes(render(), n => n.type === 'button')[0].props.onClick();
  for (const [type, value] of [['date', '2099-01-01'], ['text', 'Justificativa administrativa'], ['checkbox', true]]) {
    const node = nodes(render(), n => n.type === 'input' && (n.props.type || 'text') === type)[0];
    if (type !== 'checkbox') assert.equal(node.props.className, fields.commercialInputClass);
    node.props.onChange({ target: type === 'checkbox' ? { checked: value } : { value } });
  }
  tenant = { ...tenant, updated_at: '2026-11-06T00:00:00Z' };
  await nodes(render(), n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(calls[0].body.expectedUpdatedAt, '2026-11-05T00:00:00Z');
  assert.equal(updates.length, 0);
  assert.match(nodes(render(), n => n.props?.role === 'alert')[0].props.children, /Atualize/);
  fail = false;
  await nodes(render(), n => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(updates[0][0].status_assinatura, 'ativa');
  assert.equal(nodes(render(), n => n.type === 'form').length, 0);
});

test('expiration cron rechecks the latest due date so a concurrent extension is not blocked', async (t) => {
  t.mock.method(console, 'log', () => {});
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousSecret; });
  let clients = 0;
  const deadline = dates.subscriptionBlockDeadline();
  const original = { id, nome: 'Teste', vencimento_assinatura: '2020-01-01', ativa: true };
  let stored = { ...original };
  const makeQuery = isGlass => {
    let update, filters = [];
    const query = {
      select: () => query,
      eq: (field, value) => { filters.push(row => row[field] === value); return query; },
      lt: (field, value) => { filters.push(row => row[field] < value); return query; },
      in: (field, value) => { filters.push(row => value.includes(row[field])); return query; },
      update: value => { update = value; return query; },
      then: (resolve, reject) => Promise.resolve().then(() => {
        if (!isGlass) return { data: [], error: null };
        if (!update) {
          assert.ok(original.vencimento_assinatura < deadline);
          stored.vencimento_assinatura = '2099-01-01';
          return { data: [original], error: null };
        }
        if (filters.every(filter => filter(stored))) {
          stored = { ...stored, ...update };
          return { data: [stored], error: null };
        }
        return { data: [], error: null };
      }).then(resolve, reject),
    };
    return query;
  };
  const route = load('src/app/api/system/cron/block-expired-tenants/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@supabase/supabase-js': { createClient: () => { const glass = clients++ === 0; return { from: () => makeQuery(glass) }; } },
    '@/lib/subscription-due-date': dates,
  });
  const response = await route.GET(new Request('https://holding.test/api/system/cron/block-expired-tenants?secret=test-secret'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).blockedTenantsCount, 0);
  assert.equal(stored.ativa, true);
  assert.equal(stored.vencimento_assinatura, '2099-01-01');
});
