import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  account, otherAccount, paidRecord, pendingRecord, cardRecord,
  category, subcategory, ruleId, schema, tx,
} from './inter-reconciliation.fixture.mjs';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile('supabase/migrations/20261030140000_inter_reconciliation.sql', 'utf8');

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(schema);
  await db.exec(migration);
  await db.query(
    `insert into public.system_bank_accounts (id, provider, sync_enabled)
     values ($1, 'inter', true), ($2, 'asaas', true)`,
    [account, otherAccount],
  );
  return db;
}

async function importBatch(db, items, accountId = account) {
  const { rows } = await db.query(
    'select public.bank_inter_import_batch($1::uuid, $2::jsonb) as result',
    [accountId, JSON.stringify(items)],
  );
  return rows[0].result;
}

async function transaction(db, externalId) {
  const { rows } = await db.query(
    'select * from public.system_bank_transactions where bank_account_id = $1 and external_id = $2',
    [account, externalId],
  );
  return rows[0];
}

async function resolve(db, transactionId, action, recordId = null, allowPaid = true, rule = null) {
  const { rows } = await db.query(
    'select public.bank_inter_resolve_review($1::uuid, $2, $3::uuid, $4::jsonb, $5, $6) as result',
    [transactionId, action, recordId, rule ? JSON.stringify(rule) : null, allowPaid, 'test-user'],
  );
  return rows[0].result;
}

async function settle(db, recordId, amount, handling = 'adjust') {
  const { rows } = await db.query(
    `select public.bank_inter_settle_record($1::uuid, $2::numeric, null, null, $3) as result`,
    [recordId, amount, handling],
  );
  return rows[0].result;
}

test('imports credits and debits atomically and replays IDs without duplication', async (t) => {
  const db = await setup(t);
  assert.deepEqual(await importBatch(db, [tx('credit', 12.34), tx('debit', -42.1)]), {
    imported: 2, pending_review: 0, auto_classified: 0, existing: 0, rule_counts: {},
  });
  assert.deepEqual(await importBatch(db, [tx('credit', 12.34), tx('debit', -42.1)]), {
    imported: 0, pending_review: 0, auto_classified: 0, existing: 2, rule_counts: {},
  });
  const { rows } = await db.query(
    `select r.type, r.value, r.status, r.category, r.metadata->>'bank_tx_id' as bank_tx_id,
            t.id as transaction_id, t.status as tx_status
       from public.system_bank_transactions t
       join public.system_finance_records r on r.id = t.finance_record_id
      order by t.external_id`,
  );
  assert.deepEqual(rows.map((row) => [row.type, Number(row.value), row.status, row.category, row.tx_status]), [
    ['revenue', 12.34, 'paid', 'A classificar', 'a_classificar'],
    ['expense', 42.1, 'paid', 'A classificar', 'a_classificar'],
  ]);
  assert.ok(rows.every((row) => row.bank_tx_id === row.transaction_id));
  await assert.rejects(
    importBatch(db, [tx('new-before-error', 8), tx('credit', 99)]),
    /alterou a data ou o valor/,
  );
  assert.equal(await transaction(db, 'new-before-error'), undefined);
});

test('holds all matching paid, pending, card and unassigned records without changing the balance', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records
       (id, type, value, description, status, bank_account_id, metadata, created_at)
     values
       ($1, 'revenue', 50, 'Pago antigo', 'paid', $4, '{}', '2025-01-01'),
       ($2, 'revenue', 50, 'Pendente sem conta', 'pending', null, '{}', '2026-10-30'),
       ($3, 'revenue', 50, 'Cartão', 'paid', $4, '{"card_id":"card-1"}', '2026-10-29')`,
    [paidRecord, pendingRecord, cardRecord, account],
  );
  assert.deepEqual(await importBatch(db, [tx('ambiguous', 50), tx('unmatched', -9)]), {
    imported: 1, pending_review: 1, auto_classified: 0, existing: 0, rule_counts: {},
  });
  const ambiguous = await transaction(db, 'ambiguous');
  assert.equal(ambiguous.status, 'revisao_duplicidade');
  assert.equal(ambiguous.finance_record_id, null);
  const result = await db.query(
    'select * from public.bank_inter_review_candidates($1::uuid, 0, 20)',
    [ambiguous.id],
  );
  assert.equal(result.rows.length, 3);
  assert.equal(Number(result.rows[0].total_count), 3);
  assert.equal(result.rows.find((row) => row.id === cardRecord).blocked_reason, 'cartao');
  const balance = await db.query(
    "select sum(case when type = 'revenue' then value else -value end) as total from public.system_finance_records where status = 'paid'",
  );
  assert.equal(Number(balance.rows[0].total), 91);
  await assert.rejects(resolve(db, ambiguous.id, 'link', cardRecord), /cartão/);
  await assert.rejects(resolve(db, ambiguous.id, 'link', paidRecord, false), /permissão/);
  await resolve(db, ambiguous.id, 'link', paidRecord);
  assert.equal((await transaction(db, 'ambiguous')).status, 'conciliado');
  const after = await db.query('select count(*) as count from public.system_finance_records');
  assert.equal(Number(after.rows[0].count), 4);
  await assert.rejects(resolve(db, ambiguous.id, 'create'), /já foi resolvida/);
});

test('keeps linked pending records pending until their normal settlement', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records (id, type, value, description, status, metadata)
     values ($1, 'expense', 19.9, 'Despesa pendente', 'pending', '{}')`,
    [pendingRecord],
  );
  await importBatch(db, [tx('pending-match', -19.9)]);
  const bankTx = await transaction(db, 'pending-match');
  await resolve(db, bankTx.id, 'link', pendingRecord);
  let record = (await db.query('select * from public.system_finance_records where id = $1', [pendingRecord])).rows[0];
  assert.equal(record.status, 'pending');
  assert.equal(record.bank_account_id, account);
  assert.equal((await transaction(db, 'pending-match')).status, 'pendente_baixa');
  await db.query("update public.system_finance_records set status = 'paid' where id = $1", [pendingRecord]);
  record = (await db.query('select * from public.system_finance_records where id = $1', [pendingRecord])).rows[0];
  assert.equal(record.status, 'paid');
  assert.equal((await transaction(db, 'pending-match')).status, 'conciliado');
});

test('requires review for incomplete or invalid possible matches', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records
       (id, type, value, status, bank_account_id, metadata)
     values
       ($1, null, 51, 'paid', $4, '{}'),
       ($2, 'expense', 52, null, $4, '{}'),
       ($3, 'revenue', -53, 'paid', $4, '{}'),
       ('10000000-0000-4000-8000-000000000004', 'revenue', 54, 'cancelled', $4, '{}')`,
    [paidRecord, pendingRecord, cardRecord, account],
  );
  assert.deepEqual(await importBatch(db, [
    tx('invalid-type', 51), tx('invalid-status', -52),
    tx('invalid-value', 53), tx('cancelled-match', 54),
  ]), {
    imported: 1, pending_review: 3, auto_classified: 0, existing: 0, rule_counts: {},
  });
  for (const [externalId, recordId, reason] of [
    ['invalid-type', paidRecord, 'tipo_invalido'],
    ['invalid-status', pendingRecord, 'status_invalido'],
    ['invalid-value', cardRecord, 'valor_invalido'],
  ]) {
    const bankTx = await transaction(db, externalId);
    assert.equal(bankTx.status, 'revisao_duplicidade');
    const candidates = await db.query(
      'select * from public.bank_inter_review_candidates($1::uuid, 0, 20)', [bankTx.id],
    );
    assert.equal(candidates.rows[0].blocked_reason, reason);
    await assert.rejects(resolve(db, bankTx.id, 'link', recordId), /Confira a situação/);
  }
});

test('classifies paid imports without losing a pending settlement', async (t) => {
  const db = await setup(t);
  await importBatch(db, [tx('classify-paid', 23)]);
  const paid = await transaction(db, 'classify-paid');
  await db.query(
    `update public.system_finance_records
       set metadata = jsonb_set(metadata, '{needs_classification}', 'false')
     where id = $1`,
    [paid.finance_record_id],
  );
  assert.equal((await transaction(db, 'classify-paid')).status, 'classificado');

  await db.query(
    `insert into public.system_finance_records (id, type, value, status, metadata)
     values ($1, 'expense', 25, 'pending', '{"needs_classification":true}')`,
    [pendingRecord],
  );
  await importBatch(db, [tx('classify-pending', -25)]);
  const pending = await transaction(db, 'classify-pending');
  await resolve(db, pending.id, 'link', pendingRecord);
  await db.query(
    `update public.system_finance_records
       set metadata = jsonb_set(metadata, '{needs_classification}', 'false')
     where id = $1`,
    [pendingRecord],
  );
  assert.equal((await transaction(db, 'classify-pending')).status, 'pendente_baixa');
});

test('settles an exact linked payment and keeps the bank transaction reconciled', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records
       (id, type, value, description, status, metadata)
     values ($1, 'expense', 100, 'Conta', 'pending', '{}')`,
    [pendingRecord],
  );
  await importBatch(db, [tx('settle-exact', -100)]);
  const bankTx = await transaction(db, 'settle-exact');
  await resolve(db, bankTx.id, 'link', pendingRecord);
  const result = await settle(db, pendingRecord, 100);
  assert.equal(result.settledRecord.status, 'paid');
  assert.equal(result.remainingRecord, null);
  assert.equal(result.bankReviewRequired, false);
  assert.deepEqual(result.meta, { originalValue: 100, paidAmount: 100, difference: 0, handling: 'adjust' });
  assert.equal((await transaction(db, 'settle-exact')).status, 'conciliado');
});

test('settles part of a linked payment and requeues the movement atomically', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records
       (id, type, value, description, status, metadata)
     values ($1, 'expense', 100, 'Conta', 'pending', '{}')`,
    [pendingRecord],
  );
  await importBatch(db, [tx('settle-partial', -100)]);
  const bankTx = await transaction(db, 'settle-partial');
  await resolve(db, bankTx.id, 'link', pendingRecord);
  const result = await settle(db, pendingRecord, 40, 'keep_open');
  assert.equal(result.settledRecord.status, 'paid');
  assert.equal(Number(result.settledRecord.value), 40);
  assert.equal(result.remainingRecord.status, 'pending');
  assert.equal(Number(result.remainingRecord.value), 60);
  assert.equal(result.remainingRecord.metadata.bank_tx_id, undefined);
  assert.equal(result.remainingRecord.metadata.settlement_parent_id, pendingRecord);
  assert.equal(result.bankReviewRequired, true);
  assert.equal((await transaction(db, 'settle-partial')).status, 'revisao_duplicidade');
});

test('requires a new review if settlement changes the linked bank account', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records
       (id, type, value, description, status, metadata)
     values ($1, 'expense', 100, 'Conta', 'pending', '{}')`,
    [pendingRecord],
  );
  await importBatch(db, [tx('settle-other-account', -100)]);
  const bankTx = await transaction(db, 'settle-other-account');
  await resolve(db, bankTx.id, 'link', pendingRecord);
  await assert.rejects(settle(db, pendingRecord, 40.001), /Dados de baixa inválidos/);
  const { rows } = await db.query(
    `select public.bank_inter_settle_record($1::uuid, 100, $2::uuid, null, 'adjust') as result`,
    [pendingRecord, otherAccount],
  );
  assert.equal(rows[0].result.bankReviewRequired, true);
  assert.equal(rows[0].result.settledRecord.bank_account_id, otherAccount);
  assert.equal(rows[0].result.settledRecord.metadata.bank_tx_id, undefined);
  assert.equal((await transaction(db, 'settle-other-account')).status, 'revisao_duplicidade');
});

test('rolls back the entire linked settlement if the remainder cannot be created', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records
       (id, type, value, description, status, metadata)
     values ($1, 'expense', 100, 'Conta', 'pending', '{}')`,
    [pendingRecord],
  );
  await importBatch(db, [tx('settle-fails', -100)]);
  const bankTx = await transaction(db, 'settle-fails');
  await resolve(db, bankTx.id, 'link', pendingRecord);
  await db.exec(
    "alter table public.system_finance_records add constraint reject_test_remainder check (description not like '%Saldo em aberto%')",
  );
  await assert.rejects(settle(db, pendingRecord, 40, 'keep_open'), /reject_test_remainder/);
  const record = (await db.query('select * from public.system_finance_records where id = $1', [pendingRecord])).rows[0];
  assert.equal(record.status, 'pending');
  assert.equal(Number(record.value), 100);
  assert.equal(record.metadata.bank_tx_id, bankTx.id);
  assert.equal((await transaction(db, 'settle-fails')).status, 'pendente_baixa');
  assert.equal(Number((await db.query('select count(*) as count from public.system_finance_records')).rows[0].count), 1);
});

test('requeues transactions when linked records change or are deleted', async (t) => {
  const db = await setup(t);
  await importBatch(db, [tx('changed', 10), tx('deleted', -20)]);
  const changed = await transaction(db, 'changed');
  const deleted = await transaction(db, 'deleted');
  await db.query('update public.system_finance_records set value = 11 where id = $1', [changed.finance_record_id]);
  const updated = await transaction(db, 'changed');
  assert.equal(updated.status, 'revisao_duplicidade');
  assert.equal(updated.finance_record_id, null);
  const record = (await db.query('select metadata from public.system_finance_records where id = $1', [changed.finance_record_id])).rows[0];
  assert.equal(record.metadata.bank_tx_id, undefined);
  assert.equal(record.metadata.bank_link_provider, undefined);
  await db.query('delete from public.system_finance_records where id = $1', [deleted.finance_record_id]);
  const unlinked = await transaction(db, 'deleted');
  assert.equal(unlinked.status, 'revisao_duplicidade');
  assert.equal(unlinked.finance_record_id, null);
  assert.match(unlinked.review_reason, /excluído/);
});

test('creates a new record only after explicit review and records the decision', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records (id, type, value, status, bank_account_id, metadata)
     values ($1, 'revenue', 70, 'paid', $2, '{}')`,
    [paidRecord, account],
  );
  await importBatch(db, [tx('separate', 70)]);
  const pending = await transaction(db, 'separate');
  await resolve(db, pending.id, 'create');
  const resolved = await transaction(db, 'separate');
  assert.equal(resolved.status, 'a_classificar');
  assert.equal(resolved.review_resolution, 'create');
  assert.equal(resolved.review_resolved_by, 'test-user');
  assert.ok(resolved.finance_record_id);
  assert.notEqual(resolved.finance_record_id, paidRecord);
});

test('applies unchanged classification rules and rolls back a stale rule', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_categories (id, name, type, parent_id)
     values ($1, 'Compras', 'expense', null), ($2, 'Vidro', 'expense', $1)`,
    [category, subcategory],
  );
  const rule = {
    id: ruleId, pattern: 'fornecedor', record_type: 'expense',
    category_id: subcategory, category_name: 'Vidro', bank_account_id: account,
  };
  await db.query(
    `insert into public.system_bank_classification_rules
       (id, pattern, record_type, category_id, category_name, bank_account_id)
     values ($1, $2, $3, $4, $5, $6)`,
    Object.values(rule),
  );
  assert.deepEqual(await importBatch(db, [tx('classified', -30, { rule })]), {
    imported: 1, pending_review: 0, auto_classified: 1, existing: 0, rule_counts: { [ruleId]: 1 },
  });
  const bankTx = await transaction(db, 'classified');
  const record = (await db.query('select * from public.system_finance_records where id = $1', [bankTx.finance_record_id])).rows[0];
  assert.equal(record.category, 'Vidro');
  assert.equal(record.metadata.category_parent_id, category);
  assert.equal(record.metadata.category_subcategory_id, subcategory);
  assert.equal(record.metadata.needs_classification, false);
  assert.equal((await db.query('select hits from public.system_bank_classification_rules where id = $1', [ruleId])).rows[0].hits, 1);
  await assert.rejects(
    importBatch(db, [tx('before-stale', 4), tx('stale', -31, { rule: { ...rule, pattern: 'old' } })]),
    /regra de classificação mudou/,
  );
  assert.equal(await transaction(db, 'before-stale'), undefined);
  assert.equal(await transaction(db, 'stale'), undefined);
});

test('rejects disabled or non-Inter accounts and restricts database functions', async (t) => {
  const db = await setup(t);
  await assert.rejects(importBatch(db, [tx('wrong-provider', 1)], otherAccount), /não está habilitada/);
  await db.query('update public.system_bank_accounts set provider = null where id = $1', [otherAccount]);
  await assert.rejects(importBatch(db, [tx('no-provider', 1)], otherAccount), /não está habilitada/);
  await db.query('update public.system_bank_accounts set sync_enabled = false where id = $1', [account]);
  await assert.rejects(importBatch(db, [tx('disabled', 1)]), /não está habilitada/);
  await db.exec('set role anon');
  await assert.rejects(
    db.query('select public.bank_inter_import_batch($1::uuid, $2::jsonb)', [account, JSON.stringify([tx('unauthorized', 1)])]),
    /permission denied/,
  );
  await assert.rejects(settle(db, pendingRecord, 1), /permission denied/);
  await db.exec('reset role');
  await db.exec('set role authenticated');
  await assert.rejects(
    db.query('select public.bank_inter_review_candidates($1::uuid, 0, 20)', [paidRecord]),
    /permission denied/,
  );
  await assert.rejects(settle(db, pendingRecord, 1), /permission denied/);
  await db.exec('reset role');
  await db.query('update public.system_bank_accounts set sync_enabled = true where id = $1', [account]);
  await db.exec('set role service_role');
  assert.equal((await importBatch(db, [tx('service', 1)])).imported, 1);
  await assert.rejects(
    db.query('select public.bank_inter_find_candidates($1::uuid, 1)', [account]),
    /permission denied/,
  );
  await assert.rejects(
    db.query('select public.bank_inter_create_record($1::uuid, null, true)', [paidRecord]),
    /permission denied/,
  );
  await db.exec('reset role');
});

test('only one repeated decision can resolve a review', async (t) => {
  const db = await setup(t);
  await db.query(
    `insert into public.system_finance_records (id, type, value, status, bank_account_id, metadata)
     values ($1, 'expense', 10, 'paid', $2, '{}')`,
    [paidRecord, account],
  );
  await importBatch(db, [tx('decision', -10)]);
  const bankTx = await transaction(db, 'decision');
  const results = await Promise.allSettled([
    resolve(db, bankTx.id, 'link', paidRecord),
    resolve(db, bankTx.id, 'create'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(Number((await db.query('select count(*) as count from public.system_finance_records')).rows[0].count), 1);
});

test('handles repeated batches of hundreds of distinct movements', async (t) => {
  const db = await setup(t);
  const items = Array.from({ length: 300 }, (_, index) => tx(`bulk-${index}`, index % 2 ? -15 : 15));
  const first = await importBatch(db, items.slice(0, 200));
  const second = await importBatch(db, items.slice(200));
  assert.equal(first.imported + second.imported, 300);
  assert.equal((await importBatch(db, items.slice(0, 200))).existing, 200);
  assert.equal((await importBatch(db, items.slice(200))).existing, 100);
  assert.equal(Number((await db.query('select count(*) as count from public.system_finance_records')).rows[0].count), 300);
});
