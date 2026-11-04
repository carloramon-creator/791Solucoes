import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

function loadModule(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports);
  return mod.exports;
}

const catalog = loadModule('src/lib/website-plans.ts');
const id = '11111111-1111-4111-8111-111111111111';
const valid = {
  name: 'Website institucional',
  description: 'Apresentação da empresa',
  scope: 'Até cinco páginas e duas revisões. Hospedagem contratada separadamente.',
  category: 'creation',
  billing_cycle: 'one_time',
  price_cents: 250099,
  active: true,
  fiscal_config: null,
};
const requiredResources = ['menu.planos', 'submenu.planos.websites'];

test('validates every category and billing combination, without treating projects as subscriptions', () => {
  for (const category of Object.keys(catalog.WEBSITE_CATEGORIES)) {
    for (const billing_cycle of Object.keys(catalog.WEBSITE_BILLING_CYCLES)) {
      const expected = ['creation', 'additional'].includes(category)
        ? billing_cycle === 'one_time' : billing_cycle !== 'one_time';
      assert.equal(catalog.validateWebsitePlan({ ...valid, category, billing_cycle }).ok, expected);
      assert.equal(catalog.websiteBillingCycles(category).includes(billing_cycle), expected);
    }
  }
});

test('preserves exact integer cents, trims text, and whitelists persisted properties', () => {
  const parsed = catalog.validateWebsitePlan({
    ...valid, name: ` ${valid.name} `, description: ' ', scope: ` ${valid.scope} `,
    active: false, system: '791glass', asaas_subscription_id: 'ignored',
  });
  assert.deepEqual(parsed, { ok: true, data: { ...valid, description: '', active: false } });
  for (const price_cents of [1, 999999999]) {
    assert.equal(catalog.validateWebsitePlan({ ...valid, price_cents }).ok, true);
  }
  for (const price_cents of [0, -1, 1.01, NaN, Infinity, 1000000000, '100', null]) {
    assert.equal(catalog.validateWebsitePlan({ ...valid, price_cents }).ok, false);
  }
});

test('rejects malformed, missing, oversized or mistyped fields', () => {
  const invalid = [
    null, [], {}, 'invalid',
    { ...valid, name: ' ' }, { ...valid, name: 'x'.repeat(121) },
    { ...valid, description: null }, { ...valid, description: 'x'.repeat(2001) },
    { ...valid, scope: ' ' }, { ...valid, scope: 'x'.repeat(5001) },
    { ...valid, category: 'glass' }, { ...valid, category: '__proto__' },
    { ...valid, billing_cycle: 'semiannual' }, { ...valid, active: 'false' },
  ];
  for (const value of invalid) assert.equal(catalog.validateWebsitePlan(value).ok, false);
  assert.equal(catalog.validateWebsitePlan({
    ...valid, name: 'x'.repeat(120), description: 'x'.repeat(2000), scope: 'x'.repeat(5000),
  }).ok, true);
});

test('stores per-product fiscal data without guessing licensing codes or accepting invalid confirmation', () => {
  const pending = {
    national_code: '', municipal_code: '', nbs: '', service_description: '', accountant_confirmed: false,
    simples_percent: null,
  };
  assert.deepEqual(catalog.validateWebsitePlan({ ...valid, fiscal_config: pending }).data.fiscal_config, pending);
  assert.equal(catalog.validateWebsitePlan({ ...valid, fiscal_config: { ...pending, accountant_confirmed: true } }).ok, false);
  const configured = {
    national_code: '010101', municipal_code: '001', nbs: '123456789',
    service_description: ' Descrição fiscal validada ', accountant_confirmed: true,
    simples_percent: 6,
  };
  assert.equal(catalog.validateWebsitePlan({ ...valid, fiscal_config: configured }).data.fiscal_config.service_description, 'Descrição fiscal validada');
  for (const patch of [
    { national_code: '0101' }, { municipal_code: '0001' }, { nbs: '111' },
    { accountant_confirmed: 'true' }, { service_description: 'a'.repeat(2001) },
  ]) assert.equal(catalog.validateWebsitePlan({ ...valid, fiscal_config: { ...configured, ...patch } }).ok, false);
  assert.equal(catalog.websiteInvoicePolicy('one_time'), 'manual_project_total');
  assert.equal(catalog.websiteInvoicePolicy('monthly'), 'automatic_after_payment');
  assert.equal(catalog.websiteInvoicePolicy('annual'), 'automatic_after_payment');
});

function loadRoute(options = {}) {
  const rows = new Map((options.rows || []).map((row) => [row.id, { ...row }]));
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; calls.push(this); }
    select(columns) { this.columns = columns; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    in() { return this; }
    order() { return this; }
    insert(value) { this.operation = 'insert'; this.value = value; return this; }
    update(value) { this.operation = 'update'; this.value = value; return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) {
      let data;
      const error = options.failedTable === this.table ? { message: 'Database unavailable' } : null;
      if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
      switch (this.table) {
        case 'holding_user_permission_profiles':
          data = (options.profileIds ?? ['profile']).map((profile_id) => ({ profile_id }));
          break;
        case 'holding_permission_profiles': data = [{ name: options.profileName || 'Comercial' }]; break;
        case 'equipe_791': data = { cargo: options.cargo || 'Comercial' }; break;
        case 'holding_permission_resources':
          data = (options.resources ?? requiredResources).map((code) => ({ code }));
          break;
        case 'holding_profile_resource_permissions':
          data = (options.permissions ?? requiredResources).map((resource_code) => ({ resource_code }));
          break;
        case 'holding_website_plans': {
          if (this.operation) {
            const target = this.operation === 'insert' ? id : this.filters.find(([key]) => key === 'id')?.[1];
            data = this.operation === 'update' && !rows.has(target) ? null : {
              id: target, created_at: '2026-11-04T20:00:00Z', updated_at: '2026-11-04T20:00:00Z', ...this.value,
            };
            if (data) rows.set(target, data);
          } else data = [...rows.values()];
          break;
        }
        default: throw new Error(`Unexpected table ${this.table}`);
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  }
  const route = loadModule('src/app/api/admin/website-plans/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => options.denied
        ? { ok: false, status: options.denied, error: 'Access denied' }
        : { ok: true, user: { email: options.email === null ? null : 'admin@example.test' } },
    },
    '@/lib/supabase-server': { supabaseServer: { from: (table) => new Query(table) } },
    '@/lib/website-plans': catalog,
  });
  return {
    calls, rows,
    request: (method, body, raw = false) => route[method](new Request('http://localhost/api/admin/website-plans', {
      method,
      ...(method === 'GET' ? {} : { body: raw ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    })),
  };
}

test('creates a project and lists its persisted shape, with no Glass, Barber or Asaas access', async () => {
  const route = loadRoute();
  const created = await route.request('POST', { ...valid, ignored: true, id: 'ignored' });
  assert.equal(created.status, 201);
  const { plan } = await created.json();
  assert.equal(plan.id, id);
  assert.equal(plan.price_cents, valid.price_cents);
  assert.equal(plan.ignored, undefined);
  const listed = await route.request('GET');
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await listed.json()).plans, [plan]);
  const write = route.calls.find((call) => call.operation === 'insert');
  assert.deepEqual(write.value, valid);
  assert.equal(write.table, 'holding_website_plans');
});

test('edits and inactivates an existing service without deleting its record', async () => {
  const route = loadRoute({ rows: [{ id, ...valid }] });
  const updated = await route.request('PUT', {
    id, ...valid, name: 'Hospedagem anual', category: 'hosting', billing_cycle: 'annual', active: false,
  });
  assert.equal(updated.status, 200);
  const { plan } = await updated.json();
  assert.equal(plan.active, false);
  assert.equal(plan.billing_cycle, 'annual');
  assert.equal(route.rows.size, 1);
  assert.deepEqual(route.calls.find((call) => call.operation === 'update').filters, [['id', id]]);
  assert.deepEqual((await (await route.request('GET')).json()).plans, [plan]);
});

test('does not report success for a missing product', async () => {
  const route = loadRoute();
  assert.equal((await route.request('PUT', { ...valid, id })).status, 404);
  assert.equal(route.rows.size, 0);
});

test('rejects invalid payloads, malformed JSON and IDs before writing', async () => {
  const route = loadRoute();
  for (const method of ['POST', 'PUT']) {
    for (const body of [null, [], {}, { ...valid, price_cents: 0 }, { ...valid, billing_cycle: 'monthly' }]) {
      assert.equal((await route.request(method, body)).status, 400);
    }
    assert.equal((await route.request(method, '{', true)).status, 400);
  }
  for (const badId of [undefined, '', 1, 'not-a-uuid', `${id}--`]) {
    assert.equal((await route.request('PUT', { ...valid, id: badId })).status, 400);
  }
  assert.equal(route.calls.some((call) => call.operation), false);
});

test('denies unauthenticated users and sponsors before database access', async () => {
  for (const denied of [401, 403]) {
    for (const method of ['GET', 'POST', 'PUT']) {
      const route = loadRoute({ denied });
      assert.equal((await route.request(method, { ...valid, id })).status, denied);
      assert.equal(route.calls.length, 0);
    }
  }
});

test('requires both plan permissions and active resources for assigned profiles', async () => {
  for (const options of [
    { permissions: [] },
    { permissions: ['menu.planos'] },
    { permissions: ['submenu.planos.websites'] },
    { resources: ['menu.planos'] },
    { email: null },
  ]) {
    for (const method of ['GET', 'POST', 'PUT']) {
      const route = loadRoute(options);
      assert.equal((await route.request(method, { ...valid, id })).status, 403);
      assert.equal(route.calls.some((call) => call.table === 'holding_website_plans'), false);
    }
  }
});

test('preserves owner and no-profile bootstrap access conventions', async () => {
  for (const options of [
    { profileIds: [], permissions: [] },
    { profileName: 'Administrador', permissions: [] },
    { cargo: 'Dono', permissions: [] },
  ]) {
    assert.equal((await loadRoute(options).request('GET')).status, 200);
  }
});

test('fails explicitly, not open, when permission queries or persistence fail', async () => {
  for (const failedTable of [
    'holding_user_permission_profiles', 'holding_permission_profiles',
    'equipe_791', 'holding_permission_resources', 'holding_profile_resource_permissions',
    'holding_website_plans',
  ]) {
    for (const method of ['GET', 'POST', 'PUT']) {
      const route = loadRoute({ failedTable });
      const response = await route.request(method, { ...valid, id });
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /Não foi possível/);
      assert.equal(route.rows.size, 0);
    }
  }
});

const require = createRequire(import.meta.url);
const commercialFields = loadModule('src/components/HoldingCommercialFields.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': require('lucide-react'),
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}

function text(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' ? text(node.props?.children) : '';
}

function pageHarness(request) {
  const states = [], refs = [], effects = [], callbacks = [], pending = [], calls = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0;
  const changed = (before, after) => !before || before.some((value, index) => value !== after[index]);
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      }];
    },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useCallback(callback, deps) {
      const index = callbackIndex++;
      if (!callbacks[index] || changed(callbacks[index].deps, deps)) callbacks[index] = { callback, deps };
      return callbacks[index].callback;
    },
    useEffect(callback, deps) {
      const index = effectIndex++;
      if (changed(effects[index]?.deps, deps)) {
        pending.push(() => {
          effects[index]?.cleanup?.();
          effects[index] = { deps, cleanup: callback() };
        });
      }
    },
  };
  const page = loadModule('src/app/planos/websites/page.tsx', {
    react: hooks,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': require('lucide-react'),
    '@/lib/website-plans': catalog,
    '@/components/HoldingCommercialFields': commercialFields,
    '@/lib/holding-auth-fetch': {
      holdingAuthFetch: async (url, init = {}) => {
        assert.equal(url, '/api/admin/website-plans');
        const method = init.method || 'GET';
        const body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ method, body });
        return request(method, body);
      },
    },
  });
  const render = () => {
    stateIndex = 0; refIndex = 0; effectIndex = 0; callbackIndex = 0;
    const tree = page.default();
    while (pending.length) pending.shift()();
    return tree;
  };
  const button = (label) => nodes(render(), (node) => node.type === 'button' && text(node).includes(label))[0];
  const field = (label) => {
    const container = nodes(render(), (node) => node.type === 'label' && text(node).includes(label))[0];
    return nodes(container, (node) => ['input', 'textarea', 'select'].includes(node.type))[0];
  };
  return {
    calls, render, button, field,
    fill: (label, value) => field(label).props.onChange({ target: { value, checked: value } }),
    submit: () => nodes(render(), (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }),
    async mount() { render(); await settle(); return render(); },
  };
}

test('UI creates, reloads, edits and inactivates a product with exact price and persisted response', async () => {
  const api = loadRoute();
  const ui = pageHarness(api.request);
  await ui.mount();
  assert.match(text(ui.render()), /Nenhum produto cadastrado/);
  ui.button('Novo produto').props.onClick();
  ui.fill('Nome do produto', 'Website institucional');
  ui.fill('Escopo, limites', valid.scope);
  ui.fill('Preço total', '2500.99');
  await ui.submit();
  assert.equal(ui.calls.at(-1).method, 'POST');
  assert.equal(ui.calls.at(-1).body.price_cents, 250099);
  assert.match(text(ui.render()), /2\.500,99/);
  assert.match(text(ui.render()), /Nenhuma cobrança ou nota fiscal foi gerada/);
  assert.equal(nodes(ui.render(), (node) => node.type === 'form').length, 0);

  const reloaded = pageHarness(api.request);
  await reloaded.mount();
  assert.match(text(reloaded.render()), /Website institucional/);
  reloaded.button('Editar produto').props.onClick();
  assert.equal(reloaded.field('Preço total').props.value, '2500.99');
  reloaded.fill('Produto ativo', false);
  await reloaded.submit();
  assert.equal(reloaded.calls.at(-1).method, 'PUT');
  assert.equal(reloaded.calls.at(-1).body.id, id);
  assert.equal(api.rows.get(id).active, false);
  assert.match(text(reloaded.render()), /Inativo/);
});

test('UI switches between project and recurring categories with only compatible billing cycles', async () => {
  const ui = pageHarness(loadRoute().request);
  await ui.mount();
  ui.button('Novo produto').props.onClick();
  assert.equal(ui.field('Modalidade').props.value, 'one_time');
  ui.fill('Categoria', 'hosting');
  assert.equal(ui.field('Ciclo padrão').props.value, 'monthly');
  assert.deepEqual(nodes(ui.field('Ciclo padrão'), (node) => node.type === 'option').map((node) => node.props.value), ['monthly', 'quarterly', 'semiannual', 'annual']);
  ui.fill('Ciclo padrão', 'annual');
  ui.fill('Categoria', 'maintenance');
  assert.equal(ui.field('Ciclo padrão').props.value, 'annual');
  ui.fill('Categoria', 'additional');
  assert.equal(ui.field('Modalidade').props.value, 'one_time');
});

test('one recurring product persists four total-period prices and retains them when changing the default cycle', async () => {
  const api = loadRoute();
  const ui = pageHarness(api.request);
  await ui.mount(); ui.button('Novo produto').props.onClick();
  ui.fill('Nome do produto', 'Hospedagem'); ui.fill('Escopo, limites', 'Hospedagem com backup.');
  ui.fill('Categoria', 'hosting');
  for (const [label, value] of [['Mensal (R$)', '100'], ['Trimestral (R$)', '285'], ['Semestral (R$)', '540'], ['Anual (R$)', '1000']]) {
    ui.fill(label, value); assert.match(ui.field(label).props.className, /h-11/);
  }
  ui.fill('Ciclo padrão', 'quarterly');
  assert.equal(ui.field('Trimestral (R$)').props.value, '285');
  await ui.submit();
  const saved = ui.calls.at(-1).body;
  assert.deepEqual(saved.recurring_prices, { monthly: 10000, quarterly: 28500, semiannual: 54000, annual: 100000 });
  assert.equal(saved.price_cents, 28500);
  const edited = pageHarness(api.request); await edited.mount(); edited.button('Editar produto').props.onClick();
  assert.equal(edited.field('Anual (R$)').props.value, '1000.00');
  edited.fill('Anual (R$)', '');
  await edited.submit();
  assert.equal(edited.calls.at(-1).body.recurring_prices.annual, undefined);
});

test('recurring catalog visual fixture uses the actual four-price form and Tailwind styles', {
  skip: !process.env.WEBSITE_UI_FIXTURE_DIR,
}, async () => {
  const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server');
  const { compile } = await import('@tailwindcss/node');
  const ui = pageHarness(loadRoute().request);
  await ui.mount(); ui.button('Novo produto').props.onClick(); ui.fill('Categoria', 'hosting');
  const markup = renderToStaticMarkup(ui.render());
  const compiler = await compile('@import "tailwindcss";', { base: process.cwd(), onDependency() {} });
  const candidates = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(' '));
  const css = compiler.build(candidates);
  writeFileSync(join(process.env.WEBSITE_UI_FIXTURE_DIR, 'website-recurring-plans-fixture.html'),
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-slate-50"><main style="padding:24px">${markup}</main></body></html>`);
});

test('UI standardizes single-line fields and explains project installments without configuring recurrence', async () => {
  const ui = pageHarness(loadRoute().request);
  await ui.mount();
  ui.button('Novo produto').props.onClick();
  for (const label of ['Nome do produto', 'Categoria', 'Modalidade', 'Preço total']) {
    const field = ui.field(label);
    for (const style of ['h-11', 'rounded-md', 'border-slate-300', 'font-normal', 'text-sm']) {
      assert.ok(field.props.className.split(' ').includes(style), `${label}: ${style}`);
    }
    if (field.type === 'select') assert.match(field.props.className, /appearance-none/);
  }
  assert.doesNotMatch(ui.field('Escopo, limites').props.className, /h-11/);
  assert.match(text(ui.render()), /valor total do projeto, não o valor da parcela/);
  assert.match(text(ui.render()), /O parcelamento ainda não é configurado nesta tela/);
  ui.fill('Categoria', 'hosting');
  assert.doesNotMatch(text(ui.render()), /valor total do projeto, não o valor da parcela/);
});

test('UI resets accounting confirmation when fiscal data changes and does not enable real issuance', async () => {
  const ui = pageHarness(loadRoute().request);
  await ui.mount(); ui.button('Novo produto').props.onClick();
  ui.fill('Tributação nacional', '010101');
  ui.fill('NBS', '123456789');
  ui.fill('Descrição fiscal', 'Confecção de website');
  ui.fill('Enquadramento deste serviço', true);
  assert.equal(ui.field('Enquadramento deste serviço').props.checked, true);
  ui.fill('NBS', '123456780');
  assert.equal(ui.field('Enquadramento deste serviço').props.checked, false);
  assert.match(text(ui.render()), /emissão manual de uma NFS-e pelo valor total/);
  assert.match(text(ui.render()), /competência será a data de confirmação do pagamento/);
  ui.fill('Categoria', 'hosting');
  assert.match(text(ui.render()), /emissão automática de NFS-e após confirmação/);
});

test('UI retains form data and reports failed saves, without showing success', async () => {
  const ui = pageHarness(async (method) => method === 'GET'
    ? Response.json({ plans: [] })
    : Response.json({ error: 'Banco indisponível.' }, { status: 500 }));
  await ui.mount();
  ui.button('Novo produto').props.onClick();
  ui.fill('Nome do produto', valid.name);
  ui.fill('Escopo, limites', valid.scope);
  ui.fill('Preço total', '0');
  await ui.submit();
  assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0);
  ui.fill('Preço total', '2500.99');
  await ui.submit();
  assert.match(text(ui.render()), /Banco indisponível/);
  assert.equal(ui.field('Nome do produto').props.value, valid.name);
  assert.equal(ui.field('Preço total').props.value, '2500.99');
  assert.equal(nodes(ui.render(), (node) => node.props?.role === 'status').length, 0);
  ui.button('Cancelar').props.onClick();
  assert.equal(nodes(ui.render(), (node) => node.type === 'form').length, 0);
});

test('UI does not disguise loading failures as an empty catalog and supports retry', async () => {
  let failing = true;
  const ui = pageHarness(async () => failing
    ? Response.json({ error: 'Catálogo indisponível.' }, { status: 500 })
    : Response.json({ plans: [] }));
  await ui.mount();
  assert.match(text(ui.render()), /Catálogo indisponível/);
  assert.doesNotMatch(text(ui.render()), /Nenhum produto cadastrado/);
  assert.equal(ui.button('Novo produto').props.disabled, true);
  failing = false;
  ui.button('Atualizar').props.onClick();
  await settle();
  assert.equal(ui.button('Novo produto').props.disabled, false);
  assert.match(text(ui.render()), /Nenhum produto cadastrado/);
});
