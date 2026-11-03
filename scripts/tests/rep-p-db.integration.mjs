import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
const { Client } = createRequire(import.meta.url)(process.argv[2]);
const host = process.env.RH_TEST_PG_SOCKET;
if (!host || !isAbsolute(host)) throw new Error('Use apenas socket Unix de PostgreSQL descartável.');
const db = new Client({ host, user: 'ponto_test', database: 'holding_repp_test', port: 5432 });
await db.connect();
try {
  assert.equal((await db.query("SELECT current_setting('cluster_name') AS name")).rows[0].name, '791glass-rh-isolated');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='public'::regnamespace")).rows[0].n, 0,
    'Banco descartável precisa estar vazio.');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await db.query(`CREATE ROLE ${role}`);
  }
  await db.query(readFileSync('supabase/migrations/20261103173000_rep_p_comprovantes_homologacao.sql', 'utf8'));
  const id = '00000000-0000-4000-8000-000000000001';
  for (const role of ['anon', 'authenticated']) {
    await db.query(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM rep_p_comprovantes_homologacao'), /permission denied/);
    await assert.rejects(db.query('DELETE FROM rep_p_comprovantes_homologacao'), /permission denied/);
    await db.query('RESET ROLE');
  }
  await db.query('SET ROLE service_role');
  await db.query(`INSERT INTO rep_p_comprovantes_homologacao
    (registro_id,tenant_id,usuario_id,marcacao_hash,pdf_base64,certificado_fingerprint,certificado_validade)
    VALUES($1,$1,$1,$2,$3,'old-certificate','2027-01-01')`, [id, 'a'.repeat(64), Buffer.from('%PDF-test-only').toString('base64')]);
  const original = (await db.query('SELECT * FROM rep_p_comprovantes_homologacao')).rows[0];
  await assert.rejects(db.query(`INSERT INTO rep_p_comprovantes_homologacao SELECT * FROM rep_p_comprovantes_homologacao`), /duplicate key/);
  for (const sql of ["UPDATE rep_p_comprovantes_homologacao SET certificado_fingerprint='new-certificate'",
    'DELETE FROM rep_p_comprovantes_homologacao', 'TRUNCATE rep_p_comprovantes_homologacao']) {
    await assert.rejects(db.query(sql), /permission denied/);
  }
  await db.query('RESET ROLE');
  for (const sql of ["UPDATE rep_p_comprovantes_homologacao SET certificado_fingerprint='new-certificate'",
    'DELETE FROM rep_p_comprovantes_homologacao', 'TRUNCATE rep_p_comprovantes_homologacao']) {
    await assert.rejects(db.query(sql), /imutável/);
  }
  assert.deepEqual((await db.query('SELECT * FROM rep_p_comprovantes_homologacao')).rows[0], original);
  console.log('PASS: holding receipt table restricts reads, rejects duplicate emissions and preserves signed originals.');
} finally { await db.end(); }
