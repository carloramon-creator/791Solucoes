import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const rootId = '11111111-1111-4111-8111-111111111111';
const source = ts.transpileModule(readFileSync('src/app/api/system/categories/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loadRoute({ denied = false, parent = { id: rootId, type: 'expense', parent_id: null }, failure = null, parentFailure = null } = {}) {
  const inserts = [], reads = [];
  class Query {
    select() { return this; }
    eq(key, value) { reads.push([key, value]); return this; }
    maybeSingle() { return Promise.resolve({ data: parent, error: parentFailure }); }
    insert(rows) { this.rows = rows; inserts.push(rows); return this; }
    single() { this.singleRow = true; return this; }
    then(resolve, reject) {
      const rows = this.rows.map((row) => ({ id: rootId, ...row }));
      return Promise.resolve({ data: failure ? null : this.singleRow ? rows[0] : rows, error: failure }).then(resolve, reject);
    }
  }
  const dependencies = {
    'node:crypto': { randomUUID: (() => { let index = 0; return () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`; })() },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => denied ? { ok: false, status: 401, error: 'Sessão inválida.' } : { ok: true },
    },
    '@/lib/supabase-server': {
      supabaseServer: { from: (table) => { assert.equal(table, 'system_finance_categories'); return new Query(); } },
    },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return {
    inserts, reads,
    post: (body) => mod.exports.POST(new Request('http://localhost/api/system/categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
    rawPost: mod.exports.POST,
  };
}

for (const type of ['expense', 'revenue']) {
  test(`creates a ${type} class and preserves the existing single-object response`, async () => {
    const route = loadRoute();
    const response = await route.post({ name: '  Classe  ', type, parent_id: null, use_webhook: true, ignored: 'not persisted' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.id, rootId);
    assert.equal(body.name, 'Classe');
    assert.equal(body.use_webhook, true);
    assert.deepEqual(route.inserts, [[{ name: 'Classe', type, parent_id: null, use_webhook: true }]]);
    assert.equal(route.reads.length, 0);
  });

  test(`creates a ${type} child only under a root of the same type`, async () => {
    const route = loadRoute({ parent: { id: rootId, type, parent_id: null } });
    const response = await route.post({ name: 'Subclasse', type, parent_id: rootId });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.parent_id, rootId);
    assert.equal(body.use_webhook, false);
    assert.deepEqual(route.reads, [['id', rootId]]);
    assert.equal(route.inserts.length, 1);
  });

  test(`creates a ${type} class and child in one atomic insert`, async () => {
    const route = loadRoute();
    const response = await route.post({ name: 'Classe', subcategory_name: '  Subclasse  ', type });
    assert.equal(response.status, 200);
    const { categories } = await response.json();
    assert.equal(route.inserts.length, 1);
    assert.equal(route.inserts[0].length, 2);
    assert.equal(categories.length, 2);
    const [root, child] = categories;
    assert.notEqual(root.id, child.id);
    assert.equal(root.parent_id, null);
    assert.equal(child.parent_id, root.id);
    assert.equal(child.name, 'Subclasse');
    assert.equal(root.type, type);
    assert.equal(child.type, type);
    assert.equal(root.use_webhook, false);
    assert.equal(child.use_webhook, false);
  });
}

test('rejects invalid input and malformed JSON without inserting anything', async () => {
  const route = loadRoute();
  for (const body of [
    null, [], {}, { name: ' ', type: 'expense' }, { name: 'Classe', type: 'other' },
    { name: 'Classe', type: 'expense', parent_id: 'invalid' },
    { name: 'Classe', type: 'expense', use_webhook: 'false' },
    { name: 'Classe', type: 'expense', subcategory_name: ' ' },
    { name: 'Classe', type: 'expense', subcategory_name: 42 },
    { name: 'Classe', type: 'expense', parent_id: rootId, subcategory_name: 'Filha' },
  ]) {
    assert.equal((await route.post(body)).status, 400, JSON.stringify(body));
  }
  const invalid = await route.rawPost(new Request('http://localhost/api/system/categories', { method: 'POST', body: '{' }));
  assert.equal(invalid.status, 400);
  assert.equal(route.inserts.length, 0);
  assert.equal(route.reads.length, 0);
});

test('rejects unauthenticated requests and invalid, missing, or mismatched parents', async () => {
  const denied = loadRoute({ denied: true });
  assert.equal((await denied.post({ name: 'Classe', type: 'expense' })).status, 401);
  assert.equal(denied.inserts.length, 0);
  for (const parent of [null, { type: 'revenue', parent_id: null }, { type: 'expense', parent_id: rootId }]) {
    const route = loadRoute({ parent });
    const response = await route.post({ name: 'Filha', type: 'expense', parent_id: rootId });
    assert.equal(response.status, 400);
    assert.equal(route.inserts.length, 0);
  }
});

test('reports database failures without retrying as separate class and child writes', async () => {
  const route = loadRoute({ failure: { message: 'Falha de inserção.' } });
  const response = await route.post({ name: 'Classe', type: 'expense', subcategory_name: 'Filha' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Falha de inserção/);
  assert.equal(route.inserts.length, 1);
  assert.equal(route.inserts[0].length, 2);
  const failedRead = loadRoute({ parentFailure: { message: 'Falha ao consultar a classe.' } });
  const failedResponse = await failedRead.post({ name: 'Filha', type: 'expense', parent_id: rootId });
  assert.equal(failedResponse.status, 500);
  assert.equal(failedRead.inserts.length, 0);
});
