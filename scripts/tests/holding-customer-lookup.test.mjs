import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const customers = load('src/lib/holding-customers.ts');
function harness({ denied = false, response = () => Response.json({}), failure = false } = {}) {
  const calls = [];
  const route = load('src/app/api/admin/holding-customers/lookup/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/holding-commercial-auth': { authorizeHoldingCommercial: async (_req, resources) => {
      assert.deepEqual(resources, ['menu.clientes']);
      return denied ? Response.json({ error: 'Forbidden' }, { status: 403 }) : null;
    } },
    '@/lib/holding-customers': customers,
  }, { fetch: async (url, init) => { calls.push({ url, init }); if (failure) throw new Error('test timeout'); return response(); } });
  return { calls, post: (body) => route.POST(new Request('https://holding.test/api', { method: 'POST', body: JSON.stringify(body) })) };
}
test('CPF/CNPJ, Brazilian phones and CEP masks preserve all digits, including incremental typing', () => {
  assert.equal(customers.maskCustomerDocument('52998224725'), '529.982.247-25');
  assert.equal(customers.maskCustomerDocument('11222333000181'), '11.222.333/0001-81');
  assert.equal(customers.maskCustomerPhone('11999999999'), '(11) 99999-9999');
  assert.equal(customers.maskCustomerPhone('1133334444'), '(11) 3333-4444');
  assert.equal(customers.maskCustomerPhone('+55 (11) 99999-9999'), '+55 (11) 99999-9999');
  assert.equal(customers.maskCustomerCep('01001000'), '01001-000');
  for (const [digits, mask] of [['11222333000181', customers.maskCustomerDocument], ['11999999999', customers.maskCustomerPhone], ['01001000', customers.maskCustomerCep]]) {
    for (let i = 0; i <= digits.length; i++) {
      const partial = digits.slice(0, i);
      assert.equal(mask(partial).replace(/\D/g, ''), partial);
      assert.equal(mask(mask(partial)), mask(partial));
    }
  }
});
test('lookup authenticates before calling services, rejects CPF and invalid CNPJ/CEP and never accepts arbitrary URLs', async () => {
  const denied = harness({ denied: true });
  assert.equal((await denied.post({ kind: 'cnpj', value: '11222333000181' })).status, 403);
  assert.equal(denied.calls.length, 0);
  const h = harness();
  for (const body of [null, {}, { kind: 'cpf', value: '52998224725' }, { kind: 'cnpj', value: '52998224725' },
    { kind: 'cnpj', value: '11222333000182' }, { kind: 'cep', value: '1' }, { kind: 'cep', value: 'https://evil.test' }]) {
    assert.equal((await h.post(body)).status, 400);
  }
  assert.equal(h.calls.length, 0);
});
test('CNPJ lookup validates returned identifier and whitelists corporate fields without sending personal CPF', async () => {
  const h = harness({ response: () => Response.json({
    cnpj: '11222333000181', razao_social: 'Empresa ficticia', cep: '01001000',
    descricao_tipo_de_logradouro: 'RUA', logradouro: 'Teste', numero: '10', municipio: 'SAO PAULO', uf: 'SP',
    qsa: [{ nome_socio: 'must not expose' }],
  }) });
  const response = await h.post({ kind: 'cnpj', value: '11.222.333/0001-81' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.fields.name, 'Empresa ficticia'); assert.equal(data.fields.address, 'RUA Teste');
  assert.equal(data.fields.qsa, undefined);
  assert.equal(h.calls[0].url, 'https://brasilapi.com.br/api/cnpj/v1/11222333000181');
  assert.equal(h.calls[0].init.redirect, 'error');
  assert.match(response.headers.get('cache-control'), /no-store/);
  const wrong = harness({ response: () => Response.json({ cnpj: 'other', razao_social: 'Wrong' }) });
  assert.equal((await wrong.post({ kind: 'cnpj', value: '11222333000181' })).status, 502);
});
test('CEP lookup returns address fields but never replaces building number/complement and handles not found/timeout explicitly', async () => {
  const h = harness({ response: () => Response.json({ cep: '01001-000', logradouro: 'Praca ficticia', bairro: 'Centro', localidade: 'Sao Paulo', uf: 'SP', complemento: 'ignored' }) });
  const response = await h.post({ kind: 'cep', value: '01001-000' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).fields, { postal_code: '01001000', address: 'Praca ficticia', district: 'Centro', city: 'Sao Paulo', state: 'SP' });
  assert.equal(h.calls[0].url, 'https://viacep.com.br/ws/01001000/json/');
  for (const options of [{ response: () => Response.json({ erro: true }) }, { response: () => Response.json({}, { status: 404 }) }]) {
    assert.equal((await harness(options).post({ kind: 'cep', value: '01001000' })).status, 404);
  }
  for (const options of [{ failure: true }, { response: () => Response.json({}, { status: 429 }) }, { response: () => Response.json({ cep: 'wrong' }) }]) {
    assert.equal((await harness(options).post({ kind: 'cep', value: '01001000' })).status, 502);
  }
});

test('lookup response reader validates JSON and whitelists fields without relying on browser Response.json errors', async () => {
  const response = Response.json({ fields: { name: 'Empresa ficticia', active: true, document: 'ignored' }, source: 'BrasilAPI' });
  response.json = async () => { throw new SyntaxError('The string did not match the expected pattern.'); };
  assert.deepEqual(await customers.readHoldingCustomerLookup(response), { fields: { name: 'Empresa ficticia' }, source: 'BrasilAPI' });
  for (const payload of [null, [], {}, { fields: {}, source: 'Test' }, { fields: { name: 123 }, source: 'Test' }, { fields: [], source: 'Test' }]) {
    await assert.rejects(customers.readHoldingCustomerLookup(Response.json(payload)), /inválid|Nenhum dado|não retornou dados cadastrais válidos/);
  }
});

test('lookup response reader gives actionable Portuguese errors for expired sessions, blocked requests, HTML, redirects and malformed JSON', async () => {
  for (const [status, message] of [[401, /sessão expirou/], [403, /bloqueada/], [429, /Muitas consultas/]]) {
    await assert.rejects(customers.readHoldingCustomerLookup(new Response('<html>error</html>', { status })), message);
  }
  for (const status of [200, 404, 502]) {
    await assert.rejects(customers.readHoldingCustomerLookup(new Response('<!doctype html>', {
      status, headers: { 'Content-Type': 'text/html' },
    })), /servidor não retornou os dados/);
  }
  for (const body of ['', '{"fields":']) {
    await assert.rejects(customers.readHoldingCustomerLookup(new Response(body, {
      headers: { 'Content-Type': 'application/json' },
    })), /resposta incompleta ou inválida/);
  }
  const redirected = Response.json({ fields: { name: 'Wrong' }, source: 'Test' });
  Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(customers.readHoldingCustomerLookup(redirected), /servidor não retornou os dados/);
  await assert.rejects(customers.readHoldingCustomerLookup(Response.json({ error: 'Cadastro não encontrado.' }, { status: 404 })), /Cadastro não encontrado/);
  await assert.rejects(customers.readHoldingCustomerLookup(Response.json({}, { status: 502 })), /Não foi possível consultar/);
});
