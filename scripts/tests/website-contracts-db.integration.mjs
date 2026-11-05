import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const customer = '10000000-0000-4000-8000-000000000001';
const plan = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const schedule = [
  { number: 1, kind: 'deposit', amount_cents: 10000, due_date: '2027-01-15' },
  { number: 2, kind: 'balance', amount_cents: 10000, due_date: '2027-01-31' },
  { number: 3, kind: 'balance', amount_cents: 10001, due_date: '2027-02-28' },
];

test('isolated PostgreSQL: customer and contract migration, grants, snapshots, atomicity and idempotency', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.system_settings(id text primary key,value jsonb,updated_at timestamptz);
    create table public.holding_permission_profiles(id uuid primary key default gen_random_uuid(), name text);
    create table public.holding_permission_resources(
      code text primary key, label text, category text, parent_code text references public.holding_permission_resources(code),
      sort_order integer, active boolean, updated_at timestamptz default now()
    );
    create table public.holding_profile_resource_permissions(
      profile_id uuid references public.holding_permission_profiles(id),
      resource_code text references public.holding_permission_resources(code), enabled boolean,
      updated_at timestamptz default now(), primary key(profile_id,resource_code)
    );
    create function public.set_holding_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end; $$;
    insert into public.holding_permission_resources(code) values ('menu.planos'),('menu.assinaturas');
    insert into public.holding_permission_profiles(name) values ('Administrador');
  `);
  for (const migration of [
    '20261104180000_holding_website_plans.sql',
    '20261104184500_holding_website_plan_fiscal.sql',
    '20261104190000_holding_website_contracts.sql',
    '20261104193000_holding_website_invoices.sql',
  ]) {
    await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  }
  await db.query(`insert into public.holding_customers(id,name,document,email) values ($1,'Cliente ficticio','00000000001','test@example.test')`, [customer]);
  await db.query(`insert into public.holding_website_plans(id,name,scope,category,billing_cycle,price_cents)
    values ($1,'Site ficticio','Duas revisoes','creation','one_time',30001)`, [plan]);
  const fiscalConfig = {
    national_code: '010101', municipal_code: '', nbs: '123456789',
    service_description: 'Servico ficticio', accountant_confirmed: true,
    simples_percent: 6,
  };
  await db.query('update public.holding_website_plans set fiscal_config=$1::jsonb where id=$2', [JSON.stringify(fiscalConfig), plan]);
  const create = async (rows = schedule, req = requestId, total = 30001, method = 'CREDIT_CARD') => {
    const { rows: result } = await db.query(
      `select public.holding_create_website_contract($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text,$6::jsonb) as id`,
      [req, customer, plan, total, method, JSON.stringify(rows)],
    );
    return result[0].id;
  };
  let contractId;
  await t.test('rejects malformed or prematurely confirmed fiscal configurations at database level', async () => {
    for (const value of [
      [], {}, { ...fiscalConfig, accountant_confirmed: 'true' },
      { ...fiscalConfig, national_code: '1' }, { ...fiscalConfig, nbs: '' },
      { ...fiscalConfig, service_description: ' ' },
    ]) {
      await assert.rejects(db.query('update public.holding_website_plans set fiscal_config=$1::jsonb where id=$2',
        [JSON.stringify(value), plan]), /check constraint/);
    }
  });
  await t.test('creates complete project with exact total and entry plus balance', async () => {
    contractId = await create();
    const { rows } = await db.query('select * from public.holding_website_contracts where id=$1', [contractId]);
    assert.equal(rows[0].billing_state, 'local');
    assert.equal(rows[0].total_cents, 30001);
    assert.equal(rows[0].customer_snapshot.name, 'Cliente ficticio');
    assert.equal(rows[0].plan_snapshot.scope, 'Duas revisoes');
    assert.deepEqual(rows[0].plan_snapshot.fiscal_config, fiscalConfig);
    assert.equal(rows[0].plan_snapshot.invoice_policy, 'manual_project_total');
    const parcels = await db.query('select sum(amount_cents)::integer as total,count(*)::integer as count from public.holding_website_installments where contract_id=$1', [contractId]);
    assert.deepEqual(parcels.rows, [{ total: 30001, count: 3 }]);
  });
  await t.test('replays the same request without creating duplicates', async () => {
    assert.equal(await create(), contractId);
    await assert.rejects(create(schedule, requestId, 30002), /dados diferentes/);
    const { rows } = await db.query('select count(*)::integer as count from public.holding_website_contracts');
    assert.equal(rows[0].count, 1);
  });
  await t.test('preserves historical terms after catalog and customer edits', async () => {
    await db.query("update public.holding_customers set name='Nome editado' where id=$1", [customer]);
    await db.query("update public.holding_website_plans set scope='Escopo novo',price_cents=50000 where id=$1", [plan]);
    await db.query("update public.holding_website_plans set fiscal_config=null where id=$1", [plan]);
    const { rows } = await db.query('select customer_snapshot,plan_snapshot,total_cents from public.holding_website_contracts where id=$1', [contractId]);
    assert.equal(rows[0].customer_snapshot.name, 'Cliente ficticio');
    assert.equal(rows[0].plan_snapshot.scope, 'Duas revisoes');
    assert.equal(rows[0].total_cents, 30001);
    assert.deepEqual(rows[0].plan_snapshot.fiscal_config, fiscalConfig);
  });
  await t.test('rolls back partial contracts on invalid installments and wrong totals', async () => {
    const req = '30000000-0000-4000-8000-000000000002';
    await assert.rejects(create([{ ...schedule[0], amount_cents: 30001, due_date: '2027-99-99' }], req));
    await assert.rejects(create([{ ...schedule[0], amount_cents: 100 }], req), /total/);
    await assert.rejects(create([{ ...schedule[0], number: 2, amount_cents: 30001 }], req), /Ordem/);
    const { rows } = await db.query('select count(*)::integer as count from public.holding_website_contracts');
    assert.equal(rows[0].count, 1);
  });
  await t.test('rejects inactive customers and recurring products, without provisioning SaaS tenants', async () => {
    const req = '30000000-0000-4000-8000-000000000003';
    await db.query('update public.holding_customers set active=false where id=$1', [customer]);
    await assert.rejects(create(schedule, req), /no rows/);
    await db.query('update public.holding_customers set active=true where id=$1', [customer]);
    await db.query("update public.holding_website_plans set category='hosting',billing_cycle='monthly' where id=$1", [plan]);
    await assert.rejects(create(schedule, req), /no rows/);
    await db.query("update public.holding_website_plans set category='creation',billing_cycle='one_time' where id=$1", [plan]);
  });
  await t.test('claims billing with compare-and-set, preventing two issuers', async () => {
    const first = await db.query("update public.holding_website_contracts set billing_state='processing' where id=$1 and billing_state='local' returning id", [contractId]);
    const second = await db.query("update public.holding_website_contracts set billing_state='processing' where id=$1 and billing_state='local' returning id", [contractId]);
    assert.equal(first.rows.length, 1); assert.equal(second.rows.length, 0);
  });
  await t.test('blocks direct anonymous/authenticated table access and RPC execution', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of ['holding_customers', 'holding_website_contracts', 'holding_website_installments']) {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
      }
      await assert.rejects(create(), /permission denied/);
      await db.exec('reset role');
    }
    const { rows } = await db.query(`select relname,relrowsecurity from pg_class where relname in ('holding_customers','holding_website_contracts','holding_website_installments')`);
    assert.equal(rows.length, 3); assert.ok(rows.every((row) => row.relrowsecurity));
    const grants = await db.query("select count(*)::integer as count from public.holding_profile_resource_permissions where resource_code in ('menu.clientes','submenu.assinaturas.websites') and enabled");
    assert.equal(grants.rows[0].count, 2);
  });
  await t.test('never needs Glass/Barber schemas or finance/fiscal tables to operate', async () => {
    const { rows } = await db.query("select tablename from pg_tables where schemaname='public' order by tablename");
    assert.ok(rows.every((row) => row.tablename.startsWith('holding_') || row.tablename === 'system_settings'));
    const { rows: defs } = await db.query("select pg_get_functiondef(oid) as sql from pg_proc where proname='holding_create_website_contract'");
    assert.doesNotMatch(defs[0].sql, /vidracarias|barbearias|system_finance_records|nfse|dblink/i);
  });
  await t.test('reserves one manual total invoice regardless of payment, with a shared unique DPS sequence', async () => {
    const reserve = () => db.query(
      "select * from public.holding_reserve_website_invoice($1::uuid,'2026-11-04','1','11222333000181')", [contractId],
    );
    const result = await reserve();
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].dps_number, '1');
    assert.equal(result.rows[0].status, 'preparing');
    await assert.rejects(reserve(), /ja reservada/);
    const { rows } = await db.query("select value from public.system_settings where id=$1", [`nfse_producao_website_${contractId}`]);
    assert.equal(rows[0].value.valor, 300.01);
    const { rows: sequence } = await db.query("select value from public.system_settings where id='nfse_sequencia_producao_1'");
    assert.equal(sequence[0].value.numero, 1);
    const { rows: defs } = await db.query("select pg_get_functiondef(oid) as sql from pg_proc where proname='holding_reserve_website_invoice'");
    assert.doesNotMatch(defs[0].sql, /vidracarias|barbearias|nfse_config|system_plans|dblink/i);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(reserve(), /permission denied/);
      await assert.rejects(db.query('select * from public.holding_website_invoices'), /permission denied/);
      await db.exec('reset role');
    }
  });
  await t.test('continues the existing issuer sequence, rolls back failures, and refuses non-project policies', async () => {
    const other = await create(schedule, '30000000-0000-4000-8000-000000000004');
    await db.query("update public.system_settings set value='{\"numero\":50}'::jsonb where id='nfse_sequencia_producao_1'");
    const reserve = () => db.query(
      "select * from public.holding_reserve_website_invoice($1::uuid,'2026-11-04','1','11222333000181')", [other],
    );
    await db.query("update public.holding_website_contracts set plan_snapshot=jsonb_set(plan_snapshot,'{invoice_policy}','\"automatic_after_payment\"') where id=$1", [other]);
    await assert.rejects(reserve(), /Politica fiscal/);
    await db.query("update public.holding_website_contracts set plan_snapshot=jsonb_set(plan_snapshot,'{invoice_policy}','\"manual_project_total\"') where id=$1", [other]);
    const outcomes = await Promise.allSettled([reserve(), reserve()]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(outcomes.find((result) => result.status === 'fulfilled').value.rows[0].dps_number, '51');
    const { rows } = await db.query("select value from public.system_settings where id='nfse_sequencia_producao_1'");
    assert.equal(rows[0].value.numero, 51);
  });
  await t.test('recurring migration preserves projects and enables independent cycle prices and client-specific amounts', async () => {
    await db.exec(await readFile('supabase/migrations/20261104220000_holding_website_subscriptions.sql', 'utf8'));
    await db.query(`update public.holding_website_plans set category='hosting',billing_cycle='monthly',price_cents=10000,
      recurring_prices='{"monthly":10000,"quarterly":28000,"semiannual":53000,"annual":99000}',fiscal_config=$1 where id=$2`,
    [JSON.stringify(fiscalConfig), plan]);
    for (const prices of ['[]', '{"monthly":10000,"quarterly":0}', '{"monthly":9999}', '{"monthly":10000,"bad":10}']) {
      await assert.rejects(db.query('update public.holding_website_plans set recurring_prices=$1 where id=$2', [prices, plan]), /check constraint/);
    }
    const request = '30000000-0000-4000-8000-000000000005';
    const createSub = (amount = 25000, cycle = 'quarterly') => db.query(
      "select public.holding_create_website_subscription($1,$2,$3,$4,'PIX','2026-11-10',$5) as id",
      [request, customer, plan, amount, cycle],
    );
    const subId = (await createSub()).rows[0].id;
    assert.equal((await createSub()).rows[0].id, subId);
    await assert.rejects(createSub(26000), /dados diferentes/);
    await assert.rejects(createSub(25000, 'annual'), /dados diferentes/);
    const { rows } = await db.query('select * from public.holding_website_subscriptions where id=$1', [subId]);
    assert.equal(rows[0].amount_cents, 25000);
    assert.equal(rows[0].plan_snapshot.catalog_price_cents, 28000);
    assert.equal(rows[0].plan_snapshot.billing_cycle, 'quarterly');
    assert.equal(rows[0].plan_snapshot.competence_policy, 'payment_confirmation');
    await db.query("update public.holding_website_plans set recurring_prices='{\"monthly\":10000}',fiscal_config=null where id=$1", [plan]);
    assert.deepEqual((await db.query('select plan_snapshot from public.holding_website_subscriptions where id=$1', [subId])).rows[0].plan_snapshot.fiscal_config, fiscalConfig);
    await db.query("update public.holding_website_subscriptions set asaas_subscription_id='sub_test',asaas_customer_id='cus_test',asaas_environment='production',billing_state='issued' where id=$1", [subId]);
    const record = (status = 'PENDING', paidOn = null, payment = 'pay_test', due = '2026-11-10') => db.query(
      'select public.holding_record_website_subscription_payment($1,$2,25000,$3,$4,$5,$6) as id',
      [subId, payment, due, paidOn, status, 'https://asaas.com/i/test'],
    );
    const paymentId = (await record()).rows[0].id;
    const reserve = () => db.query("select * from public.holding_reserve_website_subscription_invoice($1,'1','11222333000181')", [paymentId]);
    await assert.rejects(reserve(), /Somente pagamento confirmado/);
    assert.equal((await record('CONFIRMED', '2026-11-04')).rows[0].id, paymentId);
    const results = await Promise.allSettled([reserve(), reserve()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const invoice = results.find((result) => result.status === 'fulfilled').value.rows[0];
    assert.equal(invoice.contract_id, null);
    assert.equal(invoice.subscription_payment_id, paymentId);
    assert.equal(invoice.competence.toISOString().slice(0, 10), '2026-11-04');
    assert.equal(invoice.dps_number, '52');
    await record('RECEIVED', '2026-11-07');
    const date = (await db.query('select paid_on from public.holding_website_subscription_payments where id=$1', [paymentId])).rows[0].paid_on;
    assert.equal(date.toISOString().slice(0, 10), '2026-11-04');
    await assert.rejects(record('CONFIRMED', '2026-11-04', 'pay_duplicate'), /unique constraint/);
    await db.query("update public.holding_website_subscriptions set asaas_environment='sandbox' where id=$1", [subId]);
    const sandboxId = (await record('CONFIRMED', '2026-11-04', 'pay_sandbox', '2027-02-10')).rows[0].id;
    await assert.rejects(db.query("select * from public.holding_reserve_website_subscription_invoice($1,'1','11222333000181')", [sandboxId]), /Somente pagamento confirmado/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of ['holding_website_subscriptions', 'holding_website_subscription_payments']) {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
      }
      await assert.rejects(createSub(), /permission denied/);
      await assert.rejects(record(), /permission denied/);
      await assert.rejects(reserve(), /permission denied/);
      await db.exec('reset role');
    }
    assert.equal((await db.query('select count(*)::integer as count from public.holding_website_invoices where contract_id is not null')).rows[0].count, 2);
  });
  await t.test('customer deletion is service-only and FKs prevent removing customers with projects or subscriptions even before billing', async () => {
    await db.exec(await readFile('supabase/migrations/20261104230000_holding_customer_delete.sql', 'utf8'));
    const free = '10000000-0000-4000-8000-000000000002';
    const subscriber = '10000000-0000-4000-8000-000000000003';
    await db.query(`insert into public.holding_customers(id,name,document,email) values
      ($1,'Livre','00000000002','free@example.test'),($2,'Assinante','00000000003','sub@example.test')`, [free, subscriber]);
    await db.query(`insert into public.holding_website_subscriptions(request_id,customer_id,plan_id,customer_snapshot,plan_snapshot,
      amount_cents,payment_method,first_due_date,fiscal_confirmed)
      select gen_random_uuid(),$1,plan_id,customer_snapshot,plan_snapshot,amount_cents,payment_method,first_due_date,true
      from public.holding_website_subscriptions limit 1`, [subscriber]);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('delete from public.holding_customers where id=$1', [free]), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    for (const contracted of [customer, subscriber]) {
      await assert.rejects(db.query('delete from public.holding_customers where id=$1', [contracted]), /foreign key constraint/);
    }
    assert.equal((await db.query('delete from public.holding_customers where id=$1 returning id', [free])).rows.length, 1);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::integer as count from public.holding_customers where id in ($1,$2)', [customer, subscriber])).rows[0].count, 2);
  });
  await t.test('combined project/subscription migration is atomic, idempotent and preserves separate fiscal snapshots and permissions', async () => {
    await db.exec(await readFile('supabase/migrations/20261105000000_holding_website_bundle_lifecycle.sql', 'utf8'));
    const creation = '20000000-0000-4000-8000-000000000010';
    await db.query(`insert into public.holding_website_plans(id,name,scope,category,billing_cycle,price_cents)
      values ($1,'Criacao','Site','creation','one_time',30001)`, [creation]);
    await db.query('update public.holding_website_plans set fiscal_config=$1 where id=$2', [JSON.stringify(fiscalConfig), plan]);
    const terms = { plan_id: plan, amount_cents: 9000, payment_method: 'BOLETO', first_due_date: '2026-12-10', billing_cycle: 'monthly', fiscal_confirmed: true };
    const request = '30000000-0000-4000-8000-000000000010';
    const bundle = (subscription = terms, req = request) => db.query(
      'select public.holding_create_website_bundle($1,$2,$3,30001,\'PIX\',$4,$5) as bundle',
      [req, customer, creation, JSON.stringify(schedule), subscription === null ? null : JSON.stringify(subscription)]);
    await db.exec('set role service_role');
    const result = (await bundle()).rows[0].bundle;
    assert.ok(result.id); assert.ok(result.subscription_id);
    assert.deepEqual((await bundle()).rows[0].bundle, result);
    await assert.rejects(bundle(null), /dados diferentes/);
    await assert.rejects(bundle({ ...terms, amount_cents: 9001 }), /dados diferentes/);
    const project = (await db.query('select * from public.holding_website_contracts where id=$1', [result.id])).rows[0];
    const sub = (await db.query('select * from public.holding_website_subscriptions where id=$1', [result.subscription_id])).rows[0];
    assert.equal(project.bundled_subscription, true); assert.equal(sub.contract_id, project.id);
    assert.equal(sub.customer_id, project.customer_id); assert.equal(sub.amount_cents, 9000);
    assert.equal(sub.lifecycle_status, 'active'); assert.equal(sub.pending_action, null);
    assert.equal(project.plan_snapshot.invoice_policy, 'manual_project_total');
    assert.equal(sub.plan_snapshot.invoice_policy, 'automatic_after_payment');
    assert.equal(project.billing_state, 'local'); assert.equal(sub.billing_state, 'local');
    const failRequest = '30000000-0000-4000-8000-000000000011';
    for (const patch of [{ fiscal_confirmed: false }, { billing_cycle: 'annual' }, { amount_cents: 0 }, { plan_id: creation }]) {
      await assert.rejects(bundle({ ...terms, ...patch }, failRequest));
      assert.equal((await db.query('select count(*)::integer as count from public.holding_website_contracts where request_id=$1', [failRequest])).rows[0].count, 0);
      assert.equal((await db.query('select count(*)::integer as count from public.holding_website_subscriptions where request_id=$1', [failRequest])).rows[0].count, 0);
    }
    const onlyProject = '30000000-0000-4000-8000-000000000012';
    assert.equal((await bundle(null, onlyProject)).rows[0].bundle.subscription_id, null);
    await assert.rejects(bundle(terms, onlyProject), /dados diferentes/);
    await assert.rejects(db.query("update public.holding_website_subscriptions set pending_action='resume' where id=$1", [sub.id]), /check constraint/);
    const claim = () => db.query(`update public.holding_website_subscriptions
      set billing_state='processing',pending_action='pause'
      where id=$1 and billing_state='local' and lifecycle_status='active' and pending_action is null returning id`, [sub.id]);
    const claims = await Promise.all([claim(), claim()]);
    assert.equal(claims.reduce((sum, result) => sum + result.rows.length, 0), 1);
    await db.query(`update public.holding_website_subscriptions set billing_state='local',pending_action=null,lifecycle_status='cancelled' where id=$1`, [sub.id]);
    assert.equal((await claim()).rows.length, 0);
    await db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`); await assert.rejects(bundle(), /permission denied/); await db.exec('reset role');
    }
  });
  await t.test('edits atomically with audit, revision, fiscal exclusion, stale-write protection and restricted execution', async () => {
    await db.exec(await readFile('supabase/migrations/20261105020000_holding_website_contract_edit.sql', 'utf8'));
    await db.query("update public.holding_website_plans set category='creation',billing_cycle='one_time',recurring_prices='{}' where id=$1", [plan]);
    const editable = await create(schedule, '30000000-0000-4000-8000-000000000099');
    const lock = async () => (await db.query("update public.holding_website_contracts set billing_state='processing' where id=$1 returning updated_at::text as locked_at", [editable])).rows[0].locked_at;
    const edit = async (stamp, revision = 0, rows = schedule) => db.query(
      'select public.holding_edit_website_contract($1,$2,$3,$4,$5,$6,$7,$8) as id',
      [editable, revision, stamp, 'local', plan, 30001, 'PIX', JSON.stringify(rows)],
    );
    const stamp = await lock();
    await assert.rejects(db.query(
      "select * from public.holding_reserve_website_invoice($1::uuid,'2026-11-04','1','11222333000181')", [editable],
    ), /processamento/);
    await assert.rejects(edit(stamp, 1), /outra operacao/);
    await assert.rejects(edit(stamp, 0, [{ number: 1, kind: 'balance', amount_cents: 30001, due_date: '2026-99-99' }]));
    assert.equal((await db.query('select count(*)::int as n from public.holding_website_contract_edits where contract_id=$1', [editable])).rows[0].n, 0);
    assert.equal((await edit(stamp)).rows[0].id, editable);
    const saved = (await db.query('select * from public.holding_website_contracts where id=$1', [editable])).rows[0];
    assert.equal(saved.edit_revision, 1); assert.equal(saved.billing_state, 'local'); assert.equal(saved.asaas_environment, null);
    const audit = (await db.query('select * from public.holding_website_contract_edits where contract_id=$1', [editable])).rows[0];
    assert.equal(audit.previous_installments.length, 3);
    assert.equal(audit.previous_contract.payment_method, 'CREDIT_CARD');
    assert.equal(audit.previous_contract.billing_state, 'local');
    const installments = (await db.query('select * from public.holding_website_installments where contract_id=$1', [editable])).rows;
    assert.ok(installments.every((i) => i.asaas_payment_id === null && i.status === 'LOCAL'));
    await assert.rejects(edit(stamp), /outra operacao/);
    await db.query("select * from public.holding_reserve_website_invoice($1::uuid,'2026-11-04','1','11222333000181')", [editable]);
    const fiscalStamp = await lock();
    await assert.rejects(edit(fiscalStamp, 1), /operacao fiscal/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(edit(stamp), /permission denied/);
      await assert.rejects(db.query('select * from public.holding_website_contract_edits'), /permission denied/);
      await db.exec('reset role');
    }
  });
});
