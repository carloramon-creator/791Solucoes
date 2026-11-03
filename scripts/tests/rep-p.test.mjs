import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, verify, X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import forge from 'node-forge';
import { PDFDocument, PDFPage } from 'pdf-lib';
const external = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => mocks[name] ?? external(name), mod, mod.exports);
  return mod.exports;
}
const receipt = load('src/lib/ponto/receipt.ts');
const id = '00000000-0000-4000-8000-000000000300';
const base = '0000000017' + '2026-11-03T10:00:00-0300' + '012345678909' + '2026-11-03T10:00:00-0300' + '020';
const raw = { operacao_oficial: false, id, vidracaria_id: '00000000-0000-4000-8000-000000000001',
  estabelecimento_id: '00000000-0000-4000-8000-000000000200', nsr: 1, cpf: '12345678909', nome: 'Funcionário de teste',
  empregador: { nome: 'Empregador de teste', documento: '11222333000181', endereco: 'Rua de teste', cadastro_obras: '123456789012' },
  marcada_em: '2026-11-03T13:00:00Z', gravada_em: '2026-11-03T13:00:00Z', fuso: 'America/Sao_Paulo',
  hash_anterior: '', linha_base_afd: base, hash: createHash('sha256').update(base).digest('hex') };
const pair = forge.pki.rsa.generateKeyPair(2048);
function config(options = {}) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = options.serial || '01';
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(options.expired ? Date.now() - 1000 : Date.now() + 86400000);
  cert.setSubject([{ name: 'commonName', value: `TESTE SOMENTE:${options.cnpj || '11222333000181'}` }]);
  cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: options.digitalSignature !== false }]);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  const bundle = forge.pkcs12.toPkcs12Asn1(pair.privateKey, [cert], 'synthetic-only', { algorithm: '3des' });
  return { pfxBase64: forge.util.encode64(forge.asn1.toDer(bundle).getBytes()), passphrase: 'synthetic-only', prestador_cnpj: '11222333000181' };
}
const firstConfig = config();
test('snapshot rejects fabricated, corrupted, cross-ID and incomplete originals without changing input', () => {
  const copy = structuredClone(raw);
  assert.equal(receipt.validarSnapshot(raw, id).empregador.cadastro_obras, '123456789012');
  for (const changed of [
    { operacao_oficial: true }, { id: 'outro' }, { nsr: 0 }, { cpf: '123' }, { hash: '0'.repeat(64) },
    { linha_base_afd: raw.linha_base_afd.slice(1) }, { fuso: 'Invalid/Zone' }, { marcada_em: 'now' },
    { nome: 'Nome\nInjetado' }, { empregador: {} }, { hash_anterior: 'invalid' },
    { marcada_em: '2026-11-03T14:00:00Z' }, { gravada_em: '2026-11-03T14:00:00Z' },
  ]) assert.throws(() => receipt.validarSnapshot({ ...raw, ...changed }, id));
  assert.deepEqual(raw, copy);
});
test('holding A1 validates password, validity, key correspondence, identity and usage; never returns private material', () => {
  const good = receipt.carregarAssinante(firstConfig);
  assert.equal(good.titular, firstConfig.prestador_cnpj);
  for (const bad of [null, {}, { ...firstConfig, passphrase: 'wrong' }, config({ expired: true }),
    config({ cnpj: '99999999000191' }), config({ digitalSignature: false }), { ...firstConfig, pfxBase64: 'invalid' }]) {
    assert.throws(() => receipt.carregarAssinante(bad));
  }
  assert.equal(Object.hasOwn(good, 'pfxBase64'), false);
  assert.equal(Object.hasOwn(good, 'passphrase'), false);
});
test('homologation PDF has ETSI subfilter, complete ByteRange, bound certificate and independently valid CMS signature', async () => {
  const originalDraw = PDFPage.prototype.drawText;
  const drawn = [];
  PDFPage.prototype.drawText = function(text, options) { drawn.push(text); return originalDraw.call(this, text, options); };
  let result;
  try { result = await receipt.gerarComprovanteHomologacao(receipt.validarSnapshot(raw, id), 'BR512026000001-0', firstConfig); }
  finally { PDFPage.prototype.drawText = originalDraw; }
  const rendered = drawn.join('\n');
  for (const required of ['Comprovante de Registro de Ponto do Trabalhador', '000000001', raw.nome, raw.cpf,
    raw.empregador.nome, raw.empregador.documento, raw.empregador.endereco, '123456789012', 'BR512026000001-0', raw.hash,
    '03/11/2026', '10:00:00', 'HOMOLOGAÇÃO - SEM VALIDADE COMO PONTO OFICIAL']) assert.ok(rendered.includes(required), required);
  assert.equal(result.operacao_oficial, false);
  const doc = await PDFDocument.load(result.pdf);
  assert.match(doc.getTitle(), /HOMOLOGAÇÃO/);
  assert.equal(doc.getPages().length, 1);
  const bytes = result.pdf.toString('latin1');
  assert.match(bytes, /\/SubFilter \/ETSI.CAdES.detached/);
  const range = bytes.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/).slice(1).map(Number);
  assert.equal(range[0], 0);
  assert.equal(range[2] + range[3], result.pdf.length);
  const content = Buffer.concat([result.pdf.subarray(0, range[1]), result.pdf.subarray(range[2], range[2] + range[3])]);
  const hex = bytes.slice(range[1] + 1, range[2] - 1);
  const cms = forge.asn1.fromDer(forge.util.hexToBytes(hex), { strict: false, parseAllBytes: false });
  const signedData = cms.value[1].value[0];
  const signerInfo = signedData.value.at(-1).value[0];
  const attrs = signerInfo.value[3].value;
  const getAttr = oid => attrs.find(attr => forge.asn1.derToOid(attr.value[0].value) === oid).value[1].value[0];
  assert.equal(Buffer.from(getAttr('1.2.840.113549.1.9.4').value, 'latin1').toString('hex'), createHash('sha256').update(content).digest('hex'));
  const certAsn = signedData.value[3].value[0];
  const certBytes = Buffer.from(forge.asn1.toDer(certAsn).getBytes(), 'latin1');
  const certHash = getAttr('1.2.840.113549.1.9.16.2.47').value[0].value[0].value[0].value;
  assert.equal(Buffer.from(certHash, 'latin1').toString('hex'), createHash('sha256').update(certBytes).digest('hex'));
  const signedAttrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
  const signature = Buffer.from(signerInfo.value.at(-1).value, 'latin1');
  const certificate = new X509Certificate(certBytes);
  assert.equal(verify('sha256', Buffer.from(forge.asn1.toDer(signedAttrs).getBytes(), 'latin1'), certificate.publicKey, signature), true);
  const directory = mkdtempSync(join(tmpdir(), '791-repp-signature-'));
  try {
    writeFileSync(join(directory, 'content.bin'), content);
    writeFileSync(join(directory, 'signature.der'), Buffer.from(forge.asn1.toDer(cms).getBytes(), 'latin1'));
    const openssl = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(directory, 'signature.der'),
      '-content', join(directory, 'content.bin'), '-noverify', '-out', '/dev/null'], { encoding: 'utf8' });
    assert.equal(openssl.status, 0, openssl.stderr);
    const damaged = Buffer.from(content); damaged[20] ^= 1;
    writeFileSync(join(directory, 'content.bin'), damaged);
    const invalid = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(directory, 'signature.der'),
      '-content', join(directory, 'content.bin'), '-noverify', '-out', '/dev/null'], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
  } finally { unlinkSync(join(directory, 'content.bin')); unlinkSync(join(directory, 'signature.der')); rmdirSync(directory); }
});
test('a replaced holding certificate is read for new PDFs; old signed bytes remain unchanged', async () => {
  const snapshot = receipt.validarSnapshot(raw, id);
  const first = await receipt.gerarComprovanteHomologacao(snapshot, 'BR512026000001-0', firstConfig);
  const digest = createHash('sha256').update(first.pdf).digest('hex');
  const replacement = await receipt.gerarComprovanteHomologacao(snapshot, 'BR512026000001-0', config({ serial: '02' }));
  assert.notEqual(replacement.fingerprint, first.fingerprint);
  assert.equal(createHash('sha256').update(first.pdf).digest('hex'), digest);
  for (const invalid of ['', '12345678901234567', '5120260000010', 'BR512026000001', 'BR512026000001-0\n']) {
    await assert.rejects(receipt.gerarComprovanteHomologacao(snapshot, invalid, firstConfig), /INPI/);
  }
});

function routeHarness({ enabled = true, snapshotError = null, cached = null, failSave = false, duplicate = false } = {}) {
  let settingsReads = 0, signatures = 0, writes = 0;
  const requester = { auth: { getUser: async () => ({ data: { user: { id: 'worker' } }, error: null }) },
    rpc: async () => ({ data: raw, error: snapshotError }) };
  const stored = { pdf_base64: Buffer.from('%PDF-synthetic').toString('base64'), tenant_id: raw.vidracaria_id, usuario_id: 'worker', marcacao_hash: raw.hash };
  const supabase = { from(table) {
    if (table === 'system_settings') { settingsReads++; return { select: () => ({ eq: () => ({ single: async () => ({ data: { value: firstConfig } }) }) }) }; }
    return { select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: cached ? { ...stored, ...cached } : null, error: null }),
      single: async () => ({ data: stored, error: null }),
    }) }),
      insert: async () => { writes++; return { error: failSave ? { code: 'XX' } : duplicate ? { code: '23505' } : null }; } };
  } };
  const route = load('src/app/api/rep-p/homologacao/[id]/route.ts', {
    '@/lib/glass-client': { getGlassClient: async auth => { assert.equal(auth, 'Bearer worker-token'); return requester; } },
    '@/lib/supabase-server': { supabaseServer: supabase },
    '@/lib/ponto/receipt': { validarSnapshot: receipt.validarSnapshot, gerarComprovanteHomologacao: async () => {
      signatures++; return { pdf: Buffer.from('%PDF-synthetic'), fingerprint: 'test', validade: new Date().toISOString() };
    } },
  });
  return { async call(token = 'Bearer worker-token') {
    const previous = process.env.REP_P_HOMOLOGACAO_ENABLED;
    process.env.REP_P_HOMOLOGACAO_ENABLED = String(enabled);
    try { return await route.GET(new Request('https://holding.example/api/rep-p', { headers: { authorization: token } }), { params: Promise.resolve({ id }) }); }
    finally { if (previous === undefined) delete process.env.REP_P_HOMOLOGACAO_ENABLED; else process.env.REP_P_HOMOLOGACAO_ENABLED = previous; }
  }, counts: () => ({ settingsReads, signatures, writes }) };
}
test('holding route defaults blocked and denies missing token / another worker before reading any A1', async () => {
  for (const [options, token, status] of [[{ enabled: false }, 'Bearer worker-token', 503],
    [{}, '', 401], [{ snapshotError: { code: '42501' } }, 'Bearer worker-token', 403]]) {
    const route = routeHarness(options);
    assert.equal((await route.call(token)).status, status);
    assert.deepEqual(route.counts(), { settingsReads: 0, signatures: 0, writes: 0 });
  }
});
test('cached receipt is reused without loading the renewed A1 and failures never return an unsigned success', async () => {
  const cached = routeHarness({ cached: {} });
  const response = await cached.call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-rep-p-ambiente'), 'homologacao');
  assert.deepEqual(cached.counts(), { settingsReads: 0, signatures: 0, writes: 0 });
  const crossTenant = routeHarness({ cached: { tenant_id: 'other' } });
  assert.equal((await crossTenant.call()).status, 503);
  const failed = routeHarness({ failSave: true });
  assert.equal((await failed.call()).status, 503);
  assert.deepEqual(failed.counts(), { settingsReads: 1, signatures: 1, writes: 1 });
  const valid = routeHarness();
  assert.equal((await valid.call()).status, 200);
  assert.deepEqual(valid.counts(), { settingsReads: 1, signatures: 1, writes: 1 });
  const duplicate = routeHarness({ duplicate: true });
  assert.equal(await (await duplicate.call()).text(), '%PDF-synthetic');
  assert.deepEqual(duplicate.counts(), { settingsReads: 1, signatures: 1, writes: 1 });
});
test('Glass client preserves legacy server calls but forces the worker JWT for receipt RPCs', async () => {
  const calls = [];
  const module = load('src/lib/glass-client.ts', {
    '@supabase/supabase-js': { createClient: (...args) => { calls.push(args); return {}; } },
    './supabase-server': { supabaseServer: { from: () => ({ select: () => ({ eq: () => ({
      single: async () => ({ data: { value: { glassUrl: 'https://glass.example', glassServiceKey: 'synthetic-only' } }, error: null }),
    }) }) }) } },
  });
  await module.getGlassClient();
  await module.getGlassClient('Bearer worker-token');
  assert.equal(calls[0][2].global, undefined);
  assert.equal(calls[1][2].global.headers.Authorization, 'Bearer worker-token');
  await assert.rejects(module.getGlassClient('invalid'), /inválida/);
  assert.equal(calls.length, 2);
});
