import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { account, paidRecord, pendingRecord, schema, tx } from './inter-reconciliation.fixture.mjs';

const { default: EmbeddedPostgres } = await import(process.env.EMBEDDED_POSTGRES_MODULE || 'embedded-postgres');
const migration = await readFile('supabase/migrations/20261030140000_inter_reconciliation.sql', 'utf8');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForLock(admin, pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await admin.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('A segunda conexão não aguardou uma trava de banco.');
}

function resultOf(promise) {
  return promise.then((value) => ({ value }), (error) => ({ error }));
}

async function importBatch(client, items) {
  const { rows } = await client.query(
    'select public.bank_inter_import_batch($1::uuid, $2::jsonb) as result',
    [account, JSON.stringify(items)],
  );
  return rows[0].result;
}

async function resolveReview(client, transactionId, action, recordId = null) {
  return client.query(
    'select public.bank_inter_resolve_review($1::uuid, $2, $3::uuid, null, true, $4) as result',
    [transactionId, action, recordId, 'test-user'],
  );
}

test('isolated PostgreSQL serializes concurrent Inter operations', { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(process.env.INTER_PG_TEST_PARENT || tmpdir(), 'inter-reconcile-'));
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    port: await unusedPort(),
    user: 'inter_test',
    password: randomBytes(24).toString('hex'),
    persistent: false,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
    onLog: () => {},
    onError: (error) => console.error(error),
  });
  let started = false;
  const clients = [];
  t.after(async () => {
    for (const client of clients.slice(1)) {
      try {
        await client.query('rollback');
      } catch (error) {
        console.error('Falha ao encerrar transação de teste:', error);
      }
    }
    await Promise.all(clients.map((client) => client.end()));
    if (started) await postgres.stop();
    await rm(directory, { recursive: true, force: true });
  });
  await postgres.initialise();
  await postgres.start();
  started = true;
  for (let index = 0; index < 3; index++) {
    const client = postgres.getPgClient('postgres', '127.0.0.1');
    await client.connect();
    await client.query("set statement_timeout = '8s'");
    clients.push(client);
  }
  const [admin, first, second] = clients;
  await admin.query(schema);
  await admin.query(migration);
  const secondPid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;

  async function reset() {
    await admin.query(`truncate public.system_bank_transactions, public.system_finance_records,
      public.system_bank_classification_rules, public.system_finance_categories, public.system_bank_accounts cascade`);
    await admin.query("insert into public.system_bank_accounts (id, provider, sync_enabled) values ($1, 'inter', true)", [account]);
  }

  async function currentTransaction(externalId) {
    return (await admin.query(
      'select * from public.system_bank_transactions where bank_account_id = $1 and external_id = $2',
      [account, externalId],
    )).rows[0];
  }

  await t.test('replayed batches wait and do not duplicate records', async () => {
    await reset();
    const items = [tx('concurrent-1', 17), tx('concurrent-2', -19)];
    await first.query('begin');
    assert.equal((await importBatch(first, items)).imported, 2);
    await second.query('begin');
    const waiting = resultOf(importBatch(second, items));
    await waitForLock(admin, secondPid);
    await first.query('commit');
    const result = await waiting;
    assert.ifError(result.error);
    assert.equal(result.value.existing, 2);
    await second.query('commit');
    assert.equal(Number((await admin.query('select count(*) as count from public.system_finance_records')).rows[0].count), 2);
  });

  await t.test('only one simultaneous decision resolves a review', async () => {
    await reset();
    await admin.query(
      "insert into public.system_finance_records (id, type, value, status, metadata) values ($1, 'revenue', 50, 'paid', '{}')",
      [paidRecord],
    );
    await importBatch(admin, [tx('competing-decisions', 50)]);
    const movement = await currentTransaction('competing-decisions');
    await first.query('begin');
    await resolveReview(first, movement.id, 'link', paidRecord);
    await second.query('begin');
    const waiting = resultOf(resolveReview(second, movement.id, 'create'));
    await waitForLock(admin, secondPid);
    await first.query('commit');
    const result = await waiting;
    assert.match(result.error?.message || '', /já foi resolvida/);
    await second.query('rollback');
    assert.equal((await currentTransaction('competing-decisions')).finance_record_id, paidRecord);
    assert.equal(Number((await admin.query('select count(*) as count from public.system_finance_records')).rows[0].count), 1);
  });

  await t.test('a candidate changed concurrently cannot be linked using stale data', async () => {
    await reset();
    await admin.query(
      "insert into public.system_finance_records (id, type, value, status, metadata) values ($1, 'expense', 30, 'pending', '{}')",
      [pendingRecord],
    );
    await importBatch(admin, [tx('candidate-changed', -30)]);
    const movement = await currentTransaction('candidate-changed');
    await first.query('begin');
    await first.query('update public.system_finance_records set value = 31 where id = $1', [pendingRecord]);
    await second.query('begin');
    const waiting = resultOf(resolveReview(second, movement.id, 'link', pendingRecord));
    await waitForLock(admin, secondPid);
    await first.query('commit');
    const result = await waiting;
    assert.match(result.error?.message || '', /não corresponde mais/);
    await second.query('rollback');
    const after = await currentTransaction('candidate-changed');
    assert.equal(after.status, 'revisao_duplicidade');
    assert.equal(after.finance_record_id, null);
  });
});
