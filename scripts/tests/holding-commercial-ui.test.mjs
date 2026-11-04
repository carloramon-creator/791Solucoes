import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)((id) => {
    if (id in dependencies) return dependencies[id];
    if (id === 'react/jsx-runtime' || id === 'lucide-react') return require(id);
    throw new Error(`Unexpected dependency ${id}`);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const customers = load('src/lib/holding-customers.ts');
const terms = load('src/lib/website-contracts.ts', { '@/lib/holding-customers': customers });
const catalog = load('src/lib/website-plans.ts');
const fields = load('src/components/HoldingCommercialFields.tsx');
const customerId = '10000000-0000-4000-8000-000000000001';
const planId = '20000000-0000-4000-8000-000000000001';
const contractId = '30000000-0000-4000-8000-000000000001';
const customer = {
  id: customerId, name: 'Cliente fictício', document: '52998224725', email: 'test@example.test',
  phone: '', postal_code: '', address: '', address_number: '', complement: '', district: '', city: '', state: '', active: true,
};
const plan = { id: planId, name: 'Website institucional', price_cents: 300001, scope: 'Cinco páginas e duas revisões.' };
const settle = () => new Promise((resolve) => setImmediate(resolve));

function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, predicate));
  if (node.type === fields.HoldingCommercialSelect) return nodes(node.type(node.props), predicate);
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function text(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' ? text(node.props?.children) : '';
}

function harness(path, request, confirm = true) {
  const states = [], refs = [], effects = [], callbacks = [], pending = [], calls = [], confirmations = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0;
  const changed = (a, b) => !a || a.some((value, i) => value !== b[i]);
  const hooks = {
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = initial;
      return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
    },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useCallback(callback, deps) {
      const i = callbackIndex++;
      if (!callbacks[i] || changed(callbacks[i].deps, deps)) callbacks[i] = { callback, deps };
      return callbacks[i].callback;
    },
    useEffect(callback, deps) {
      const i = effectIndex++;
      if (changed(effects[i]?.deps, deps)) pending.push(() => {
        effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: callback() };
      });
    },
  };
  const page = load(path, {
    react: hooks,
    'next/link': { default: 'a', __esModule: true },
    '@/lib/holding-customers': customers,
    '@/lib/website-contracts': terms,
    '@/lib/website-plans': catalog,
    '@/components/HoldingCommercialFields': fields,
    '@/lib/holding-auth-fetch': { holdingAuthFetch: async (url, init = {}) => {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      return request(url, method, body);
    } },
  }, { window: { confirm: (message) => { confirmations.push(message); return confirm; } } });
  const render = () => {
    stateIndex = 0; refIndex = 0; effectIndex = 0; callbackIndex = 0;
    const tree = page.default();
    while (pending.length) pending.shift()();
    return tree;
  };
  const field = (label) => {
    const container = nodes(render(), (node) => node.type === 'label' && text(node).includes(label))[0];
    return nodes(container, (node) => ['input', 'textarea', 'select'].includes(node.type))[0]
      || nodes(render(), (node) => node.props?.id === container?.props.htmlFor)[0];
  };
  const button = (label) => nodes(render(), (node) => node.type === 'button' && text(node).includes(label))[0];
  return {
    render, calls, field, button, confirmations,
    unmount: () => { for (const effect of effects) effect?.cleanup?.(); },
    fill: (label, value) => field(label).props.onChange({ target: { value, checked: value } }),
    submit: () => nodes(render(), (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }),
    async mount() { render(); await settle(); return render(); },
  };
}
const contractResponse = () => Response.json({ contracts: [] });
test('contract guidance is collapsed by default and remains available on demand', async () => {
  const ui = harness('src/app/assinaturas/websites/page.tsx', (url) => url.endsWith('/options') ? optionsResponse() : contractResponse());
  await ui.mount();
  const guidance = nodes(ui.render(), (node) => node.type === 'details'
    && text(node).includes('Orientações de contratação e cobrança'))[0];
  assert.ok(guidance);
  assert.ok(!guidance.props.open);
  assert.match(text(guidance), /Gere no Asaas somente quando desejar cobrar/);
  assert.match(text(guidance), /empréstimos, aportes e transferências não geram nota/);
});
const optionsResponse = () => Response.json({ customers: [customer], plans: [plan] });
async function contractForm(request = (url) => url.endsWith('/options') ? optionsResponse() : contractResponse()) {
  const ui = harness('src/app/assinaturas/websites/page.tsx', request);
  await ui.mount(); ui.button('Nova contratação').props.onClick();
  return ui;
}

test('customer UI creates and edits a Holding-only customer with immutable document and consistent field heights', async () => {
  const ui = harness('src/app/clientes/page.tsx', (_url, method, body) => method === 'GET'
    ? Response.json({ customers: [] }) : Response.json({ customer: { id: customerId, ...body } }));
  await ui.mount();
  ui.button('Novo cliente').props.onClick();
  ui.fill('Nome / razão social', customer.name); ui.fill('CPF / CNPJ', customer.document); ui.fill('E-mail', customer.email);
  for (const field of nodes(ui.render(), (node) => node.type === 'input' && node.props.type !== 'checkbox')) {
    assert.ok(field.props.className.split(' ').includes('h-11'));
  }
  await ui.submit();
  assert.equal(ui.calls.at(-1).method, 'POST');
  assert.equal(ui.calls.at(-1).url, '/api/admin/holding-customers');
  assert.match(text(ui.render()), /Nenhum cadastro foi criado no Glass ou no Barber/);
  ui.button('Editar').props.onClick();
  assert.equal(ui.field('CPF / CNPJ').props.readOnly, true);
  ui.fill('Cliente ativo', false);
  await ui.submit();
  assert.equal(ui.calls.at(-1).body.active, false);
  assert.match(text(ui.render()), /Inativo/);
});

test('customer UI masks fields, locally validates CPF without a third-party lookup and fills corporate/address data only on explicit action', async () => {
  const ui = harness('src/app/clientes/page.tsx', (url, method, body) => method === 'GET'
    ? Response.json({ customers: [] }) : Response.json({ fields: body.kind === 'cnpj'
      ? { name: 'Empresa ficticia', postal_code: '01001000', address: 'Rua ficticia', address_number: '10', city: 'Sao Paulo', state: 'SP' }
      : { postal_code: '01001000', address: 'Praca ficticia', district: 'Centro', city: 'Sao Paulo', state: 'SP' }, source: 'Test' }));
  await ui.mount(); ui.button('Novo cliente').props.onClick();
  ui.fill('CPF / CNPJ', '52998224725');
  assert.equal(ui.field('CPF / CNPJ').props.value, '529.982.247-25');
  ui.button('Consultar CPF').props.onClick(); await settle();
  assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 0);
  assert.match(text(ui.render()), /Nenhum CPF foi enviado a terceiros/);
  ui.fill('CPF / CNPJ', '11222333000181'); ui.button('Consultar CPF').props.onClick(); await settle();
  assert.equal(ui.field('Nome / razão social').props.value, 'Empresa ficticia');
  assert.equal(ui.field('CEP').props.value, '01001-000');
  ui.fill('Número', '25'); ui.fill('Complemento', 'Sala 1');
  ui.button('Consultar CEP').props.onClick(); await settle();
  assert.equal(ui.field('Endereço').props.value, 'Praca ficticia');
  assert.equal(ui.field('Número').props.value, '25'); assert.equal(ui.field('Complemento').props.value, 'Sala 1');
  ui.fill('Telefone', '11999999999'); assert.equal(ui.field('Telefone').props.value, '(11) 99999-9999');
  assert.equal(ui.field('E-mail').props.type, 'email');
  assert.equal(ui.field('Telefone').props.type, 'tel');
});

test('customer UI reopens an existing CPF and deletion requires confirmation, preserves contracted customers and reports errors', async () => {
  const ui = harness('src/app/clientes/page.tsx', (_url, method) => method === 'DELETE'
    ? Response.json({ error: 'Cliente possui contratação.' }, { status: 409 }) : Response.json({ customers: [customer] }));
  await ui.mount(); ui.button('Novo cliente').props.onClick(); ui.fill('CPF / CNPJ', customer.document);
  ui.button('Consultar CPF').props.onClick(); await settle();
  assert.equal(ui.field('Nome / razão social').props.value, customer.name);
  assert.equal(ui.field('CPF / CNPJ').props.readOnly, true);
  ui.button('Cancelar').props.onClick();
  ui.button('Excluir').props.onClick(); await settle();
  assert.match(text(ui.render()), /Cliente possui contratação/);
  assert.match(text(ui.render()), /Cliente fictício/);
  for (const confirm of [true, false]) {
    const h = harness('src/app/clientes/page.tsx', (_url, method) => method === 'DELETE'
      ? Response.json({ deleted: true }) : Response.json({ customers: [customer] }), confirm);
    await h.mount(); h.button('Excluir').props.onClick(); await settle();
    assert.equal(h.calls.filter((call) => call.method === 'DELETE').length, confirm ? 1 : 0);
    assert.match(h.confirmations[0], /nenhum projeto ou assinatura/);
    if (confirm) assert.match(text(h.render()), /Cliente excluído somente da Holding/);
  }
});

test('customer lookup keeps manual data on cancellation or failure, disables edits while pending and ignores responses after unmount', async () => {
  for (const confirm of [true, false]) {
    const ui = harness('src/app/clientes/page.tsx', (_url, method) => method === 'GET'
      ? Response.json({ customers: [] }) : Response.json({ error: 'Servico indisponivel.' }, { status: 502 }), confirm);
    await ui.mount(); ui.button('Novo cliente').props.onClick();
    ui.fill('CPF / CNPJ', '11222333000181'); ui.fill('Nome / razão social', 'Nome manual');
    ui.fill('Endereço', 'Endereco manual'); ui.button('Consultar CPF').props.onClick(); await settle();
    assert.equal(ui.calls.filter((call) => call.method === 'POST').length, confirm ? 1 : 0);
    assert.equal(ui.field('Nome / razão social').props.value, 'Nome manual');
    assert.equal(ui.field('Endereço').props.value, 'Endereco manual');
    if (confirm) assert.match(text(ui.render()), /Servico indisponivel/);
  }
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const ui = harness('src/app/clientes/page.tsx', (_url, method) => method === 'GET'
    ? Response.json({ customers: [] }) : pending);
  await ui.mount(); ui.button('Novo cliente').props.onClick(); ui.fill('CPF / CNPJ', '11222333000181');
  ui.fill('Nome / razão social', 'Manual');
  ui.button('Consultar CPF').props.onClick(); await settle();
  assert.equal(nodes(ui.render(), (node) => node.type === 'fieldset')[0].props.disabled, true);
  await ui.submit();
  assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 1);
  ui.unmount();
  resolve(Response.json({ fields: { name: 'Stale company' }, source: 'Test' })); await settle();
  assert.equal(ui.field('Nome / razão social').props.value, 'Manual');
});

test('contract UI prefills product price, previews entry and cents, and saves without any provider call', async () => {
  const ui = await contractForm((url, method) => {
    if (method === 'POST') return Response.json({ id: contractId });
    return url.endsWith('/options') ? optionsResponse() : contractResponse();
  });
  ui.fill('Cliente', customerId); ui.fill('Produto', planId);
  assert.equal(ui.field('Preço total').props.value, '3000.01');
  ui.fill('Entrada opcional', '500');
  ui.fill('Vencimento da entrada', '2027-01-15');
  ui.fill('Primeiro vencimento', '2027-01-31');
  ui.fill('Parcelas do saldo', '3');
  ui.fill('Forma de pagamento', 'CREDIT_CARD');
  assert.match(text(ui.render()), /Prévia das parcelas/);
  assert.match(text(ui.render()), /28\/02\/2027/);
  assert.match(text(ui.render()), /31\/03\/2027/);
  for (const field of nodes(ui.render(), (node) => ['input', 'select'].includes(node.type))) {
    assert.ok(field.props.className.split(' ').includes('h-11'));
  }
  await ui.submit();
  const post = ui.calls.find((call) => call.method === 'POST');
  assert.equal(post.url, '/api/admin/website-contracts');
  assert.equal(post.body.total_cents, 300001);
  assert.equal(post.body.deposit_cents, 50000);
  assert.equal(post.body.count, 3);
  assert.ok(customers.isUuid(post.body.request_id));
  assert.equal(post.body.payment_method, 'CREDIT_CARD');
  assert.equal(ui.calls.some((call) => call.url.includes('/billing')), false);
  assert.match(text(ui.render()), /salvas somente na Holding/);
});

test('failed and duplicate submissions retain a stable request ID and do not silently clear the contract', async () => {
  let finish;
  const ui = await contractForm((url, method) => {
    if (method === 'POST') return new Promise((resolve) => { finish = () => resolve(Response.json({ error: 'Falha controlada' }, { status: 500 })); });
    return url.endsWith('/options') ? optionsResponse() : contractResponse();
  });
  ui.fill('Cliente', customerId); ui.fill('Produto', planId); ui.fill('Primeiro vencimento', '2027-01-31');
  const first = ui.submit(); const second = ui.submit();
  assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 1);
  finish(); await Promise.all([first, second]);
  const token = ui.calls.find((call) => call.method === 'POST').body.request_id;
  assert.match(text(ui.render()), /Falha controlada/);
  assert.equal(ui.field('Preço total').props.value, '3000.01');
  const retry = ui.submit(); finish(); await retry;
  assert.equal(ui.calls.filter((call) => call.method === 'POST')[1].body.request_id, token);
});

test('provider generation requires explicit confirmation and consult uses only the sync action', async () => {
  const local = {
    id: contractId, customer_snapshot: customer, plan_snapshot: plan, total_cents: 300001,
    payment_method: 'CREDIT_CARD', billing_state: 'local', holding_website_installments: [], asaas_environment: null,
  };
  for (const confirm of [false, true]) {
    const ui = harness('src/app/assinaturas/websites/page.tsx', (url, method) => {
      if (method === 'POST') return Response.json({ message: 'Cobranças conciliadas' });
      return url.endsWith('/options') ? optionsResponse() : Response.json({ contracts: [local] });
    }, confirm);
    await ui.mount();
    ui.button('Gerar no Asaas').props.onClick();
    await settle();
    assert.equal(ui.confirmations.length, 1);
    assert.match(ui.confirmations[0], /cobranças reais/);
    assert.equal(ui.calls.filter((call) => call.method === 'POST').length, confirm ? 1 : 0);
    if (confirm) assert.deepEqual(ui.calls.find((call) => call.method === 'POST').body, { id: contractId, action: 'generate' });
  }
  const ui = harness('src/app/assinaturas/websites/page.tsx', (url, method) => method === 'POST'
    ? Response.json({ message: 'Consultado' }) : url.endsWith('/options') ? optionsResponse()
      : Response.json({ contracts: [{ ...local, billing_state: 'review', asaas_environment: 'sandbox' }] }));
  await ui.mount();
  ui.button('Consultar Asaas').props.onClick(); await settle();
  assert.deepEqual(ui.calls.find((call) => call.method === 'POST').body, { id: contractId, action: 'sync' });
  assert.equal(ui.confirmations.length, 0);
});

test('manual invoice UI validates a preview before production confirmation and never triggers billing', async () => {
  for (const confirm of [true, false]) {
    const local = {
      id: contractId, customer_snapshot: customer, plan_snapshot: plan, total_cents: 300001,
      payment_method: 'PIX', billing_state: 'local', holding_website_installments: [], holding_website_invoices: [],
    };
    const ui = harness('src/app/assinaturas/websites/page.tsx', (url, method, body) => {
      if (method === 'POST') {
        assert.ok(url.endsWith('/invoice'));
        return Response.json(body.confirmed ? { sent: true, message: 'Nota teste emitida' } : {
          sent: false, preview: {
            customer: customer.name, total_cents: 300001, national_code: '010101',
            municipal_code: '', nbs: '123456789', description: 'Site ficticio', simples_percent: 6,
          },
        });

        test('recurring subscription UI picks cycle price, permits a client override and saves without billing or editing the catalog', async () => {
          const recurring = { ...plan, billing_cycle: 'monthly', recurring_prices: { monthly: 10000, quarterly: 28000, semiannual: 53000, annual: 99000 } };
          const ui = harness('src/app/assinaturas/websites/recorrentes/page.tsx', (_url, method) => method === 'POST'
            ? Response.json({ id: contractId }) : Response.json({ subscriptions: [], customers: [customer], plans: [recurring] }));
          await ui.mount(); ui.button('Nova assinatura').props.onClick();
          ui.fill('Cliente', customerId); ui.fill('Produto', planId);
          assert.equal(ui.field('Valor personalizado').props.value, '100.00');
          ui.fill('Ciclo', 'quarterly');
          assert.equal(ui.field('Valor personalizado').props.value, '280.00');
          ui.fill('Valor personalizado', '255.50');
          ui.fill('Primeiro vencimento', '2026-11-20');
          ui.fill('Confirmo o enquadramento', true);
          for (const field of nodes(ui.render(), (node) => ['input', 'select'].includes(node.type) && node.props.type !== 'checkbox')) {
            assert.match(field.props.className, /h-11/);
          }
          await ui.submit();
          const post = ui.calls.find((call) => call.method === 'POST');
          assert.equal(post.url, '/api/admin/website-subscriptions');
          assert.equal(post.body.billing_cycle, 'quarterly'); assert.equal(post.body.amount_cents, 25550);
          assert.equal(post.body.fiscal_confirmed, true);
          assert.equal(recurring.recurring_prices.quarterly, 28000);
          assert.equal(ui.calls.some((call) => /billing|website-plans/.test(call.url)), false);
          assert.match(text(ui.render()), /salva sem cobrar/);
        });
      }
      return url.endsWith('/options') ? optionsResponse() : Response.json({ contracts: [local] });
    }, confirm);
    await ui.mount(); ui.button('Emitir NFS-e').props.onClick();
    ui.fill('Competência', '2026-11-04');
    await ui.submit();
    await settle();
    assert.equal(ui.calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(ui.calls.find((call) => call.method === 'POST').body.confirmed, false);
    assert.match(text(ui.render()), /próxima confirmação/);
    await ui.submit();
    await settle();
    assert.equal(ui.calls.filter((call) => call.method === 'POST').length, confirm ? 2 : 1);
    assert.match(ui.confirmations[0], /independe do pagamento/);
    assert.equal(ui.calls.some((call) => call.url.includes('/billing')), false);
    if (confirm) assert.match(text(ui.render()), /Nota teste emitida/);
  }
});

test('rendered form fixtures retain actual React markup for visual verification', {
  skip: !process.env.WEBSITE_UI_FIXTURE_DIR,
}, async () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const { compile } = await import('@tailwindcss/node');
  const compiler = await compile('@import "tailwindcss";', { base: process.cwd(), onDependency() {} });
  const clients = harness('src/app/clientes/page.tsx', () => Response.json({ customers: [] }));
  await clients.mount(); clients.button('Novo cliente').props.onClick();
  const contracts = await contractForm();
  contracts.fill('Produto', planId);
  const recurring = harness('src/app/assinaturas/websites/recorrentes/page.tsx', () => Response.json({
    subscriptions: [], customers: [customer], plans: [{ ...plan, billing_cycle: 'monthly',
      recurring_prices: { monthly: 10000, quarterly: 28000, semiannual: 53000, annual: 99000 } }],
  }));
  await recurring.mount(); recurring.button('Nova assinatura').props.onClick(); recurring.fill('Produto', planId);
  for (const [name, tree] of [['customers', clients.render()], ['contracts', contracts.render()], ['recurring', recurring.render()]]) {
    const markup = renderToStaticMarkup(tree);
    const candidates = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(' '));
    const css = compiler.build(candidates);
    writeFileSync(join(process.env.WEBSITE_UI_FIXTURE_DIR, `website-${name}-fixture.html`),
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="bg-slate-50"><main style="padding:24px">${markup}</main></body></html>`);
  }
});
