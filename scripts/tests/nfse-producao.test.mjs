import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) {
      const local = resolve(dirname(path), id);
      if (id.endsWith('.json')) return JSON.parse(readFileSync(local, 'utf8'));
      if (existsSync(`${local}.ts`)) return load(`${local}.ts`, mocks);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

const simples = load('src/services/nfse/simples-nacional.ts');
const meses = simples.mesesAnteriores('2026-11');
const historico = {
  inicioAtividade: '2024-01-15', apuracao: 'competencia', semFolha: true, semReceitasExternas: false,
  historicoConfirmadoAte: '2026-10', receitasExternas: Object.fromEntries(meses.map(mes => [mes, 0])),
  folha: Object.fromEntries(meses.map(mes => [mes, 0])),
};
const config = {
  environment: 'producao', pfxBase64: 'fake', passphrase: 'fake', prestador_cnpj: '11222333000181',
  nacional: { enabled: true, enquadramentoConfirmado: true, serie: '1', municipioEmissao: '4216602', codigoTributacaoNacional: '010501', codigoNbs: '111032200', historico },
};
const tenant = { id: 'tenant', nome: 'CLIENTE FICTICIO', cnpj: '11222333000181', endereco: 'Rua Teste', numero: '10', bairro: 'Centro', cidade: 'São José', estado: 'SC', cep: '88103000' };
const dados = {
  numero: 'HOLD-1', serie: '1', dataEmissao: '',
  prestador: { cnpj: '11222333000181' }, tomador: { cnpj: tenant.cnpj, razaoSocial: tenant.nome },
  servico: { valorServicos: 5, codigoItemListaServico: '010501', discriminacao: 'Mensalidade' },
};

test('Simples sem folha usa Anexo V 15,5%, não III, e exclui o mês atual', () => {
  assert.deepEqual(meses, ['2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10']);
  const zero = simples.calcularSimples('2026-11', historico, { '2026-11': 500000 });
  assert.equal(zero.percentual, 15.5); assert.equal(zero.anexo, 'V'); assert.equal(zero.rbt12, 0);
  assert.equal(zero.fatorR, 0.01);
});

test('todas as faixas até o sublimite e fórmula de alíquota efetiva', () => {
  for (const [rbt12, faixa, esperado] of [
    [180000,1,15.5], [180000.01,2,15.5], [360000,2,16.75], [720000,3,18.13],
    [1800000,4,19.55], [3600000,5,21.28],
  ]) {
    const resultado = simples.calcularSimples('2026-11', historico, { '2026-10': rbt12 });
    assert.equal(resultado.faixa, faixa); assert.equal(resultado.percentual, esperado);
  }
  assert.throws(() => simples.calcularSimples('2026-11', historico, { '2026-10': 3600000.01 }), /sublimite/);
});

test('fator R exige folha paga completa, migra no limite de 28% e usa também receitas externas', () => {
  const comFolha = { ...historico, semFolha: false, folha: { ...historico.folha, '2026-10': 28000 } };
  assert.equal(simples.calcularSimples('2026-11', comFolha, { '2026-10': 100000 }).anexo, 'III');
  assert.equal(simples.calcularSimples('2026-11', comFolha, { '2026-10': 100000 }).percentual, 6);
  assert.equal(simples.calcularSimples('2026-11', { ...comFolha, folha: { ...comFolha.folha, '2026-10': 27999 } }, { '2026-10': 100000 }).anexo, 'V');
  const externo = { ...historico, receitasExternas: { ...historico.receitasExternas, '2026-10': 200000 } };
  assert.equal(simples.calcularSimples('2026-11', externo, {}).faixa, 2);
  assert.throws(() => simples.calcularSimples('2026-11', { ...comFolha, folha: {} }, {}), /Folha/);
  assert.throws(() => simples.calcularSimples('2026-11', { ...historico, receitasExternas: {} }, {}), /não confirmada/);
  assert.throws(() => simples.calcularSimples('2026-11', { ...historico, inicioAtividade: '2026-07-23' }, {}), /proporcionalizada/);
});

test('janela avança sem zeros manuais só com declarações explícitas, sem ignorar dados contraditórios', () => {
  const semExternas = { ...historico, semReceitasExternas: true };
  assert.equal(simples.calcularSimples('2026-12', semExternas, {'2026-11': 200000}).faixa, 2);
  assert.throws(() => simples.calcularSimples('2026-12', historico, {}), /Atualize o histórico/);
  const completo = { ...historico, historicoConfirmadoAte: '2026-11' };
  assert.throws(() => simples.calcularSimples('2026-12', completo, {}), /não confirmada/);
  assert.throws(() => simples.calcularSimples('2026-11', {...semExternas,receitasExternas:{'2026-10':10}}, {}), /conflita/);
  assert.throws(() => simples.calcularSimples('2026-11', {...semExternas,folha:{'2026-10':10}}, {}), /conflita/);
});

function harness({ invoices = [], fail = false, failAuthSave = false } = {}) {
  const settings = new Map();
  const requests = [];
  let authSaveFailed = false;
  const supabase = { from(table) {
    let update, insert, cols, range;
    const filters = {};
    return {
      select(value) { cols = value; return this; },
      eq(k,v) { filters[k] = v; return this; },
      like(k,v) { filters[k] = v; return this; },
      range(a,b) { range = [a,b]; return this; },
      order() { return this; },
      insert(value) { insert = value; return this; },
      update(value) { update = value; return this; },
      maybeSingle() { return this; },
      single() { return this; },
      then(resolve) {
        let result;
        if (insert) {
          if (settings.has(insert.id)) result = { error: { code: '23505' } };
          else { settings.set(insert.id, structuredClone(insert.value)); result = { error: null }; }
        } else if (update) {
          const current = settings.get(filters.id);
          if (failAuthSave && update.value.status === 'authorized' && !authSaveFailed) {
            authSaveFailed = true;
            result = { error: { message: 'Falha transitória ao gravar autorização' } };
          } else if ('value' in filters && filters.value !== JSON.stringify(current)) result = { data: null, error: null };
          else { settings.set(filters.id, structuredClone(update.value)); result = { data: cols ? { id: filters.id } : null, error: null }; }
        } else if (table === 'system_invoices') result = { data: invoices.slice(range?.[0] ?? 0, (range?.[1] ?? 499) + 1), error: null };
        else if (filters.id?.includes('%')) result = { data: [...settings].filter(([id])=>id.startsWith('nfse_producao_')).map(([id,value])=>({id,value})), error: null };
        else result = { data: settings.has(filters.id) ? { value: structuredClone(settings.get(filters.id)) } : null, error: null };
        return Promise.resolve(result).then(resolve);
      },
    };
  } };
  const service = load('src/services/nfse/emissao-nacional.ts', {
    './providers/national': { __esModule: true, default: { async emit(data) {
      requests.push(data);
      if (fail) throw new Error('timeout');
      return { success: true, status: 'authorized', invoiceId: '10', message: 'Autorizada',
        xml: `<NFSe><infNFSe><nNFSe>10</nNFSe><DPS><infDPS><tpAmb>1</tpAmb></infDPS></DPS></infNFSe></NFSe>` };
    } } },
  });
  const emit = (operacao, options = {}) => service.emitirNacionalProducao({ supabase, config, dados, tenant, competencia: '2026-11-03', operacao, ...options });
  return { service, supabase, settings, requests, emit };
}

test('produção e prévia: sequência automática, persistência oficial e sem duplicação em concorrência', async () => {
  const h = harness();
  const preview = await h.emit('preview', { previsualizar: true });
  assert.ok(preview.xml.includes('<tpAmb>1</tpAmb>'));
  assert.ok(preview.xml.includes('<pTotTribSN>15.50</pTotTribSN>'));
  assert.equal(h.settings.size, 0); assert.equal(h.requests.length, 0);
  const remoto = await h.emit('remoto', { previsualizar:true, tenant: {...tenant,cidade:'São Paulo',estado:'SP',cep:'01001000'} });
  assert.match(remoto.xml,/<cMun>3550308<\/cMun>/);
  assert.match(remoto.xml,/<cLocPrestacao>4216602<\/cLocPrestacao>/);
  const results = await Promise.allSettled([h.emit('p1'), h.emit('p1'), h.emit('p2')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length, 2);
  assert.deepEqual(h.requests.map(r=>r.numero).sort(), ['1','2']);
  assert.ok(h.requests.every(r=>r.ambiente===1));
  assert.equal(h.settings.get('nfse_producao_p1').status, 'authorized');
  const emitted = results.find(r=>r.status==='fulfilled').value;
  assert.equal(emitted.metadata.documento_oficial.formato, 'nacional');
  assert.ok(emitted.metadata.nfse_oficial_xml);
  await assert.rejects(h.emit('p1'), /reservada/);
});

test('falhas incertas bloqueiam repetição; configuração desabilitada e 2027 nunca enviam', async () => {
  const h = harness({ fail: true });
  await assert.rejects(h.emit('p1'), /timeout/);
  assert.equal(h.settings.get('nfse_producao_p1').status, 'verificar_no_portal');
  await assert.rejects(h.emit('p1'), /reservada/);
  await assert.rejects(h.emit('p2', { config: { ...config, nacional: { ...config.nacional, enabled: false } } }), /não ativada/);
  await assert.rejects(h.emit('p4', { config: { ...config, nacional: { ...config.nacional, enquadramentoConfirmado: false } } }), /pendente/);
  await assert.rejects(h.emit('p3', { competencia: '2027-01-01' }), /2027/);
  assert.equal(h.requests.length, 1);
});

test('receita exclui canceladas e homologação e deduplica resultados nacionais', async () => {
  const h = harness({ invoices: [
    { id:'a',status:'authorized',value:100,metadata:{mes_ref:'2026-10',operacao_nacional:'nfse_producao_a'} },
    { id:'b',status:'cancelled',value:200,metadata:{mes_ref:'2026-10',operacao_nacional:'nfse_producao_b'} },
    { id:'c',status:'authorized',value:300,metadata:{mes_ref:'2026-10',ambiente:'homologacao'} },
    { id:'d',status:'authorized',value:400,metadata:{mes_ref:'2026-10',xml:'<tpAmb>2</tpAmb>'} },
  ] });
  h.settings.set('nfse_producao_a',{status:'authorized',valor:100,competencia:'2026-10-01'});
  h.settings.set('nfse_producao_b',{status:'authorized',valor:200,competencia:'2026-10-01'});
  h.settings.set('nfse_producao_e',{status:'authorized',valor:50,competencia:'2026-10-01'});
  assert.deepEqual(await h.service.receitasFiscais(h.supabase),{'2026-10':150});
  assert.equal(h.service.usaNacional('2026-10-31'),false);
  assert.equal(h.service.usaNacional('2026-11-01'),true);
});

test('autorização conhecida não se perde se a primeira persistência falha; incerteza anterior bloqueia RBT12', async () => {
  const h = harness({failAuthSave:true});
  await assert.rejects(h.emit('p1'),/Nota autorizada/);
  assert.equal(h.requests.length,1);
  assert.equal(h.settings.get('nfse_producao_p1').status,'authorized');
  assert.ok(h.settings.get('nfse_producao_p1').result.xml);
  assert.deepEqual(await h.service.receitasFiscais(h.supabase,'2026-12'),{'2026-11':5});
  h.settings.set('nfse_producao_old',{status:'verificar_no_portal',competencia:'2026-10-01',valor:10});
  await assert.rejects(h.service.receitasFiscais(h.supabase,'2026-11'),/anterior incerto/);
  const cancelada = harness({invoices:[
    {id:'a',status:'authorized',value:100,metadata:{mes_ref:'2026-10',operacao_nacional:'nfse_producao_a'}},
    {id:'b',status:'cancelled',value:100,metadata:{mes_ref:'2026-10',operacao_nacional:'nfse_producao_a'}},
  ]});
  assert.deepEqual(await cancelada.service.receitasFiscais(cancelada.supabase),{'2026-10':0});
});

test('assinatura automática encaminha novembro ao nacional, outubro à IPM e mantém histórico oficial', async () => {
  for (const [mes, disabled] of [['2026-11',false],['2026-10',false],['2026-11',true]]) {
    let ipm = 0, national = 0, reserved = 0;
    const historicos = [];
    const sb = { from(table) {
      let payload;
      return {
        select() { return this; }, eq() { return this; },
        single: async () => ({ data: { value: { ...config, auto_emit: true } }, error: null }),
        insert(value) {
          if (table === 'nfse_payment_emissions') reserved++;
          if (table === 'system_invoices') historicos.push(value);
          return Promise.resolve({ error: null });
        },
        update(value) { payload = value; return this; },
        then(resolve) { return Promise.resolve({ error: null, data: payload }).then(resolve); },
      };
    } };
    const result = { success: true, status: 'authorized', invoiceId: '10', message: 'Autorizada', xml: '<NFSe/>', accessLink: 'https://www.nfse.gov.br/' };
    const processor = load('src/services/payment-processor.ts', {
      './asaas-service': {}, './inter-service': {}, '@/lib/overage-block': {},
      '@/lib/nfse/providers/ipm': { __esModule: true, default: { emit: async () => { ipm++; return result; } } },
      '@/services/nfse/emissao-nacional': {
        usaNacional: data => data >= '2026-11-01',
        emitirNacionalProducao: async params => {
          assert.equal(params.competencia, `${mes}-01`);
          assert.equal(params.operacao, 'asaas_pay-1');
          if (disabled) throw new Error('Produção não ativada');
          if (params.previsualizar) return { xml: '<DPS/>' };
          national++;
          return { result, metadata: { provider: 'nacional', nfse_oficial_xml: result.xml, documento_oficial: { formato:'nacional',campos:[] } } };
        },
      },
    });

    test('API de configuração protege classificação, certificado, segredos e atualizações concorrentes', async () => {
      let atual = { ...config, auto_emit:true, nacional: { ...config.nacional, enabled:false, enquadramentoConfirmado:false } };
      let autorizado=true, conflito=false, writes=0;
      let updatedAt = '2026-11-03T10:00:00.000Z';
      const supabaseServer = { from() {
        let update;
        const filters = {};
        return {
          select() { return this; },
          eq(key,value) { assert.notEqual(key,'value','Não incluir A1/configuração no URL'); filters[key]=value; return this; },
          is(key,value) { filters[key]=value; return this; },
          update(value) { update=value; return this; },
          single: async () => {
            if (update) {
              if (conflito || filters.updated_at !== updatedAt) return {error:{message:'conflito'}};
              atual=update.value; writes++;
              updatedAt=update.updated_at;
              return {data:{id:'nfse_config'},error:null};
            }
            return {data:{value:structuredClone(atual),updated_at:updatedAt},error:null};
          },
        };
      } };
      const mocks = {
        '@/lib/supabase-server':{supabaseServer},
        '@/lib/holding-admin-auth': {authenticateHoldingAdmin:async()=> autorizado?{ok:true}:{ok:false,status:403,error:'Proibido'}},
        '@/services/nfse/emissao-nacional': {receitasFiscais: async()=>({'2026-06':100})},
        '@/services/nfse/data-hora': {dataHoraNacional:()=> '2026-11-03T10:00:00-03:00'},
      };
      const api = load('src/app/api/system/nfse-nacional/route.ts', mocks);
      const req = body=>new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const get = await api.GET(new Request('https://example.test/api'));
      const json = await get.json();
      assert.equal(json.config.enabled,false); assert.equal(json.apuracao.rbt12,100);
      assert.equal('pfxBase64' in json,false); assert.equal('passphrase' in json,false);
      assert.equal((await api.POST(req({...atual.nacional,enabled:true}))).status,400);
      assert.equal(writes,0);
      assert.equal((await api.POST(req({...atual.nacional,enabled:true,enquadramentoConfirmado:true}))).status,200);
      const legacy = load('src/app/api/system/nfse-config/route.ts',mocks);
      assert.equal((await legacy.POST(req({auto_emit:false,pfxBase64:'',nacional:{enabled:false}}))).status,200);
      assert.equal(atual.nacional.enabled,true); assert.equal(atual.pfxBase64,'fake');
      conflito=true;
      assert.equal((await api.POST(req(atual.nacional))).status,400);
      assert.equal((await legacy.POST(req({auto_emit:true}))).status,500);
      autorizado=false;
      assert.equal((await api.GET(new Request('https://example.test/api'))).status,403);
    });

    test('API manual mantém produção/legado separados; prévia não emite nem salva receita e envio exige referência', async () => {
      let nacional=0, ipm=0, historicos=0;
      const supabaseServer = {from(){return {
        select(){return this;},eq(){return this;},
        single:async()=>({data:{value:config},error:null}),
        insert:async()=>{historicos++;return {error:null};},
      };}};
      const result={success:true,status:'authorized',invoiceId:'10',message:'Autorizada',xml:'<NFSe/>',accessLink:'https://www.nfse.gov.br/'};
      const api = load('src/app/api/notas-fiscais/emitir/route.ts',{
        '@/lib/supabase-server':{supabaseServer},
        '@/lib/holding-admin-auth':{authenticateHoldingAdmin:async()=>({ok:true})},
        '@/lib/glass-client':{getGlassClient:async()=>({from:()=>({
          select(){return this;},eq(){return this;},single:async()=>({data:tenant,error:null}),
        })})},
        '@/lib/nfse/providers/ipm':{__esModule:true,default:{emit:async()=>{ipm++;return result;}}},
        '@/services/nfse/danfse-snapshot':{montarSnapshotDanfse:()=>({})},
        '@/services/nfse/emissao-nacional':{
          usaNacional: data=>data>='2026-11-01',
          emitirNacionalProducao:async args=>{
            if(args.previsualizar) return {xml:'<DPS/>',apuracao:{}};
            nacional++;return {result,metadata:{provider:'nacional'}};
          },
        },
      });

      test('certificado grande nunca aumenta o URL do salvamento; CAS usa versão, inclusive nula', async () => {
        const {createClient}=require('@supabase/supabase-js');
        for(const updated_at of ['2026-11-03T10:00:00.000Z',null]){
          const patches=[];
          const supabaseServer=createClient('https://example.supabase.co','test-key',{
            auth:{persistSession:false,autoRefreshToken:false},
            global:{fetch:async (url,init)=>{
              assert.ok(String(url).length<1024,`URL deve permanecer curto, recebeu ${String(url).length} caracteres`);
              if(init?.method==='PATCH'){
                const query=new URL(String(url));
                assert.equal(query.searchParams.has('value'),false);
                assert.equal(query.searchParams.get('updated_at'),updated_at===null?'is.null':`eq.${updated_at}`);
                assert.equal(JSON.parse(init.body).value.pfxBase64.length,50000);
                patches.push(query);
                return new Response(JSON.stringify({id:'nfse_config'}),{headers:{'Content-Type':'application/json'}});
              }
              return new Response(JSON.stringify({value:{...config,pfxBase64:'X'.repeat(50000)},updated_at}),{headers:{'Content-Type':'application/json'}});
            }},
          });
          const mocks={
            '@/lib/supabase-server':{supabaseServer},
            '@/lib/holding-admin-auth':{authenticateHoldingAdmin:async()=>({ok:true})},
            '@/services/nfse/emissao-nacional':{receitasFiscais:async()=>({})},
            '@/services/nfse/data-hora':{dataHoraNacional:()=> '2026-11-03T10:00:00-03:00'},
          };
          const req=body=>new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          assert.equal((await load('src/app/api/system/nfse-nacional/route.ts',mocks).POST(req(config.nacional))).status,200);
          assert.equal((await load('src/app/api/system/nfse-config/route.ts',mocks).POST(req({auto_emit:false}))).status,200);
          assert.equal(patches.length,2);
        }
      });
      const send=body=>api.POST(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vidracaria_id:tenant.id,valor:5,...body})}));
      const preview=await send({competencia:'2026-11-01',previsualizar:true});
      assert.equal((await preview.json()).enviado,false);
      assert.equal(nacional,0);assert.equal(ipm,0);assert.equal(historicos,0);
      assert.equal((await send({competencia:'2026-11-01'})).status,500);
      assert.equal((await send({competencia:'2026-11-01',referencia:'valid-1',previsualizar:'true'})).status,500);
      assert.equal(nacional,0);
      assert.equal((await send({competencia:'2026-11-01',referencia:'valid-1'})).status,200);
      assert.equal(nacional,1);assert.equal(ipm,0);
      assert.equal((await send({competencia:'2026-10-01'})).status,200);
      assert.equal(ipm,1);assert.equal(historicos,2);
    });
    const action = () => processor.emitirNFeSaas({
      holdingSupabase: sb, glassSupabase: { from: () => ({
        select() { return this; }, eq() { return this; },
        single: async () => ({ data: tenant, error: null }),
      }) },
      vidracariaId: tenant.id, valor: 5, ciclo: 'monthly', asaasPaymentId: 'pay-1', mesRef: mes,
    });
    if (disabled) {
      await assert.rejects(action(), /não ativada/);
      assert.equal(reserved, 0); assert.equal(ipm,0); assert.equal(national,0);
    } else {
      await action();
      assert.equal(ipm,mes==='2026-10'?1:0);
      assert.equal(national,mes==='2026-11'?1:0);
      assert.equal(historicos.length,1);
      if (mes==='2026-11') assert.equal(historicos[0].metadata.documento_oficial.formato,'nacional');
    }
  }
});
