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
const horario = load('src/services/nfse/data-hora.ts');
const nacionalModule = load('src/services/nfse/providers/national.ts');
const enderecoModule = load('src/services/nfse/endereco-tomador.ts');
const tenantEndereco = {
  endereco: 'Rua Teste & Exemplo', numero: '10', bairro: 'Centro', cep: '88103-000',
  cidade: 'São José', estado: 'SC', complemento: 'Sala 2',
};
const dados = {
  numero: '123', serie: '1', dataEmissao: '2026-10-21T12:00:00+00:00',
  prestador: { cnpj: '11222333000181', inscricaoMunicipal: '1234' },
  tomador: {
    cnpj: '11222333000181', razaoSocial: 'EMPRESA & TESTE', email: 'teste@example.com',
    endereco: { codigoMunicipio: '4216602', cep: '88103000', logradouro: 'Rua Teste & Exemplo', numero: '10', bairro: 'Centro', complemento: 'Sala 2' },
  },
  servico: { codigoItemListaServico: '010501', valorServicos: 5.09, discriminacao: 'Assinatura <teste>' },
  nacional: {
    municipioEmissao: '4216602', municipioPrestacao: '4216602', competencia: '2026-10-21',
    codigoTributacaoNacional: '010501', codigoNbs: '111032200', percentualTributosSimples: 6, regimeConfirmado: 'simples-me-epp',
  },
};

test('horário nacional usa Brasília e preserva o instante com folga de 30 segundos', () => {
  for (const [instante, esperado] of [
    ['2026-11-03T17:34:01.169Z', '2026-11-03T14:33:31-03:00'],
    ['2026-11-03T00:00:10.999Z', '2026-11-02T20:59:40-03:00'],
    ['2026-11-03T03:00:10.999Z', '2026-11-02T23:59:40-03:00'],
    ['2026-01-01T03:00:30.000Z', '2026-01-01T00:00:00-03:00'],
  ]) {
    const agora = new Date(instante);
    const resultado = horario.dataHoraNacional(agora);
    assert.equal(resultado, esperado);
    const diferenca = agora.getTime() - Date.parse(resultado);
    assert.ok(diferenca >= 30_000 && diferenca < 31_000);
    const xml = xmlModule.default.generateDPS({ ...dados, dataEmissao: resultado });
    assert.ok(xml.includes(`<dhEmi>${esperado}</dhEmi>`));
  }
});

test('DPS 1.01 tem identificador completo, sequência, tomador e valores corretos', () => {
  const xml = xmlModule.default.generateDPS(dados);
  assert.match(xml, /versao="1.01"/);
  assert.match(xml, /Id="DPS421660221122233300018100001000000000000123"/);
  assert.match(xml, /<toma>/);
  assert.match(xml, /<cTribNac>010501<\/cTribNac>/);
  assert.match(xml, /<vServ>5.09<\/vServ>/);
  assert.match(xml, /<pTotTribSN>6.00<\/pTotTribSN>/);
  assert.match(xml, /EMPRESA &amp; TESTE/);
  assert.match(xml, /<endNac>\s*<cMun>4216602<\/cMun>\s*<CEP>88103000<\/CEP>\s*<\/endNac>\s*<xLgr>Rua Teste &amp; Exemplo<\/xLgr>\s*<nro>10<\/nro>\s*<xCpl>Sala 2<\/xCpl>\s*<xBairro>Centro<\/xBairro>/);
  assert.match(xml, /Assinatura &lt;teste&gt;/);
  const compacto = xml.replace(/>\s+</g, '><');
  assert.match(compacto, /<cTribNac>010501<\/cTribNac><cNBS>111032200<\/cNBS><xDescServ>/);
  assert.match(compacto, /<\/valores><IBSCBS><indFinal>0<\/indFinal><cIndOp>100301<\/cIndOp><indDest>0<\/indDest><valores><trib><CST>000<\/CST><cClassTrib>000001<\/cClassTrib><\/trib><\/valores><\/IBSCBS><\/infDPS>/);
});

test('DPS recusa parâmetros ausentes, número textual, código antigo e ano não suportado', () => {
  for (const invalid of [
    { ...dados, nacional: undefined },
    ...[
      undefined,
      { ...dados.tomador.endereco, codigoMunicipio: '8303' },
      { ...dados.tomador.endereco, cep: '88103-000' },
      { ...dados.tomador.endereco, logradouro: '' },
      { ...dados.tomador.endereco, numero: '' },
      { ...dados.tomador.endereco, bairro: '' },
    ].map(endereco => ({ ...dados, tomador: { ...dados.tomador, endereco } })),
    { ...dados, nacional: { ...dados.nacional, codigoNbs: undefined } },
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
  assert.equal(gunzipSync(Buffer.from(enviada.payload.dpsXmlGZipB64, 'base64')).toString(), `<?xml version="1.0" encoding="UTF-8"?>${xmlModule.default.generateDPS(dados)}`);
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

test('somente rejeição HTTP 400 E0008/E0239 da mesma DPS e ambiente permite corrigir dados', async () => {
  const idDPS = xmlModule.default.generateDPS(dados).match(/Id="([^"]+)"/)[1];
  const rejeicao = { tipoAmbiente: 2, idDPS, erros: [{ Codigo: 'E0008' }] };
  for (const [status, resposta, recuperavel] of [
    [400, rejeicao, true],
    [400, { ...rejeicao, erros: [{ Codigo: 'E0239' }] }, true],
    [500, rejeicao, false],
    [400, { ...rejeicao, tipoAmbiente: 1 }, false],
    [400, { ...rejeicao, idDPS: 'DPS-outra' }, false],
    [400, { ...rejeicao, erros: [] }, false],
    [400, { ...rejeicao, erros: [{ Codigo: 'E0008' }, { Codigo: 'E9999' }] }, false],
  ]) {
    const mod = load('src/services/nfse/providers/national.ts', {
      axios: {
        isAxiosError: e => e.isAxiosError === true,
        post: async () => { throw { isAxiosError: true, response: { status, data: resposta } }; },
      },
      '../signature-service': { __esModule: true, default: {
        extractFromPfx: () => ({ privateKey: 'fake', certificate: 'fake' }), signXML: xml => xml,
      } },
    });
    await assert.rejects(mod.default.emit(dados, 'fake', 'fake'), err => {
      assert.equal(err instanceof mod.DpsRejeitadaError, recuperavel);
      if (recuperavel) assert.deepEqual(err.resposta, resposta);
      return true;
    });
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
          maybeSingle: async () => ({ data: { value: { status: 'authorized' } }, error: null }),
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
          select(campos) { assert.ok(campos.includes('endereco') && campos.includes('cidade')); return this; }, eq() { return this; },
          single: async () => ({ data: { nome: 'TENANT TESTE', cnpj: '11222333000181', ...tenantEndereco }, error: null }),
        }),
      }) },
      '@/services/nfse/xml-service': xmlModule,
      '@/services/nfse/data-hora': horario,
      '@/services/nfse/endereco-tomador': { enderecoTomadorNacional: async tenant => {
        assert.equal(tenant.endereco, tenantEndereco.endereco);
        return dados.tomador.endereco;
      } },
      '@/services/nfse/documento-oficial': oficial,
      '@/services/nfse/providers/national': { ...nacionalModule, __esModule: true, default: { async emit() {
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
    const previa = await preview.json();
    assert.equal(previa.enviado, false);
    const emissao = previa.xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)[1];
    assert.match(emissao, /-03:00$/);
    assert.ok(Date.now() - Date.parse(emissao) >= 30_000);
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

test('API retoma somente E0008/E0239 confirmadas, inclusive registro antigo, com reserva atômica', async () => {
  const dpsId = xmlModule.default.generateDPS(dados).match(/Id="([^"]+)"/)[1];
  const rejeicao = { tipoAmbiente: 2, idDPS: dpsId, erros: [{ Codigo: 'E0008' }] };
  const erroAntigo = resposta => `Homologação nacional: ${JSON.stringify(resposta)}. Consulte a DPS ${dpsId} antes de reenviar.`;
  const base = { ambiente: 'homologacao', dpsId };
  const casos = [
    { anterior: { ...base, status: 'verificar_no_portal', erro: erroAntigo({ ...rejeicao, erros: [{ Codigo: 'E0239' }] }) }, esperado: 200 },
    { anterior: { ...base, status: 'verificar_no_portal', erro: erroAntigo(rejeicao) }, esperado: 200 },
    { anterior: { ...base, status: 'rejeitada', rejeicao }, esperado: 200 },
    { anterior: { ...base, status: 'rejeitada', rejeicao }, concorrente: true, esperado: 200 },
    { anterior: { ...base, status: 'rejeitada', rejeicao }, corrida: true, esperado: 409 },
    { anterior: { ...base, status: 'rejeitada', rejeicao }, enderecoIncompleto: true, esperado: 502 },
    { anterior: { ...base, status: 'authorized' }, esperado: 409 },
    { anterior: { ...base, status: 'enviando' }, esperado: 409 },
    { anterior: { ...base, status: 'verificar_no_portal', erro: 'timeout E0008' }, esperado: 409 },
    { anterior: { ...base, status: 'verificar_no_portal', erro: erroAntigo({ ...rejeicao, idDPS: 'DPS-outra' }) }, esperado: 409 },
    { anterior: { ...base, status: 'verificar_no_portal', erro: erroAntigo({ ...rejeicao, erros: [{ Codigo: 'E9999' }] }) }, esperado: 409 },
    { anterior: { ...base, status: 'verificar_no_portal', erro: erroAntigo({ ...rejeicao, tipoAmbiente: 1 }) }, esperado: 409 },
    { anterior: { ...base, status: 'rejeitada', rejeicao }, falha: new Error('timeout'), esperado: 502, salvo: 'verificar_no_portal' },
    { anterior: { ...base, status: 'rejeitada', rejeicao }, falha: new nacionalModule.DpsRejeitadaError(rejeicao), esperado: 502, salvo: 'rejeitada' },
  ];
  for (const caso of casos) {
    let emissoes = 0;
    let reserva = false;
    let registro = caso.anterior;
    const supabase = { from(table) {
      assert.equal(table, 'system_settings');
      let payload;
      const filtros = {};
      return {
        select() { return this; },
        eq(campo, valor) { filtros[campo] = valor; return this; },
        single: async () => ({ data: { value: { prestador_cnpj: dados.prestador.cnpj, pfxBase64: 'fake', passphrase: 'fake' } }, error: null }),
        insert: async () => ({ error: { code: '23505' } }),
        update(value) { payload = value; return this; },
        maybeSingle: async () => {
          if (!payload) return { data: { value: registro }, error: null };
          assert.equal(filtros.id, `nfse_homologacao_${dpsId}`);
          assert.equal(filtros.value, JSON.stringify(caso.anterior));
          assert.equal(payload.value.status, 'enviando');
          assert.ok(Date.now() - Date.parse(payload.value.xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)[1]) >= 30_000);
          if (caso.corrida || filtros.value !== JSON.stringify(registro)) return { data: null, error: null };
          registro = payload.value;
          reserva = true;
          return { data: { id: filtros.id }, error: null };
        },
        then(resolve) {
          assert.ok(payload);
          registro = payload.value;
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
    } };
    const route = load('src/app/api/notas-fiscais/homologacao-nacional/route.ts', {
      '@/lib/holding-admin-auth': { authenticateHoldingAdmin: async () => ({ ok: true }) },
      '@/lib/supabase-server': { supabaseServer: supabase },
      '@/lib/glass-client': { getGlassClient: async () => ({
        from: () => ({
          select() { return this; }, eq() { return this; },
          single: async () => ({ data: { nome: 'TENANT TESTE', cnpj: dados.prestador.cnpj }, error: null }),
        }),
      }) },
      '@/services/nfse/xml-service': xmlModule,
      '@/services/nfse/data-hora': horario,
      '@/services/nfse/endereco-tomador': { enderecoTomadorNacional: async () => {
        if (caso.enderecoIncompleto) throw new Error('Complete o endereço do cliente no Glass.');
        return dados.tomador.endereco;
      } },
      '@/services/nfse/documento-oficial': oficial,
      '@/services/nfse/providers/national': {
        ...nacionalModule, __esModule: true,
        default: { async emit() {
          assert.equal(reserva, true);
          emissoes++;
          if (caso.falha) throw caso.falha;
          return { status: 'authorized', xml: '<NFSe><infNFSe><nNFSe>12</nNFSe></infNFSe></NFSe>' };
        } },
      },
    });
    const request = () => new Request('https://holding.example/api/notas-fiscais/homologacao-nacional', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vidracaria_id: 'tenant-teste', numero: dados.numero, serie: dados.serie, valor: 5,
        descricao: 'Teste', ...dados.nacional, regimeConfirmado: true, confirmarHomologacao: true,
      }),
    });
    const respostas = caso.concorrente
      ? await Promise.all([route.POST(request()), route.POST(request())])
      : [await route.POST(request())];
    assert.deepEqual(respostas.map(resposta => resposta.status).sort(), caso.concorrente ? [200, 409] : [caso.esperado]);
    assert.equal(emissoes, caso.esperado === 409 || caso.enderecoIncompleto ? 0 : 1);
    if (caso.enderecoIncompleto) {
      assert.equal(reserva, false);
      assert.deepEqual(registro, caso.anterior);
    }
    if (caso.salvo) {
      assert.equal(registro.status, caso.salvo);
      assert.deepEqual(registro.rejeicao, caso.salvo === 'rejeitada' ? rejeicao : undefined);
      assert.match(registro.dataEmissao, /-03:00$/);
      assert.ok(registro.xml.includes(`<dhEmi>${registro.dataEmissao}</dhEmi>`));
      assert.equal(registro.tenant_id, 'tenant-teste');
    }
  }
});

test('endereço usa cadastro e município IBGE da UF, sem enviar dados do cliente nem presumir local da prestação', async t => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async url => {
    chamadas.push(url);
    return Response.json([{ id: 4216602, nome: 'São José' }, { id: 4205407, nome: 'Florianópolis' }]);
  });
  const endereco = await enderecoModule.enderecoTomadorNacional(tenantEndereco);
  assert.deepEqual(endereco, dados.tomador.endereco);
  const outro = await enderecoModule.enderecoTomadorNacional({ ...tenantEndereco, cidade: 'florianopolis' });
  assert.equal(outro.codigoMunicipio, '4205407');
  const porCodigo = await enderecoModule.enderecoTomadorNacional({ ...tenantEndereco, cidade: '4216602' });
  assert.equal(porCodigo.codigoMunicipio, '4216602');
  const alternativo = await enderecoModule.enderecoTomadorNacional({
    ...tenantEndereco, endereco: '', endereco_completo: 'Rua Alternativa', complemento: '',
  });
  assert.equal(alternativo.logradouro, 'Rua Alternativa');
  assert.equal(alternativo.complemento, undefined);
  for (const url of chamadas) assert.equal(url, 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/SC/municipios');
  for (const campo of ['endereco', 'numero', 'bairro', 'cep', 'cidade', 'estado']) {
    await assert.rejects(enderecoModule.enderecoTomadorNacional({ ...tenantEndereco, [campo]: '' }), /Complete o endereço/);
  }
  await assert.rejects(enderecoModule.enderecoTomadorNacional({ ...tenantEndereco, cidade: 'Cidade inexistente' }), /não encontrado/);
  globalThis.fetch = async () => Response.json({}, { status: 503 });
  await assert.rejects(enderecoModule.enderecoTomadorNacional(tenantEndereco), /HTTP 503/);
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(enderecoModule.enderecoTomadorNacional(tenantEndereco), /Resposta inválida/);
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
