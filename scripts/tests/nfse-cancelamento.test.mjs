import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', source)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const local = resolve(dirname(path), `${name}.ts`);
    if (name.startsWith('.') && existsSync(local)) return load(local, mocks);
    if (name.startsWith('@/')) {
      const alias = resolve('src', `${name.slice(2)}.ts`);
      if (existsSync(alias)) return load(alias, mocks);
    }
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

const CHAVE = '42166022211222333000181000000000001226104100000001';
const CNPJ = '11222333000181';
const regras = load('src/services/nfse/cancelamento.ts');
const xmlService = load('src/services/nfse/xml-service.ts').default;
const pedido = {
  chaveAcesso: CHAVE, cnpjAutor: CNPJ, ambiente: 2, dataEvento: '2026-10-21T15:00:00+00:00',
  motivo: 9, justificativa: 'Cancelamento da assinatura & estorno <aprovado>',
};
const assinaturaFalsa = { __esModule: true, default: {
  extractFromPfx: () => ({ privateKey: 'fake', certificate: 'fake' }), signXML: xml => xml,
} };
const eventoOk = (chave = CHAVE) => `<evento versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento Id="EVT${chave}101101001"><verAplic>SefinNacional_1.6.0</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-10-21T15:00:05-03:00</dhProc><nDFe>0</nDFe><pedRegEvento versao="1.01"><infPedReg Id="PRE${chave}101101"><chNFSe>${chave}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>9</cMotivo><xMotivo>x</xMotivo></e101101></infPedReg></pedRegEvento></infEvento></evento>`;
const nfseNacional = (tpAmb = '2') => `<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${CHAVE}"><nNFSe>12</nNFSe><dhProc>2026-10-20T10:00:00-03:00</dhProc><DPS versao="1.01"><infDPS Id="DPS1"><tpAmb>${tpAmb}</tpAmb></infDPS></DPS></infNFSe></NFSe>`;

test('pedido e101101 segue o leiaute 1.01: Id PRE+chave+evento, autor, motivo e texto escapado', () => {
  const xml = xmlService.generatePedidoCancelamento(pedido);
  assert.match(xml, /<pedRegEvento xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse" versao="1\.01">/);
  assert.match(xml, new RegExp(`<infPedReg Id="PRE${CHAVE}101101">`));
  assert.equal(`PRE${CHAVE}101101`.length, 59);
  const ordem = ['tpAmb', 'verAplic', 'dhEvento', 'CNPJAutor', 'chNFSe', 'e101101', 'xDesc', 'cMotivo', 'xMotivo'];
  const posicoes = ordem.map(tag => xml.indexOf(`<${tag}>`));
  assert.ok(posicoes.every((p, i) => p > 0 && (i === 0 || p > posicoes[i - 1])), 'ordem dos campos do XSD');
  assert.match(xml, /<xDesc>Cancelamento de NFS-e<\/xDesc>/);
  assert.match(xml, /<cMotivo>9<\/cMotivo>/);
  assert.match(xml, /Cancelamento da assinatura &amp; estorno &lt;aprovado&gt;/);
  assert.ok(!xml.includes('nPedRegEvento'));
});

test('pedido recusa motivo, justificativa, chave, CNPJ, ambiente e data inválidos', () => {
  for (const invalido of [
    { ...pedido, motivo: 3 }, { ...pedido, justificativa: 'curta demais' }, { ...pedido, justificativa: 'x'.repeat(256) },
    { ...pedido, justificativa: '   ' + 'a'.repeat(13) + '   ' }, { ...pedido, chaveAcesso: CHAVE.slice(1) },
    { ...pedido, cnpjAutor: '123' }, { ...pedido, ambiente: 3 }, { ...pedido, dataEvento: '2026-10-21T15:00:00.000Z' },
  ]) assert.throws(() => xmlService.generatePedidoCancelamento(invalido));
});

test('lê chave, ambiente e emissão do XML nacional; nota IPM não tem chave', () => {
  assert.deepEqual(regras.extrairDadosNfseNacional(nfseNacional('1')), {
    chaveAcesso: CHAVE, ambiente: 1, emitidaEm: '2026-10-20T10:00:00-03:00',
  });
  assert.equal(regras.extrairDadosNfseNacional('<retorno><nf><numero_nfse>5</numero_nfse></nf></retorno>'), null);
  assert.equal(regras.extrairDadosNfseNacional(undefined), null);
});

test('prazo de 7 dias e formato de data do evento', () => {
  const p = regras.calcularPrazoCancelamento('2026-10-14T12:00:00Z', new Date('2026-10-21T11:59:59Z'));
  assert.equal(p.dentroDoPrazo, true);
  assert.equal(p.diasDesdeEmissao, 6);
  assert.equal(regras.calcularPrazoCancelamento('2026-10-14T12:00:00Z', new Date('2026-10-21T12:00:01Z')).dentroDoPrazo, false);
  assert.equal(regras.calcularPrazoCancelamento('lixo'), null);
  assert.equal(regras.dataHoraEvento(new Date('2026-10-21T15:00:30.123Z')), '2026-10-21T15:00:00+00:00');
});

function provider(post) {
  return load('src/services/nfse/providers/national.ts', {
    axios: { isAxiosError: e => Boolean(e?.isAxiosError), post },
    '../signature-service': assinaturaFalsa,
  });
}

test('provider envia o evento GZip/Base64 ao Sefin com mTLS e valida o evento devolvido', async () => {
  let enviado;
  const mod = provider(async (url, payload, options) => {
    enviado = { url, payload, options };
    return { data: { eventoXmlGZipB64: gzipSync(eventoOk()).toString('base64') } };
  });
  const res = await mod.default.cancelar(pedido, 'pfx', 'senha');
  assert.equal(res.idEvento, `EVT${CHAVE}101101001`);
  assert.equal(res.processadoEm, '2026-10-21T15:00:05-03:00');
  assert.equal(enviado.url, `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse/${CHAVE}/eventos`);
  assert.deepEqual(Object.keys(enviado.payload), ['pedidoRegistroEventoXmlGZipB64']);
  assert.equal(gunzipSync(Buffer.from(enviado.payload.pedidoRegistroEventoXmlGZipB64, 'base64')).toString(), `<?xml version="1.0" encoding="UTF-8"?>${xmlService.generatePedidoCancelamento(pedido)}`);
  assert.equal(enviado.options.httpsAgent.options.rejectUnauthorized, true);
  assert.equal(enviado.options.maxRedirects, 0);

  await mod.default.cancelar({ ...pedido, ambiente: 1 }, 'pfx', 'senha');
  assert.equal(enviado.url, `https://sefin.nfse.gov.br/SefinNacional/nfse/${CHAVE}/eventos`);
});

test('provider nunca confirma cancelamento sem evento correspondente; E0840 vira "já cancelada"', async () => {
  for (const data of [{}, { erros: [{ Codigo: 'E1234', Descricao: 'Prazo expirado' }] },
    { eventoXmlGZipB64: gzipSync(eventoOk('9'.repeat(50))).toString('base64') }]) {
    await assert.rejects(provider(async () => ({ data })).default.cancelar(pedido, 'pfx', 'senha'));
  }
  const ja = provider(async () => ({ data: { erros: [{ Codigo: 'E0840', Descricao: 'Evento já vinculado' }] } }));
  await assert.rejects(ja.default.cancelar(pedido, 'pfx', 'senha'), e => e instanceof ja.NfseJaCanceladaError);
  const jaHttp = provider(async () => { throw Object.assign(new Error('400'), { isAxiosError: true, response: { data: { erro: { codigo: 'E0840' } } } }); });
  await assert.rejects(jaHttp.default.cancelar(pedido, 'pfx', 'senha'), e => e instanceof jaHttp.NfseJaCanceladaError);
  const recusado = provider(async () => { throw Object.assign(new Error('400'), { isAxiosError: true, response: { data: { erros: [{ Codigo: 'E0001' }] } } }); });
  await assert.rejects(recusado.default.cancelar(pedido, 'pfx', 'senha'), /recusado/);
});

function fakeSupabase({ invoice, config = { prestador_cnpj: '11.222.333/0001-81', pfxBase64: 'pfx', passphrase: 'senha' }, settings = {} }) {
  const tabelas = new Set();
  const updates = [];
  return {
    tabelas, updates,
    from(table) {
      tabelas.add(table);
      const filtros = {};
      let update;
      const q = {
        select() { return q; },
        eq(c, v) { filtros[c] = v; return q; },
        update(v) { update = v; return q; },
        then(resolve) { updates.push({ table, value: update, filtros }); resolve({ error: null }); },
        maybeSingle: async () => table === 'system_invoices' ? { data: invoice, error: null } : { data: settings[filtros.id] ?? null, error: null },
        single: async () => ({ data: { value: config }, error: null }),
      };
      return q;
    },
  };
}

function rota(path, supabase, cancelar) {
  const nationalMock = { __esModule: true, NfseJaCanceladaError: class extends Error { constructor(d) { super(d); this.detalhe = d; } },
    default: { cancelar } };
  const servico = load('src/services/nfse/cancelar-nacional.ts', {
    '@/lib/supabase-server': { supabaseServer: supabase },
    './providers/national': nationalMock,
  });
  return { route: load(path, {
    '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true, user: { id: 'u1', email: 'ramon@791.com.br' } }) },
    '@/lib/supabase-server': { supabaseServer: supabase },
    '@/services/nfse/cancelar-nacional': servico,
  }), nationalMock };
}
const corpo = (b = { motivo: 1, justificativa: 'Cliente pediu estorno da assinatura' }) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
});

test('API: cancela nota nacional autorizada, registra autor/motivo e só toca system_invoices/system_settings', async () => {
  let chamado;
  const supabase = fakeSupabase({ invoice: { id: 'n1', invoice_number: '12', status: 'authorized', metadata: { nfse_oficial_xml: nfseNacional('1'), cancelamento_ultima_falha: { erro: 'x' } } } });
  const { route } = rota('src/app/api/system/invoices/[id]/cancelar/route.ts', supabase, async (p, pfx, senha) => {
    chamado = { p, pfx, senha };
    return { eventoXml: eventoOk(), idEvento: `EVT${CHAVE}101101001`, processadoEm: '2026-10-21T15:00:05-03:00' };
  });
  const res = await route.POST(new Request('https://h/api', corpo()), { params: Promise.resolve({ id: 'n1' }) });
  assert.equal(res.status, 200);
  assert.equal(chamado.p.chaveAcesso, CHAVE);
  assert.equal(chamado.p.ambiente, 1);
  assert.equal(chamado.p.cnpjAutor, CNPJ);
  assert.match(chamado.p.dataEvento, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  const salvo = supabase.updates.at(-1);
  assert.equal(salvo.value.status, 'cancelled');
  assert.equal(salvo.filtros.status, 'authorized');
  assert.equal(salvo.value.metadata.cancelamento.solicitado_por, 'ramon@791.com.br');
  assert.equal(salvo.value.metadata.cancelamento.motivo_descricao, 'Erro na emissão');
  assert.equal(salvo.value.metadata.cancelamento.evento_xml, eventoOk());
  assert.ok(!('cancelamento_ultima_falha' in salvo.value.metadata));
  assert.deepEqual([...supabase.tabelas].sort(), ['system_invoices', 'system_settings']);
  assert.ok(!(await res.json()).cancelamento.evento_xml);
});

test('API: valida pedido, recusa nota não autorizada e orienta nota IPM sem enviar nada', async () => {
  let chamadas = 0;
  const cancelar = async () => { chamadas++; return {}; };
  const params = { params: Promise.resolve({ id: 'n1' }) };
  const ipm = rota('src/app/api/system/invoices/[id]/cancelar/route.ts',
    fakeSupabase({ invoice: { id: 'n1', status: 'authorized', metadata: { xml: '<retorno><nf><numero_nfse>5</numero_nfse></nf></retorno>' } } }), cancelar).route;
  const r1 = await ipm.POST(new Request('https://h/api', corpo()), params);
  assert.equal(r1.status, 422);
  assert.equal((await r1.json()).ipm, true);
  const r2 = await ipm.POST(new Request('https://h/api', corpo({ motivo: 1, justificativa: 'curta' })), params);
  assert.equal(r2.status, 400);
  const cancelada = rota('src/app/api/system/invoices/[id]/cancelar/route.ts',
    fakeSupabase({ invoice: { id: 'n1', status: 'cancelled', metadata: { nfse_oficial_xml: nfseNacional() } } }), cancelar).route;
  assert.equal((await cancelada.POST(new Request('https://h/api', corpo()), params)).status, 409);
  assert.equal(chamadas, 0);
});

test('API: recusa do fisco mantém a nota autorizada e registra a falha; E0840 marca como cancelada', async () => {
  const params = { params: Promise.resolve({ id: 'n1' }) };
  const invoice = { id: 'n1', status: 'authorized', metadata: { nfse_oficial_xml: nfseNacional() } };
  const sb1 = fakeSupabase({ invoice });
  const falha = rota('src/app/api/system/invoices/[id]/cancelar/route.ts', sb1, async () => { throw new Error('E0205 prazo expirado'); }).route;
  const r1 = await falha.POST(new Request('https://h/api', corpo()), params);
  assert.equal(r1.status, 502);
  assert.equal(sb1.updates.length, 1);
  assert.equal(sb1.updates[0].value.status, undefined);
  assert.match(sb1.updates[0].value.metadata.cancelamento_ultima_falha.erro, /prazo expirado/);

  const sb2 = fakeSupabase({ invoice });
  const holder = {};
  const { route, nationalMock } = rota('src/app/api/system/invoices/[id]/cancelar/route.ts', sb2, async () => { throw new holder.Erro('E0840'); });
  holder.Erro = nationalMock.NfseJaCanceladaError;
  const r2 = await route.POST(new Request('https://h/api', corpo()), params);
  assert.equal(r2.status, 200);
  assert.equal(sb2.updates.at(-1).value.status, 'cancelled');
  assert.equal(sb2.updates.at(-1).value.metadata.cancelamento.status, 'ja_cancelada_no_portal');
});

test('API homologação: cancela só teste autorizado da produção restrita', async () => {
  const id = `DPS${'4'.repeat(42)}`;
  const registro = (status, tpAmb = '2') => ({ [`nfse_homologacao_${id}`]: { value: { status, dpsId: id, result: { xml: nfseNacional(tpAmb) } } } });
  const ok = fakeSupabase({ settings: registro('authorized') });
  const { route } = rota('src/app/api/notas-fiscais/homologacao-nacional/cancelar/route.ts', ok,
    async () => ({ eventoXml: eventoOk(), idEvento: 'EVT', processadoEm: null }));
  const res = await route.POST(new Request(`https://h/api?id=${id}`, corpo()));
  assert.equal(res.status, 200);
  assert.equal(ok.updates.at(-1).value.value.status, 'cancelled');
  const producao = rota('src/app/api/notas-fiscais/homologacao-nacional/cancelar/route.ts', fakeSupabase({ settings: registro('authorized', '1') }), async () => ({})).route;
  assert.equal((await producao.POST(new Request(`https://h/api?id=${id}`, corpo()))).status, 422);
  const pendente = rota('src/app/api/notas-fiscais/homologacao-nacional/cancelar/route.ts', fakeSupabase({ settings: registro('verificar_no_portal') }), async () => ({})).route;
  assert.equal((await pendente.POST(new Request(`https://h/api?id=${id}`, corpo()))).status, 409);
  assert.equal((await route.POST(new Request('https://h/api?id=x', corpo()))).status, 400);
});

test('pedido assinado é verificável e passa no XSD oficial pedRegEvento 1.01', { skip: !process.env.NFSE_XSD_DIR }, () => {
  const forge = require('node-forge');
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01');
  cert.validity.notAfter = new Date('2027-01-01');
  const attrs = [{ name: 'commonName', value: 'CERTIFICADO FICTICIO TESTE LOCAL' }];
  cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey);
  const pem = forge.pki.certificateToPem(cert);
  const signature = load('src/services/nfse/signature-service.ts').default;
  const signed = signature.signXML(xmlService.generatePedidoCancelamento(pedido), forge.pki.privateKeyToPem(keys.privateKey), pem, `PRE${CHAVE}101101`);
  const { SignedXml } = require('xml-crypto');
  const { DOMParser } = require('@xmldom/xmldom');
  const dom = new DOMParser().parseFromString(signed, 'text/xml');
  const verifier = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
  verifier.loadSignature(dom.getElementsByTagName('Signature')[0]);
  assert.equal(verifier.checkSignature(signed), true);
  execFileSync('/usr/bin/xmllint', ['--noout', '--schema', `${process.env.NFSE_XSD_DIR}/pedRegEvento_v1.01.xsd`, '-'], {
    input: signed, stdio: ['pipe', 'pipe', 'pipe'],
  });
});
