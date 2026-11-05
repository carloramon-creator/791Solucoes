import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`); return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

test('only explicit managers can approve, and approval persists verified actor with compare-and-set', async () => {
  let allowed = false, writes = [], filters = [], reads = 0;
  let row = { approval_status: 'pending', billing_state: 'local', lifecycle_status: 'active' };
  const query = {
    select() { return this; }, eq(...value) { filters.push(value); return this; },
    single: async () => { reads++; return { data: row, error: null }; },
    update(value) { writes.push(value); return this; },
    maybeSingle: async () => ({ data: { id: 'subscription' }, error: null }),
  };
  const { approveWebsiteSubscription } = load('src/lib/website-subscription-approval.ts', {
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true, user: { id: 'verified-actor', email: 'manager@example.test' } }) },
    '@/lib/holding-websites-permissions': { getHoldingWebsitesPermissions: async () => ({ manage: allowed }) },
    '@/lib/supabase-server': { supabaseServer: { from: () => query } },
  });
  await assert.rejects(approveWebsiteSubscription(new Request('https://holding.test'), 'subscription'), /Somente gestores/);
  assert.equal(reads, 0); assert.equal(writes.length, 0);
  allowed = true;
  await approveWebsiteSubscription(new Request('https://holding.test'), 'subscription');
  assert.equal(writes[0].approved_by, 'verified-actor');
  assert.equal(writes[0].approval_status, 'approved');
  assert.ok(Number.isFinite(Date.parse(writes[0].approved_at)));
  assert.ok(filters.some(([key, value]) => key === 'approval_status' && value === 'pending'));
  row = { ...row, approval_status: 'approved' };
  await approveWebsiteSubscription(new Request('https://holding.test'), 'subscription');
  assert.equal(writes.length, 1);
  for (const patch of [{ billing_state: 'issued' }, { lifecycle_status: 'paused' }, { lifecycle_status: 'cancelled' }]) {
    row = { approval_status: 'pending', billing_state: 'local', lifecycle_status: 'active', ...patch };
    await assert.rejects(approveWebsiteSubscription(new Request('https://holding.test'), 'subscription'), /não está disponível/);
  }
});
