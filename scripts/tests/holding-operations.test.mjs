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
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

test('operations deny missing, inactive and cross-portfolio access; audit and commissions are atomic', async (t) => {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table holding_permission_resources(code text primary key,label text,category text,parent_code text,sort_order integer,active boolean);
    create table holding_permission_profiles(id uuid primary key default gen_random_uuid(),name text,active boolean,is_system boolean);
    create table holding_profile_resource_permissions(profile_id uuid,resource_code text,enabled boolean,primary key(profile_id,resource_code));
    create table holding_user_permission_profiles(user_email text,profile_id uuid);
    insert into holding_permission_profiles(name,active,is_system) values('Administrador',true,true),('Vendas',true,false),('Produção',true,false),('Inativo',false,false);
    insert into holding_user_permission_profiles select 'manager@example.test',id from holding_permission_profiles where name='Administrador';
    insert into holding_user_permission_profiles select 'seller@example.test',id from holding_permission_profiles where name='Vendas';
    insert into holding_user_permission_profiles select 'other@example.test',id from holding_permission_profiles where name='Vendas';
    insert into holding_user_permission_profiles select 'designer@example.test',id from holding_permission_profiles where name='Produção';
    insert into holding_user_permission_profiles select 'inactive@example.test',id from holding_permission_profiles where name='Inativo';
  `);
  await db.exec(readFileSync('supabase/migrations/20261106000000_holding_operations.sql', 'utf8'));
  await db.exec(`
    insert into holding_profile_resource_permissions select id,'menu.comercial',true from holding_permission_profiles where name in ('Vendas','Inativo');
    insert into holding_profile_resource_permissions select id,'menu.producao',true from holding_permission_profiles where name='Produção';
  `);
  const save = async (actor, data) => (await db.query('select holding_save_operation($1,$2) as id', [actor, JSON.stringify(data)])).rows[0].id;
  const create = (overrides = {}) => ({ request_id: randomUUID(), area: 'comercial', product: 'glass', customer_name: 'Cliente fictício', title: 'Conversão de trial', owner_email: 'seller@example.test', ...overrides });
  const record = async (id) => (await db.query('select * from holding_operations where id=$1', [id])).rows[0];
  const change = async (actor, id, fields) => save(actor, { id, version: (await record(id)).version, ...fields });
  await t.test('permissions are explicit, active and validated inside the transaction', async () => {
    for (const actor of ['unknown@example.test', 'inactive@example.test', 'seller@example.test']) {
      await assert.rejects(save(actor, create()), /Sem acesso|Somente gestores/);
    }
    await assert.rejects(save('manager@example.test', create({ owner_email: 'inactive@example.test' })), /Responsável sem permissão/);
    await assert.rejects(save('manager@example.test', create({ owner_email: 'designer@example.test' })), /Responsável sem permissão/);
    assert.deepEqual((await db.query("select holding_operations_permissions('unknown@example.test') as codes")).rows[0].codes, []);
  });
  const id = await save('manager@example.test', create({ due_date: '2026-11-30' }));
  await t.test('staff cannot change someone else, reassign, alter deadlines or overwrite stale versions', async () => {
    await assert.rejects(change('other@example.test', id, { stage: 'contacted' }), /fora da sua carteira/);
    await assert.rejects(change('seller@example.test', id, { owner_email: 'other@example.test' }), /Somente gestores/);
    await assert.rejects(change('seller@example.test', id, { due_date: '2027-01-01' }), /Somente gestores/);
    await assert.rejects(save('seller@example.test', { id, version: 99, stage: 'contacted' }), /outra pessoa/);
    await change('seller@example.test', id, { stage: 'contacted', note: 'Cliente pediu demonstração', next_action: 'Retornar amanhã' });
    const row = await record(id);
    assert.equal(row.stage, 'contacted'); assert.equal(row.version, 2);
    assert.equal((await db.query('select note from holding_operation_events where record_id=$1 order by created_at desc limit 1', [id])).rows[0].note, 'Cliente pediu demonstração');
    await assert.rejects(change('seller@example.test', id, { stage: 'lost' }), /motivo da perda/);
  });
  await t.test('conversion freezes the seller, never computes money and reopens only with manager approval', async () => {
    await change('seller@example.test', id, { stage: 'won' });
    await change('manager@example.test', id, { owner_email: 'other@example.test' });
    let commission = (await db.query('select * from holding_operation_commissions where record_id=$1', [id])).rows[0];
    assert.equal(commission.seller_email, 'seller@example.test');
    assert.equal(commission.amount_cents, null); assert.equal(commission.rule_snapshot, null);
    assert.equal(commission.state, 'awaiting_rule');
    await assert.rejects(change('other@example.test', id, { stage: 'negotiating' }), /Somente gestores reabrem/);
    await change('manager@example.test', id, { stage: 'negotiating' });
    await change('other@example.test', id, { stage: 'won' });
    commission = (await db.query('select * from holding_operation_commissions where record_id=$1', [id])).rows[0];
    assert.equal(commission.state, 'void'); assert.equal(commission.seller_email, 'seller@example.test');
    assert.equal((await db.query('select count(*)::integer as n from holding_operation_commissions where record_id=$1', [id])).rows[0].n, 1);
    await assert.rejects(db.exec('update holding_operation_commissions set amount_cents=100'), /check constraint/);
  });
  await t.test('origin uniqueness and invalid input roll back both records and history', async () => {
    const data = create({ source_type: 'glass_subscriber', source_id: randomUUID(), source_status: 'trial' });
    await save('manager@example.test', data);
    await assert.rejects(save('manager@example.test', { ...data, request_id: randomUUID() }), /unique constraint/);
    await assert.rejects(save('manager@example.test', create({ stage: 'unknown' })), /check constraint/);
    await assert.rejects(save('manager@example.test', create({ title: '' })), /check constraint/);
    await assert.rejects(save('manager@example.test', create({ note: 'a'.repeat(5001) })), /5000/);
    assert.equal((await db.query('select count(*)::integer as n from holding_operations where source_id=$1', [data.source_id])).rows[0].n, 1);
  });
  const project = await save('manager@example.test', create({
    area: 'producao', product: 'websites', title: 'Website institucional',
    owner_email: 'designer@example.test', due_date: '2099-12-01',
  }));
  await t.test('production excludes waiting, accumulates active time and snapshots delivery ownership and deadline', async () => {
    await db.query("update holding_operations set stage_since=now()-interval '10 minutes' where id=$1", [project]);
    await change('designer@example.test', project, { stage: 'production' });
    assert.equal(Number((await record(project)).active_seconds), 0);
    await db.query("update holding_operations set stage_since=now()-interval '10 minutes' where id=$1", [project]);
    await change('designer@example.test', project, { stage: 'customer_review' });
    assert.ok(Number((await record(project)).active_seconds) >= 600);
    await db.query("update holding_operations set stage_since=now()-interval '10 minutes' where id=$1", [project]);
    await change('designer@example.test', project, { stage: 'completed' });
    assert.ok(Number((await record(project)).active_seconds) < 605);
    await change('manager@example.test', project, { owner_email: '', due_date: '2020-01-01' });
    const metrics = (await db.query("select * from holding_operations_metrics('manager@example.test','2020-01-01','2020-12-31',null)")).rows;
    assert.equal(metrics.reduce((sum, row) => sum + Number(row.deliveries), 0), 0);
    const today = (await db.query("select (now() at time zone 'America/Sao_Paulo')::date::text as today")).rows[0].today;
    const current = (await db.query("select * from holding_operations_metrics('manager@example.test',$1,$1,null)", [today])).rows;
    assert.equal(current.reduce((sum, row) => sum + Number(row.conversions), 0), 1);
    assert.equal(current.find((row) => row.product === 'websites' && row.owner_email === 'designer@example.test').on_time_deliveries, 1);
    assert.equal(current.find((row) => row.product === 'websites' && row.owner_email === 'designer@example.test').deliveries, 1);
    await assert.rejects(db.query("select * from holding_operations_metrics('seller@example.test',$1,$1,null)", [today]), /Sem acesso/);
    await assert.rejects(db.exec("select * from holding_operations_metrics('manager@example.test','2020-01-01','2026-01-01',null)"), /366/);
  });
  await t.test('database tables and RPCs are unavailable to local anonymous/authenticated roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_table_privilege($1,'holding_operations','SELECT') as allowed", [role])).rows[0].allowed, false);
      assert.equal((await db.query("select has_function_privilege($1,'holding_save_operation(text,jsonb)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where relname='holding_operations'")).rows[0].relrowsecurity, true);
  });
});

test('operations API rejects anonymous requests, scopes lists and ignores actor claims', async () => {
  const catalog = load('src/lib/holding-operations.ts');
  let actor;
  let calls = [];
  let auth = { ok: false, status: 401, error: 'Sessão inválida.' };
  const route = load('src/app/api/admin/operations/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-operations-access': { operationsAccess: async () => auth },
    '@/lib/glass-client': { getGlassClient: async () => { throw new Error('Remote access not allowed'); } },
    '@/lib/holding-customers': { isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) },
    '@/lib/website-contracts': { validDate: () => true },
    '@/lib/holding-operations': catalog,
    '@/lib/supabase-server': { supabaseServer: {
      rpc: async (_name, args) => { actor = args.p_actor; return { data: 'id', error: null }; },
      from(table) {
        calls.push(['from', table]);
        return {
          select() { return this; }, eq(...args) { calls.push(['eq', ...args]); return this; },
          order() { return this; }, range() { return this; },
          then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
        };
      },
    } },
  });
  assert.equal((await route.GET(new Request('https://holding.test?area=comercial'))).status, 401);
  auth = { ok: true, email: 'seller@example.test', codes: ['menu.comercial'] };
  assert.equal((await route.GET(new Request('https://holding.test?area=producao'))).status, 403);
  assert.equal((await route.GET(new Request('https://holding.test?area=comercial&mode=sources&product=glass'))).status, 403);
  assert.equal((await route.GET(new Request('https://holding.test?mode=metrics'))).status, 403);
  assert.equal((await route.GET(new Request('https://holding.test?area=comercial&owner=other@example.test'))).status, 200);
  assert.ok(calls.some((call) => call[1] === 'owner_email' && call[2] === 'seller@example.test'));
  calls = [];
  assert.equal((await route.GET(new Request('https://holding.test?area=comercial&mode=commissions'))).status, 200);
  assert.ok(calls.some((call) => call[1] === 'seller_email' && call[2] === 'seller@example.test'));
  const response = await route.POST(new Request('https://holding.test', { method: 'POST', body: JSON.stringify({ id: randomUUID(), version: 1, stage: 'contacted', p_actor: 'manager@example.test' }) }));
  assert.equal(response.status, 200); assert.equal(actor, 'seller@example.test');
});
