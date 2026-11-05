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

test('only managers or explicitly authorized commercial staff can approve through the atomic RPC', async () => {
  let allowed = false, commercial = false, calls = [], failure = null;
  const { approveWebsiteSubscription } = load('src/lib/website-subscription-approval.ts', {
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true, user: { id: 'verified-actor', email: 'manager@example.test' } }) },
    '@/lib/holding-websites-permissions': { getHoldingWebsitesPermissions: async () => ({ manage: allowed }) },
    '@/lib/supabase-server': { supabaseServer: {
      rpc: async (name, args) => {
        if (name === 'holding_website_permission') return { data: commercial, error: null };
        calls.push({ name, args });
        return { error: failure };
      },
    } },
  });
  await assert.rejects(approveWebsiteSubscription(new Request('https://holding.test'), 'subscription'), /Somente gestor/);
  assert.equal(calls.length, 0);
  allowed = true;
  await approveWebsiteSubscription(new Request('https://holding.test'), 'subscription');
  assert.deepEqual(calls[0], { name: 'holding_approve_website_delivery', args: {
    p_actor: 'manager@example.test', p_user_id: 'verified-actor', p_subscription_id: 'subscription',
  } });
  allowed = false; commercial = true;
  await approveWebsiteSubscription(new Request('https://holding.test'), 'subscription');
  assert.equal(calls.length, 2);
  failure = { code: 'P0001', message: 'Configure o valor de produtividade' };
  await assert.rejects(approveWebsiteSubscription(new Request('https://holding.test'), 'subscription'), /Configure o valor/);
  failure = { code: 'other', message: 'internal details' };
  await assert.rejects(approveWebsiteSubscription(new Request('https://holding.test'), 'subscription'), /não foram confirmadas/);
});
