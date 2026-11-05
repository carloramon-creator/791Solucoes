import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

test('productivity money is exact cents, never rounded from excess decimal precision', () => {
  const { productivityCents } = load('src/lib/website-production.ts');
  for (const [value, expected] of [['123,45', 12345], ['0.01', 1], ['150', 15000], ['9999999.99', 999999999]]) {
    assert.equal(productivityCents(value), expected);
  }
  for (const value of ['0', '-1', '1.999', '1e3', '10000000', 'NaN', '', null, 123]) {
    assert.throws(() => productivityCents(value));
  }
});

test('production stages, approval and designer payable are enforced atomically in PostgreSQL', async (t) => {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite(); t.after(() => db.close());
  const plan = randomUUID(), customer = randomUUID(), managerId = randomUUID();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create table holding_permission_profiles(id uuid primary key default gen_random_uuid(),name text,active boolean,is_system boolean);
    create table holding_permission_resources(code text primary key,label text,category text,parent_code text,sort_order integer,active boolean);
    create table holding_profile_resource_permissions(profile_id uuid,resource_code text,enabled boolean,primary key(profile_id,resource_code));
    create table holding_user_permission_profiles(user_email text,profile_id uuid);
    create table holding_website_plans(id uuid primary key,category text);
    create table holding_website_contracts(id uuid primary key,customer_id uuid,plan_id uuid references holding_website_plans(id),
      project_type text,designer_email text,customer_snapshot jsonb,plan_snapshot jsonb,created_at timestamptz default now());
    create table holding_operations(id uuid primary key default gen_random_uuid(),area text);
    create table holding_website_subscriptions(id uuid primary key,contract_id uuid references holding_website_contracts(id),customer_id uuid,
      approval_status text default 'pending',billing_state text default 'local',lifecycle_status text default 'active',
      approved_at timestamptz,approved_by uuid,created_at timestamptz default now());
    create table system_finance_records(id uuid primary key default gen_random_uuid(),type text not null,value numeric not null,
      description text not null,category text,status text,metadata jsonb);
    insert into holding_permission_profiles(name,active,is_system) values('Administrador',true,true),('Designer',true,false),('Comercial',true,false),('Inativo',false,false);
    insert into holding_user_permission_profiles select 'manager@test',id from holding_permission_profiles where name='Administrador';
    insert into holding_user_permission_profiles select 'designer@test',id from holding_permission_profiles where name='Designer';
    insert into holding_user_permission_profiles select 'commercial@test',id from holding_permission_profiles where name='Comercial';
    insert into holding_user_permission_profiles select 'inactive@test',id from holding_permission_profiles where name='Inativo';
    insert into holding_permission_resources(code,active) values('menu.websites',true),('action.websites.view',true),
      ('action.websites.edit',true),('action.websites.manage',true),('menu.producao',true),('action.producao.manage',true),('menu.gestao',true);
    insert into holding_profile_resource_permissions select p.id,r.code,true from holding_permission_profiles p cross join holding_permission_resources r
      where p.name='Administrador' or (p.name in ('Designer','Inativo') and r.code in ('menu.websites','action.websites.view','action.websites.edit'));
  `);
  await db.query("insert into holding_website_plans values($1,'creation')", [plan]);
  const contract = async (designer = 'designer@test') => {
    const id = randomUUID();
    await db.query(`insert into holding_website_contracts(id,customer_id,plan_id,project_type,designer_email,customer_snapshot,plan_snapshot)
      values($1,$2,$3,'institutional',$4,'{"name":"Cliente teste"}','{"name":"Plano teste"}')`, [id, customer, plan, designer]);
    return id;
  };
  const subscription = async (contractId, approval = 'pending') => {
    const id = randomUUID();
    await db.query("insert into holding_website_subscriptions(id,contract_id,customer_id,approval_status) values($1,$2,$3,$4)", [id, contractId, customer, approval]);
    return id;
  };
  const legacy = await contract(); await subscription(legacy, 'approved');
  await db.exec(readFileSync('supabase/migrations/20261106007000_website_productivity.sql', 'utf8'));
  const approve = (id, actor = 'manager@test') => db.query('select holding_approve_website_delivery($1,$2,$3)', [actor, managerId, id]);
  const rate = (amount, version = 0, actor = 'manager@test') => db.query('select holding_set_website_productivity_rate($1,$2,$3,$4)', [actor, plan, amount, version]);
  const stage = async (id, target, version, actor = 'designer@test') =>
    (await db.query('select holding_advance_website_production($1,$2,$3,$4) as result', [actor, id, target, version])).rows[0].result;
  const read = async (table) => (await db.query(`select * from ${table}`)).rows;
  const ready = async (id) => {
    for (const [index, target] of ['briefing','production','internal_review','customer_review'].entries()) await stage(id, target, index + 1);
  };
  const project = await contract(), first = await subscription(project), second = await subscription(project);
  await t.test('legacy approvals do not create retroactive remuneration', async () => {
    assert.equal((await db.query('select production_stage from holding_website_contracts where id=$1', [legacy])).rows[0].production_stage, 'completed');
    await approve(await subscription(legacy));
    assert.equal((await read('holding_website_productivity')).length, 0);
  });
  await t.test('only authorized own-project staff can advance sequentially; no stage pays money', async () => {
    for (const actor of ['stranger@test', 'commercial@test', 'inactive@test']) {
      await assert.rejects(stage(project, 'briefing', 1, actor), /Sem acesso/);
    }
    await assert.rejects(stage(project, 'production', 1), /uma etapa/);
    await assert.rejects(stage(project, 'completed', 1), /invalida/);
    await assert.rejects(stage(project, 'briefing', 7), /Atualize/);
    await assert.rejects(approve(first), /Conclua configuracao/);
    await ready(project);
    assert.deepEqual(await stage(project, 'customer_review', 4), { stage: 'customer_review', version: 5 });
    assert.equal((await read('system_finance_records')).length, 0);
    assert.equal((await read('holding_website_production_events')).length, 4);
  });
  await t.test('missing value, missing designer and unauthorized approval cannot activate or generate a payable', async () => {
    await assert.rejects(approve(first, 'designer@test'), /autorizado/);
    await assert.rejects(approve(first), /Configure o valor/);
    await assert.rejects(rate(12345, 0, 'designer@test'), /Sem permissao/);
    await assert.rejects(rate(0), /check constraint/);
    await rate(12345);
    await db.query('update holding_website_contracts set designer_email=null where id=$1', [project]);
    await assert.rejects(approve(first), /Atribua um webdesigner/);
    await db.query("update holding_website_contracts set designer_email='designer@test' where id=$1", [project]);
    assert.equal((await db.query('select approval_status from holding_website_subscriptions where id=$1', [first])).rows[0].approval_status, 'pending');
    assert.equal((await read('system_finance_records')).length, 0);
  });
  await t.test('finance failure rolls back approval, stage, earning and event together', async () => {
    await db.exec(`create function fail_payable() returns trigger language plpgsql as $$begin raise exception 'finance unavailable';end$$;
      create trigger fail_payable before insert on system_finance_records for each row execute function fail_payable()`);
    await assert.rejects(approve(first), /finance unavailable/);
    assert.equal((await db.query('select production_stage from holding_website_contracts where id=$1', [project])).rows[0].production_stage, 'customer_review');
    assert.equal((await db.query('select approval_status from holding_website_subscriptions where id=$1', [first])).rows[0].approval_status, 'pending');
    assert.equal((await read('holding_website_productivity')).length, 0);
    await db.exec('drop trigger fail_payable on system_finance_records');
  });
  await t.test('multiple subscriptions, retries and later renewals create exactly one payable per contract', async () => {
    await Promise.all([approve(first), approve(second)]);
    await approve(first); await approve(second);
    const earning = (await read('holding_website_productivity'))[0];
    const finance = (await read('system_finance_records'))[0];
    assert.equal(earning.amount_cents, 12345); assert.equal(earning.designer_email, 'designer@test');
    assert.equal((await db.query('select value=123.45 as exact from system_finance_records where id=$1', [finance.id])).rows[0].exact, true);
    assert.equal(finance.status, 'pending'); assert.equal(finance.type, 'expense');
    assert.equal(finance.metadata.website_contract_id, project); assert.equal(earning.finance_record_id, finance.id);
    assert.equal((await read('system_finance_records')).length, 1);
    await approve(await subscription(project));
    assert.equal((await read('system_finance_records')).length, 1);
    await assert.rejects(stage(project, 'configuration', 6), /aprovacao na Holding/);
  });
  await t.test('rate changes and reassignment preserve approved snapshots; other contracts earn independently', async () => {
    await assert.rejects(rate(20000, 0), /outra pessoa/);
    await rate(20000, 1);
    await db.query("update holding_website_contracts set designer_email='replacement@test' where id=$1", [project]);
    assert.equal((await read('holding_website_productivity'))[0].designer_email, 'designer@test');
    assert.equal((await read('holding_website_productivity'))[0].amount_cents, 12345);
    const another = await contract(); const anotherSub = await subscription(another); await ready(another);
    await db.exec("insert into holding_profile_resource_permissions select id,'action.websites.approve',true from holding_permission_profiles where name='Comercial'");
    await approve(anotherSub, 'commercial@test');
    const entries = await read('holding_website_productivity');
    assert.equal(entries.length, 2); assert.equal(entries.find((row) => row.contract_id === another).amount_cents, 20000);
    assert.equal(entries.find((row) => row.contract_id === another).approved_by, 'commercial@test');
  });
  await t.test('paused, cancelled or uncertain subscriptions are rejected and standalone approvals do not pay production', async () => {
    for (const [field, value] of [['billing_state','processing'], ['billing_state','review'], ['lifecycle_status','paused'], ['lifecycle_status','cancelled']]) {
      const id = await subscription(project);
      await db.query(`update holding_website_subscriptions set ${field}=$1 where id=$2`, [value, id]);
      await assert.rejects(approve(id), /disponivel/);
    }
    await approve(await subscription(null));
    assert.equal((await read('holding_website_productivity')).length, 2);
  });
  await t.test('financial deletion never recreates an entitlement and untrusted roles cannot call privileged functions', async () => {
    const earning = (await read('holding_website_productivity'))[0];
    await db.query('delete from system_finance_records where id=$1', [earning.finance_record_id]);
    await approve(first);
    assert.equal((await read('system_finance_records')).length, 1);
    assert.equal((await db.query('select finance_record_id from holding_website_productivity where contract_id=$1', [project])).rows[0].finance_record_id, null);
    for (const role of ['anon','authenticated']) {
      for (const fn of ['holding_approve_website_delivery(text,uuid,uuid)','holding_advance_website_production(text,uuid,text,integer)','holding_set_website_productivity_rate(text,uuid,integer,integer)']) {
        assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, fn])).rows[0].allowed, false);
      }
    }
  });
  await t.test('management counts approved deliveries using the original beneficiary and old production writes are blocked', async () => {
    const metrics = (await db.query("select * from holding_website_production_metrics('manager@test',current_date-1,current_date+1)")).rows;
    const designer = metrics.find((row) => row.owner_email === 'designer@test');
    assert.equal(Number(designer.deliveries), 3);
    assert.equal(metrics.some((row) => row.owner_email === 'replacement@test'), false);
    assert.equal(Number(designer.on_time_deliveries), 0);
    await assert.rejects(db.query("select * from holding_website_production_metrics('designer@test',current_date,current_date)"), /Sem acesso/);
    await assert.rejects(db.query("insert into holding_operations(area) values('producao')"), /avancadas no Websites/);
    await db.query("insert into holding_operations(area) values('comercial')");
  });
  await t.test('an already-active subscription linked to a new project still requires a distinct delivery approval', async () => {
    const another = await contract(), id = await subscription(another, 'approved');
    await db.query("update holding_website_subscriptions set billing_state='issued',approved_at='2025-01-01' where id=$1", [id]);
    await assert.rejects(approve(id), /Conclua configuracao/);
    await ready(another); await approve(id); await approve(id);
    const entries = (await read('holding_website_productivity')).filter((row) => row.contract_id === another);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount_cents, 20000);
    assert.equal((await db.query("select approved_at<'2026-01-01'::timestamptz preserved from holding_website_subscriptions where id=$1", [id])).rows[0].preserved, true);
    const earning = (await db.query('select * from holding_website_productivity where contract_id=$1', [another])).rows[0];
    const root = (await db.query('select * from system_finance_records where id=$1', [earning.finance_record_id])).rows[0];
    await assert.rejects(db.query("insert into system_finance_records(type,value,description,status,metadata) values('expense',200,'Duplicate','pending',$1)", [JSON.stringify(root.metadata)]), /unique constraint/);
    await db.query("update system_finance_records set value=50,status='paid' where id=$1", [root.id]);
    const remaining = randomUUID();
    await db.query("insert into system_finance_records(id,type,value,description,status,metadata) values($1,'expense',150,'Saldo','pending',$2)",
      [remaining, JSON.stringify({ ...root.metadata, settlement_parent_id: root.id })]);
    let summary = (await db.query('select * from holding_website_productivity_summary where contract_id=$1', [another])).rows[0];
    assert.equal(Number(summary.pending_cents), 15000); assert.equal(Number(summary.paid_cents), 5000);
    await db.query("update system_finance_records set value=70,status='paid' where id=$1", [remaining]);
    await db.query("insert into system_finance_records(type,value,description,status,metadata) values('expense',80,'Saldo restante','pending',$1)",
      [JSON.stringify({ ...root.metadata, settlement_parent_id: remaining })]);
    await approve(id);
    summary = (await db.query('select * from holding_website_productivity_summary where contract_id=$1', [another])).rows[0];
    assert.equal(Number(summary.pending_cents), 8000); assert.equal(Number(summary.paid_cents), 12000);
    assert.equal(summary.amount_cents, 20000); assert.equal(Number(summary.finance_record_count), 3);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_table_privilege($1,'holding_website_productivity_summary','SELECT') allowed", [role])).rows[0].allowed, false);
    }
  });
});

test('productivity API protects portfolio, configuration, page bounds and actor identity', async () => {
  let auth = { ok: false, error: 'Sessão inválida', status: 401 }, filters = [], saved;
  const stages = load('src/lib/website-production.ts');
  const { GET, PUT } = load('src/app/api/admin/website-production/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-operations-access': { operationsAccess: async () => auth },
    '@/lib/holding-customers': { isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) },
    '@/lib/website-production': stages,
    '@/lib/supabase-server': { supabaseServer: {
      from(table) {
        filters.push(['table', table]);
        return { select() { return this; }, not() { return this; }, eq(...args) { filters.push(args); return this; },
          order() { return this; }, range(...args) { filters.push(['range', ...args]); return this; },
          then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); } };
      },
      async rpc(name, args) { saved = { name, args }; return { error: null }; },
    } },
  });
  const get = (params = '') => GET(new Request(`https://holding.test?${params}`));
  assert.equal((await get()).status, 401);
  auth = { ok: true, email: 'designer@test', codes: ['menu.producao'] };
  assert.equal((await get('mode=rates')).status, 403);
  assert.equal((await get('mode=projects')).status, 200);
  assert.ok(filters.some(([key, value]) => key === 'designer_email' && value === 'designer@test'));
  filters = [];
  assert.equal((await get('mode=earnings&page=2')).status, 200);
  assert.ok(filters.some(([key, value]) => key === 'designer_email' && value === 'designer@test'));
  assert.ok(filters.some(([key, start, end]) => key === 'range' && start === 50 && end === 74));
  assert.equal((await get('page=-1')).status, 400);
  assert.equal((await get('stage=invalid')).status, 400);
  const put = (body) => PUT(new Request('https://holding.test', { method: 'PUT', body: JSON.stringify(body) }));
  const data = { plan_id: randomUUID(), amount_cents: 12345, version: 0, p_actor: 'untrusted@test' };
  assert.equal((await put(data)).status, 403); assert.equal(saved, undefined);
  auth = { ...auth, email: 'manager@test', codes: ['menu.producao','action.producao.manage'] };
  assert.equal((await put({ ...data, amount_cents: 1.1 })).status, 400);
  assert.equal((await put(data)).status, 200);
  assert.equal(saved.args.p_actor, 'manager@test');
  assert.equal(saved.args.p_amount_cents, 12345);
});

test('Websites production endpoint uses verified SSO identity, validates scope and never accepts final approval', async () => {
  const id = randomUUID();
  let session = null, calls = [], scoped = true;
  const { GET, POST } = load('src/app/api/websites/production/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-websites-sso': { isSsoValue: () => true, inspectWebsitesSession: async () => session, ssoHeaders: {} },
    '@/lib/website-projects': { websiteProjects: async () => scoped ? [{ contractId: id }] : [] },
    '@/lib/holding-customers': { isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) },
    '@/lib/website-production': load('src/lib/website-production.ts'),
    '@/lib/supabase-server': { supabaseServer: {
      from() { return { select() { return this; }, eq() { return this; }, async single() { return { data: { production_stage: 'briefing', production_version: 2 }, error: null }; } }; },
      async rpc(name, args) { calls.push({ name, args }); return { data: { stage: args.p_stage, version: 2 }, error: null }; },
    } },
  });

  test('delivery-only approval never calls Asaas; activation failures report the preserved local approval', async () => {
    const id = randomUUID(); let approvals = 0, billing = 0;
    const { POST } = load('src/app/api/admin/website-subscriptions/billing/route.ts', {
      'next/server': { NextResponse: Response },
      '@/lib/holding-commercial-auth': { authorizeHoldingCommercial: async () => null },
      '@/lib/holding-customers': { isUuid: (value) => value === id },
      '@/lib/website-subscription-approval': { approveWebsiteSubscription: async () => { approvals++; } },
      '@/lib/website-subscriptions': {
        billWebsiteSubscription: async () => { billing++; throw new Error('Asaas indisponível'); },
        changeWebsiteSubscription: async () => { throw new Error('Unexpected lifecycle change'); },
      },
    });
    const post = (body) => POST(new Request('https://holding.test', { method: 'POST', body: JSON.stringify({ id, ...body }) }));
    assert.equal((await post({ action: 'approve_delivery' })).status, 400);
    assert.equal(approvals, 0);
    assert.equal((await post({ action: 'approve_delivery', confirmed: true })).status, 200);
    assert.equal(approvals, 1); assert.equal(billing, 0);
    const result = await post({ action: 'generate', confirmed: true });
    const body = await result.json();
    assert.equal(result.status, 409); assert.equal(body.approvalRecorded, true);
    assert.match(body.error, /registrada e preservada/); assert.equal(billing, 1);
  });
  const get = () => GET(new Request(`https://holding.test?contractId=${id}`));
  const post = (body) => POST(new Request('https://holding.test', { method: 'POST', body: JSON.stringify(body) }));
  const body = { contractId: id, stage: 'briefing', version: 1, p_actor: 'stranger@test' };
  assert.equal((await get()).status, 401); assert.equal((await post(body)).status, 401);
  session = { user: { email: 'designer@test' }, permissions: { edit: false, manage: false } };
  assert.equal((await post(body)).status, 403);
  session.permissions.edit = true;
  assert.equal((await post({ ...body, stage: 'completed' })).status, 400);
  scoped = false; assert.equal((await get()).status, 403);
  scoped = true;
  assert.deepEqual(await (await get()).json(), { stage: 'briefing', version: 2 });
  assert.equal((await post(body)).status, 200);
  assert.deepEqual(calls, [{ name: 'holding_advance_website_production', args: {
    p_actor: 'designer@test', p_contract_id: id, p_stage: 'briefing', p_version: 1,
  } }]);
});
