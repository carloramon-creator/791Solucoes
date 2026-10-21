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
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

const xmlModule = load('src/services/nfse/xml-service.ts');
const oficial = load('src/services/nfse/documento-oficial.ts');
const dados = {
  numero: '123', serie: '1', dataEmissao: '2026-10-21T12:00:00+00:00',
  prestador: { cnpj: '11222333000181', inscricaoMunicipal: '1234' },
  tomador: { cnpj: '11222333000181', razaoSocial: 'EMPRESA & TESTE', email: 'teste@example.com' },
  servico: { codigoItemListaServico: '010501', valorServicos: 5.09, discriminacao: 'Assinatura <teste>' },
  nacional: {
    municipioEmissao: '4216602', municipioPrestacao: '4216602', competencia: '2026-10-21',
    codigoTributacaoNacional: '010501', percentualTributosSimples: 6, regimeConfirmado: 'simples-me-epp',
  },
};

test('DPS 1.01 tem identificador completo, sequência, tomador e valores corretos', () => {
  const xml = xmlModule.default.generateDPS(dados);
  assert.match(xml, /versao="1.01"/);
  assert.match(xml, /Id="DPS421660221122233300018100001000000000000123"/);
  assert.match(xml, /<toma>/);
  assert.match(xml, /<cTribNac>010501<\/cTribNac>/);
  assert.match(xml, /<vServ>5.09<\/vServ>/);
  assert.match(xml, /<pTotTribSN>6.00<\/pTotTribSN>/);
  assert.match(xml, /EMPRESA &amp; TESTE/);
  assert.match(xml, /Assinatura &lt;teste&gt;/);
  assert.ok(!xml.includes('IBSCBS'));
});

test('DPS recusa parâmetros ausentes, número textual, código antigo e ano não suportado', () => {
  for (const invalid of [
    { ...dados, nacional: undefined },
    { ...dados, numero: 'HOLD-123' },
    { ...dados, serie: '90000' },
    { ...dados, tomador: { ...dados.tomador, cpf: '12345678909' } },
    { ...dados, nacional: { ...dados.nacional, codigoTributacaoNacional: '10501' } },
    { ...dados, nacional: { ...dados.nacional, competencia: '2026-02-31' } },
    { ...dados, dataEmissao: '2027-01-01T00:00:00+00:00' },
    { ...dados, nacional: { ...dados.nacional, percentualTributosSimples: NaN } },
  ]) assert.throws(() => xmlModule.default.generateDPS(invalid));
});

test('parser oficial preserva zeros, precisão, entidades, campos extras e itens repetidos', () => {
  const doc = oficial.lerDocumentoOficial(`<nfse><nf><numero_nfse>0004</numero_nfse><valor_total>5,09</valor_total></nf>
    <itens><lista><descritivo>A &amp; B</descritivo></lista><lista><descritivo>C</descritivo></lista></itens>
    <IBSCBS><vCBS>0.00</vCBS><pCBS>0.9000</pCBS></IBSCBS><campo_novo>ABC</campo_novo></nfse>`);
  assert.equal(doc.formato, 'ipm');
  assert.ok(doc.campos.some(c => c.valor === '0004'));
  assert.ok(doc.campos.some(c => c.valor === '0.9000'));
  assert.ok(doc.campos.some(c => c.valor === 'A & B' && c.caminho.includes('[1]')));
  assert.ok(doc.campos.some(c => c.valor === 'C' && c.caminho.includes('[2]')));
  assert.ok(doc.campos.some(c => c.valor === 'ABC'));
});

test('parser recusa retorno resumido, XML quebrado e entidades externas', () => {
  for (const xml of [
    '<retorno><numero_nfse>4</numero_nfse></retorno>',
    '<nfse><nf><numero_nfse>4</numero_nfse></nf>',
    '<!DOCTYPE foo SYSTEM "file:///etc/passwd"><nfse/>',
  ]) assert.throws(() => oficial.lerDocumentoOficial(xml));
});

test('nacional envia GZip ao Sefin restrito com TLS válido e só autoriza com XML correspondente', async () => {
  let enviada;
  const id = xmlModule.default.generateDPS(dados).match(/Id="([^"]+)"/)[1];
  const retorno = `<NFSe><infNFSe Id="NFS${'1'.repeat(50)}"><nNFSe>12</nNFSe><DPS><infDPS Id="${id}"><tpAmb>2</tpAmb><prest><CNPJ>11222333000181</CNPJ></prest></infDPS></DPS></infNFSe></NFSe>`;
  const axios = {
    isAxiosError: () => false,
    async post(url, payload, options) {
      enviada = { url, payload, options };
      return { data: { chaveAcesso: '1'.repeat(50), nfseXmlGZipB64: gzipSync(retorno).toString('base64') } };
    },
  };
  const provider = load('src/services/nfse/providers/national.ts', {
    axios,
    '../signature-service': { __esModule: true, default: {
      extractFromPfx: () => ({ privateKey: 'fake', certificate: 'fake' }),
      signXML: xml => xml,
    } },
  }).default;
  const res = await provider.emit(dados, 'certificado-ficticio', 'senha-ficticia');
  assert.equal(res.status, 'authorized');
  assert.equal(res.invoiceId, '12');
  assert.equal(res.xml, retorno);
  assert.match(enviada.url, /^https:\/\/sefin\.producaorestrita\.nfse\.gov\.br\/API\/SefinNacional\/nfse$/);
  assert.equal(enviada.options.httpsAgent.options.rejectUnauthorized, true);
  assert.equal(enviada.options.maxRedirects, 0);
  assert.deepEqual(Object.keys(enviada.payload), ['dpsXmlGZipB64']);
  assert.equal(gunzipSync(Buffer.from(enviada.payload.dpsXmlGZipB64, 'base64')).toString(), xmlModule.default.generateDPS(dados));
});

test('HTTP 200 sem autorização ou com XML de outra DPS nunca vira sucesso', async () => {
  for (const resposta of [
    {},
    { chaveAcesso: '1'.repeat(50) },
    { chaveAcesso: '1'.repeat(50), nfseXmlGZipB64: gzipSync('<NFSe><infNFSe><nNFSe>12</nNFSe></infNFSe></NFSe>').toString('base64') },
    { erros: [{ Codigo: 'E1', Descricao: 'Rejeitada' }] },
  ]) {
    const provider = load('src/services/nfse/providers/national.ts', {
      axios: { isAxiosError: () => false, post: async () => ({ data: resposta }) },
      '../signature-service': { __esModule: true, default: {
        extractFromPfx: () => ({ privateKey: 'fake', certificate: 'fake' }), signXML: xml => xml,
      } },
    }).default;
    await assert.rejects(provider.emit(dados, 'fake', 'fake'));
  }
});

test('assinatura é verificável e DPS assinada passa no XSD oficial 1.01', { skip: !process.env.NFSE_XSD_DIR }, () => {
  const forge = require('node-forge');
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01');
  cert.validity.notAfter = new Date('2027-01-01');
  const attrs = [{ name: 'commonName', value: 'CERTIFICADO FICTICIO TESTE LOCAL' }];
  cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey);
  const xml = xmlModule.default.generateDPS(dados);
  const id = xml.match(/Id="([^"]+)"/)[1];
  const signature = load('src/services/nfse/signature-service.ts').default;
  const pem = forge.pki.certificateToPem(cert);
  const signed = signature.signXML(xml, forge.pki.privateKeyToPem(keys.privateKey), pem, id);
  const { SignedXml } = require('xml-crypto');
  const { DOMParser } = require('@xmldom/xmldom');
  const dom = new DOMParser().parseFromString(signed, 'text/xml');
  const verifier = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
  verifier.loadSignature(dom.getElementsByTagName('Signature')[0]);
  assert.equal(verifier.checkSignature(signed), true);
  execFileSync('/usr/bin/xmllint', ['--noout', '--schema', `${process.env.NFSE_XSD_DIR}/DPS_v1.01.xsd`, '-'], {
    input: signed, stdio: ['pipe', 'pipe', 'pipe'],
  });

  const comCodigos = xmlModule.default.generateDPS({
    ...dados, nacional: { ...dados.nacional, codigoTributacaoMunicipal: '001', codigoNbs: '122051100' },
  });
  execFileSync('/usr/bin/xmllint', ['--noout', '--schema', `${process.env.NFSE_XSD_DIR}/DPS_v1.01.xsd`, '-'], {
    input: comCodigos, stdio: ['pipe', 'pipe', 'pipe'],
  });
});

test('API nacional: prévia não envia; teste exige reserva persistente e nunca grava no financeiro', async () => {
    const registros = [];
    let emissoes = 0;
    let duplicada = false;
    const config = { prestador_cnpj: '11222333000181', pfxBase64: 'fake', passphrase: 'fake' };
    const supabase = {
      from(table) {
        assert.equal(table, 'system_settings');
        let update;
        return {
          select() { return this; },
          eq(campo, valor) {
            if (update) { registros.push({ id: valor, ...update }); return Promise.resolve({ error: null }); }
            return this;
          },
          single: async () => ({ data: { value: config }, error: null }),
          insert: async registro => { registros.push(registro); return { error: duplicada ? { code: '23505' } : null }; },
          update(value) { update = value; return this; },
        };
      },
    };
    const route = load('src/app/api/notas-fiscais/homologacao-nacional/route.ts', {
      '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true }) },
      '@/lib/supabase-server': { supabaseServer: supabase },
      '@/lib/glass-client': { getGlassClient: async () => ({
        from: () => ({
          select() { return this; }, eq() { return this; },
          single: async () => ({ data: { nome: 'TENANT TESTE', cnpj: '11222333000181' }, error: null }),
        }),
      }) },
      '@/services/nfse/xml-service': xmlModule,
      '@/services/nfse/documento-oficial': oficial,
      '@/services/nfse/providers/national': { __esModule: true, default: { async emit() {
        emissoes++;
        return { status: 'authorized', xml: '<NFSe><infNFSe><nNFSe>12</nNFSe></infNFSe></NFSe>' };
      } } },
    });

    const body = {
      vidracaria_id: 'tenant-teste', numero: '123', serie: '1', valor: 5.09, descricao: 'Teste',
      ...dados.nacional, regimeConfirmado: true,
    };
    const request = enviar => new Request('https://holding.example/api/notas-fiscais/homologacao-nacional', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, confirmarHomologacao: enviar }),
    });
    const preview = await route.POST(request(false));
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).enviado, false);
    assert.equal(emissoes, 0);
    assert.equal(registros.length, 0);
    const enviada = await route.POST(request(true));
    assert.equal(enviada.status, 200);
    assert.equal(emissoes, 1);
    assert.equal(registros[0].value.status, 'enviando');
    assert.equal(registros[1].value.status, 'authorized');
    assert.equal(registros[1].value.ambiente, 'homologacao');
    duplicada = true;
    const repetida = await route.POST(request(true));
    assert.equal(repetida.status, 409);
    assert.equal(emissoes, 1);
});

test('sincronização mantém cancelamento mesmo quando a consulta IPM não traz XML completo', async () => {
  let gravado;
  const invoice = {
    id: 'nota-4', invoice_number: '4', status: 'authorized',
    metadata: { danfse: { retorno: { codigo_verificacao: '1'.repeat(40) } } },
  };
  const supabase = { from(table) {
    let payload;
    return {
      select() { return this; }, eq() { return this; },
      single: async () => ({ data: { value: { ipm_username: 'teste', ipm_password: 'teste', municipal_code: '8303' } } }),
      update(value) { payload = value; return this; },
      then(resolve) {
        if (payload) gravado = payload;
        return Promise.resolve({ data: table === 'system_invoices' ? [invoice] : null, error: null }).then(resolve);
      },
    };
  } };
  const service = load('src/services/nfse/sincronizar-situacao.ts', {
    '@/lib/supabase-server': { supabaseServer: supabase },
    '@/lib/nfse/providers/ipm': { __esModule: true, default: { consultar: async () => ({
      ok: true, situacao: 'Cancelada', codigo: '2', xml: '<retorno><situacao_descricao_nfse>Cancelada</situacao_descricao_nfse></retorno>',
    }) } },
  });
  const resultado = await service.sincronizarSituacaoNfse({ forcar: true });
  assert.equal(gravado.status, 'cancelled');
  assert.deepEqual(resultado.canceladas, ['4']);
  assert.match(resultado.erro, /não retornou o documento completo/);
  assert.equal(gravado.metadata.documento_oficial, undefined);
});
