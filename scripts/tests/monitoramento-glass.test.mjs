import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';

function load(file, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Missing mock ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}

const validators = load('src/lib/monitoramento-glass.ts');
const infraLib = load('src/lib/monitoramento-infra.ts');
const metricas = {
  banco_bytes: 338197217, tabelas_publicas: 1, restricoes_nao_validadas: 0,
  conexoes: 3, conexoes_ativas: 1, aguardando_bloqueio: 0, limite_conexoes_servidor: 100,
  cache_percentual: 99.5, estatisticas_ativas: true, linhas_mortas_estimadas: 10,
  maiores_tabelas: [{ nome: 'ficticia', bytes: 2048, linhas_vivas_estimadas: 30, linhas_mortas_estimadas: 10, ultimo_autovacuum: null }],
};
const amostras = [{ coletado_em: '2026-11-25T18:00:00Z', metricas }];
const integridade = {
  iniciado_em: '2026-11-25T06:00:00Z', concluido_em: '2026-11-25T06:01:00Z',
  tabelas: [{ nome: 'ficticia', status: 'sem_problemas_detectados', ocorrencias_primeiro_bloco: 0 }],
};
const storage = { coletado_em: '2026-11-25T18:00:00Z', bytes_conhecidos: 300000000, objetos: 4, objetos_sem_tamanho: 1 };
const infra = {
  consultado_em: '2026-11-25T18:00:00Z', memoria_total: 1000000000, memoria_disponivel: 400000000,
  cpu: [{ cpu: '0', inativo: 100, total: 200 }],
};
const listaTabelas = {
  consultado_em: '2026-11-25T18:00:00Z',
  tabelas: Array.from({ length: 15 }, (_, i) => ({ ...metricas.maiores_tabelas[0], nome: `tabela_${i + 1}`, tipo: 'tabela' })),
};
const indices = { iniciado_em: '2026-11-25T07:00:00Z', concluido_em: '2026-11-25T07:01:00Z', indices: [
  { nome: 'ficticia_pkey', status: 'sem_problemas_detectados' },
  { nome: 'ficticia_indice', status: 'erro_verificacao', codigo: '42501' },
] };
const referencias = {
  iniciado_em: '2026-11-25T09:00:00Z', concluido_em: '2026-11-25T09:01:00Z',
  relacionamentos: [{ tabela: 'filho', restricao: 'fk_pendente', status: 'possivel_violacao' }],
  arquivos: [
    { tabela: 'orcamento_anexos', status: 'verificado', registros: 2, sem_metadados: 1 },
    { tabela: 'os_anexos', status: 'verificado', registros: 0, sem_metadados: 0 },
    { tabela: 'fin_lancamentos_anexos', status: 'erro_verificacao', codigo: '42501' },
    { tabela: 'internal_chat_attachments', status: 'verificado', registros: 1, sem_metadados: 0 },
  ],
  regras: [
    { nome: 'orcamento_anexo_empresa', status: 'sem_ocorrencias' },
    { nome: 'orcamento_historico_empresa', status: 'possivel_violacao' },
    { nome: 'financeiro_anexo_empresa', status: 'sem_ocorrencias' },
    { nome: 'financeiro_anexo_baixa', status: 'erro_verificacao', codigo: '42501' },
  ],
};

function route({ authenticated = true, permitted = true, queryError = null, configError = false, rpcError = null, listaInvalida = false, infraError = false } = {}) {
  const calls = [];
  const code = ts.transpileModule(readFileSync('src/app/api/admin/monitoramento-glass/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/holding-admin-auth': {
      authenticateHoldingAdmin: async () => authenticated
        ? { ok: true, user: { email: 'admin@example.test' } }
        : { ok: false, status: 401, error: 'Sessão inválida.' },
    },
    '@/lib/holding-route-permissions': {
      hasExplicitHoldingPermission: async (email, codes) => {
        calls.push(['permission', email, codes]);
        return permitted;
      },
    },
    '@/lib/monitoramento-glass': validators,
    '@/lib/monitoramento-infra': infraLib,
    '@/lib/monitoramento-infra-server': { consultarInfraGlass: async () => {
      if (infraError) throw new Error('confidential settings');
      return infra;
    } },
    '@/lib/glass-client': {
      getGlassClient: async () => {
        calls.push(['client']);
        if (configError) throw new Error('confidential settings');
        return { rpc: name => ({ abortSignal: async signal => {
          assert.ok(signal instanceof AbortSignal);
          calls.push(['rpc', name]);
          if (rpcError === name) return { data: null, error: new Error('confidential settings') };
          return { data: name === 'monitoramento_banco_glass_tabelas' ? (listaInvalida ? null : listaTabelas) : name === 'monitoramento_banco_glass_historico' ? amostras : name === 'monitoramento_integridade_glass_ultimo' ? integridade : name === 'monitoramento_indices_glass_ultimo' ? indices : name === 'monitoramento_referencias_glass_ultimo' ? referencias : storage, error: null };
        } }), from: table => {
          calls.push(['table', table]);
          return { select: fields => {
            calls.push(['select', fields]);
            return { limit: count => {
              calls.push(['limit', count]);
              return { abortSignal: async signal => {
                assert.ok(signal instanceof AbortSignal);
                return { data: [], error: queryError };
              } };
            } };
          } };
        } };
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Missing mock ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return { ...module.exports, calls };
}

test('exige autenticação e permissão antes de acessar o Glass', async () => {
  const unauthenticated = route({ authenticated: false });
  assert.equal((await unauthenticated.GET(new Request('http://localhost'))).status, 401);
  assert.deepEqual(unauthenticated.calls, []);
  const denied = route({ permitted: false });
  assert.equal((await denied.GET(new Request('http://localhost'))).status, 403);
  assert.deepEqual(denied.calls, [['permission', 'admin@example.test', ['submenu.configuracoes.financeiro']]]);
});

test('lista completa exige autorização e retorna mais de dez tabelas', async () => {
  const url = 'http://localhost/api/admin/monitoramento-glass?tabelas=1';
  const denied = route({ permitted: false });
  assert.equal((await denied.GET(new Request(url))).status, 403);
  assert.equal(denied.calls.some(c => c[0] === 'client'), false);
  const api = route();
  const response = await api.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).lista.tabelas.length, 15);
  assert.deepEqual(api.calls.slice(1), [['client'], ['rpc', 'monitoramento_banco_glass_tabelas']]);
});

test('falha ou resposta inválida da lista completa retorna erro explícito', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const options of [{ rpcError: 'monitoramento_banco_glass_tabelas' }, { listaInvalida: true }]) {
      const response = await route(options).GET(new Request('http://localhost/?tabelas=1'));
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /Não foi possível consultar todas as tabelas/);
    }
  } finally { console.error = original; }
});

test('verifica uma leitura limitada, inclusive quando não existem vidraçarias', async () => {
  const api = route();
  const response = await api.GET(new Request('http://localhost'));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.status, 'disponivel');
  assert.ok(Number.isFinite(result.tempoMs));
  assert.ok(Number.isFinite(Date.parse(result.verificadoEm)));
  assert.deepEqual(api.calls.slice(1), [['client'], ['table', 'vidracarias'], ['select', 'id'], ['limit', 1],
    ['rpc', 'monitoramento_banco_glass_historico'], ['rpc', 'monitoramento_integridade_glass_ultimo'], ['rpc', 'monitoramento_storage_glass_ultimo'], ['rpc', 'monitoramento_indices_glass_ultimo'], ['rpc', 'monitoramento_referencias_glass_ultimo']]);
  assert.equal(result.historico[0].metricas.banco_bytes, 338197217);
  assert.equal(result.integridade.tabelas[0].status, 'sem_problemas_detectados');
  assert.equal(result.storage.bytes_conhecidos, 300000000);
  assert.deepEqual(result.indices, indices);
  assert.deepEqual(result.referencias, referencias);
  assert.deepEqual(result.infra, infra);
});

test('falha das métricas de infraestrutura não derruba o restante do painel', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await (await route({ infraError: true }).GET(new Request('http://localhost'))).json();
    assert.equal(result.infra, null);
    assert.match(result.infraErro, /indisponíveis/);
    assert.ok(result.historico);
    assert.doesNotMatch(JSON.stringify(result), /confidential settings/);
  } finally { console.error = original; }
});

test('lê somente métricas da instância principal e calcula CPU entre leituras', () => {
  function dados(idle, user, disponivel = 400) {
    const labels = 'supabase_identifier="projeto",service_type="db"';
    const cpu = Object.entries({ idle, user, nice: 0, system: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 })
      .map(([modo, valor]) => `node_cpu_seconds_total{${labels},cpu="0",mode="${modo}"} ${valor}`).join('\n');
    return `${cpu}\nnode_memory_MemTotal_bytes{${labels}} 1000\nnode_memory_MemAvailable_bytes{${labels}} ${disponivel}\nnode_memory_MemTotal_bytes{supabase_identifier="replica",service_type="db"} 9999`;
  }
  const a = infraLib.interpretarMetricas(dados(100, 100), 'projeto', '2026-11-25T18:00:00Z');
  const b = infraLib.interpretarMetricas(dados(130, 110), 'projeto', '2026-11-25T18:01:00Z');
  assert.equal(a.memoria_total, 1000);
  assert.equal(a.memoria_disponivel, 400);
  assert.equal(infraLib.validarInfra(a), true);
  assert.equal(infraLib.percentualCpu(null, a), null);
  assert.equal(infraLib.percentualCpu(a, b), 25);
  assert.equal(infraLib.percentualCpu(a, { ...a, consultado_em: b.consultado_em }), null);
  assert.equal(infraLib.percentualCpu(b, { ...a, consultado_em: '2026-11-25T18:02:00Z' }), null);
  assert.equal(infraLib.percentualCpu(a, { ...b, consultado_em: '2026-11-25T19:00:00Z' }), null);
  assert.throws(() => infraLib.interpretarMetricas(dados(100, 100, 1001), 'projeto', a.consultado_em));
  assert.throws(() => infraLib.interpretarMetricas(dados(100, 100), 'outra', a.consultado_em));
  assert.throws(() => infraLib.interpretarMetricas(dados(100, 100).replace('mode="idle"', 'mode="unknown"'), 'projeto', a.consultado_em));
});

test('métricas são consultadas somente no endpoint Supabase configurado, sem seguir redirecionamentos', async () => {
  let config = { glassUrl: 'https://projeto.supabase.co', glassServiceKey: 'segredo-ficticio' };
  let chamada;
  const server = load('src/lib/monitoramento-infra-server.ts', {
    '@/lib/finance-config-server': { readFinanceConfig: async () => config },
    '@/lib/monitoramento-infra': infraLib,
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    chamada = { url, options };
    return new Response('node_memory_MemTotal_bytes{supabase_identifier="projeto",service_type="db"} 1000\nnode_memory_MemAvailable_bytes{supabase_identifier="projeto",service_type="db"} 400');
  };
  try {
    assert.equal((await server.consultarInfraGlass()).memoria_disponivel, 400);
    assert.equal(chamada.url, 'https://projeto.supabase.co/customer/v1/privileged/metrics');
    assert.equal(chamada.options.redirect, 'error');
    assert.equal(chamada.options.headers.Authorization, `Basic ${Buffer.from('service_role:segredo-ficticio').toString('base64')}`);
    config = { ...config, glassUrl: 'https://outro.example' };
    chamada = undefined;
    await assert.rejects(server.consultarInfraGlass());
    assert.equal(chamada, undefined);
  } finally { globalThis.fetch = original; }
});

test('falha na consulta de índices é informada separadamente', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await (await route({ rpcError: 'monitoramento_indices_glass_ultimo' }).GET(new Request('http://localhost'))).json();
    assert.equal(result.indices, null);
    assert.match(result.indicesErro, /indisponível/);
    assert.ok(result.integridade);
  } finally { console.error = original; }
});

test('falha na consulta de referências é informada separadamente', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await (await route({ rpcError: 'monitoramento_referencias_glass_ultimo' }).GET(new Request('http://localhost'))).json();
    assert.equal(result.referencias, null);
    assert.match(result.referenciasErro, /indisponível/);
    assert.ok(result.indices);
  } finally { console.error = original; }
});

test('falhas de configuração ou consulta não são relatadas como sucesso nem expõem detalhes', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const options of [{ configError: true }, { queryError: new Error('confidential settings') }]) {
      const response = await route(options).GET(new Request('http://localhost'));
      const result = await response.json();
      assert.equal(response.status, 503);
      assert.equal(result.status, 'indisponivel');
      assert.equal(result.tempoMs, undefined);
      assert.doesNotMatch(JSON.stringify(result), /confidential settings/);
    }
  } finally {
    console.error = original;
  }
});

test('falha das métricas não é confundida com indisponibilidade da conexão ou histórico vazio', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = await route({ rpcError: 'monitoramento_banco_glass_historico' }).GET(new Request('http://localhost'));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.status, 'disponivel');
    assert.equal(result.historico, null);
    assert.match(result.historicoErro, /indisponível/);
    assert.ok(result.integridade);
    assert.doesNotMatch(JSON.stringify(result), /confidential settings/);
  } finally { console.error = original; }
});

test('falha do Storage não oculta métricas do banco nem retorna tamanho fictício', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = await route({ rpcError: 'monitoramento_storage_glass_ultimo' }).GET(new Request('http://localhost'));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.storage, null);
    assert.match(result.storageErro, /indisponível/);
    assert.equal(result.historico[0].metricas.banco_bytes, 338197217);
  } finally { console.error = original; }
});

test('rejeita respostas inválidas e preserva valores nulos de métricas não disponíveis', () => {
  assert.equal(validators.validarHistorico(amostras), true);
  assert.equal(validators.validarHistorico([{ ...amostras[0], metricas: { ...metricas, cache_percentual: null } }]), true);
  assert.equal(validators.validarHistorico([{ ...amostras[0], metricas: { ...metricas, banco_bytes: -1 } }]), false);
  assert.equal(validators.validarIntegridade(integridade), true);
  assert.equal(validators.validarIntegridade({ ...integridade, tabelas: [{ nome: 'ficticia', status: 'sem_problemas_detectados', ocorrencias_primeiro_bloco: 1 }] }), false);
  assert.equal(validators.validarStorage(storage), true);
  assert.equal(validators.validarStorage({ ...storage, objetos_sem_tamanho: 5 }), false);
  assert.equal(validators.validarStorage({ ...storage, bytes_conhecidos: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(validators.validarIndices(indices), true);
  assert.equal(validators.validarIndices({ ...indices, indices: [{ nome: 'x', status: 'erro_verificacao' }] }), false);
  assert.equal(validators.validarIndices({ ...indices, indices: [{ nome: 'x', status: 'indice_invalido' }] }), true);
  assert.equal(validators.validarReferencias(referencias), true);
  assert.equal(validators.validarReferencias({ ...referencias, arquivos: [] }), false);
  assert.equal(validators.validarReferencias({ ...referencias, arquivos: [referencias.arquivos[0], referencias.arquivos[0], ...referencias.arquivos.slice(2)] }), false);
  assert.equal(validators.validarReferencias({ ...referencias, arquivos: [{ ...referencias.arquivos[0], sem_metadados: 3 }, ...referencias.arquivos.slice(1)] }), false);
  assert.equal(validators.validarReferencias({ ...referencias, regras: [] }), false);
  assert.equal(validators.validarListaTabelas(listaTabelas), true);
  assert.equal(validators.validarListaTabelas({ ...listaTabelas, tabelas: [{ ...listaTabelas.tabelas[0], tipo: 'externa', bytes: null }] }), true);
  assert.equal(validators.validarListaTabelas({ ...listaTabelas, tabelas: [listaTabelas.tabelas[0], listaTabelas.tabelas[0]] }), false);
  assert.equal(validators.validarListaTabelas({ ...listaTabelas, tabelas: [{ ...listaTabelas.tabelas[0], bytes: -1 }] }), false);
});

test('painel distingue a verificação de leitura de backup e exibe falhas no histórico', () => {
  const code = ts.transpileModule(readFileSync('src/app/configuracoes/monitoramento-glass/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const history = [
    { status: 'disponivel', verificadoEm: '2026-11-25T18:00:00.000Z', tempoMs: 42 },
    { status: 'indisponivel', verificadoEm: '2026-11-25T18:01:00.000Z' },
  ];
  const states = [history, 'Falha ao consultar o Glass.', false, { historico: amostras, historicoErro: null, integridade, integridadeErro: null, storage, storageErro: null, indices, indicesErro: null, referencias, referenciasErro: null, infra, infraErro: null }, true, 0, { status: 'pronto', lista: listaTabelas }, [{ consultadoEm: infra.consultado_em, cpu: 25, memoria: 60 }]];
  const dependencies = {
    'react/jsx-runtime': jsxRuntime,
    react: {
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: () => [states.shift(), () => {}],
    },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/supabase-browser': { createSupabaseBrowser: () => ({}) },
    '@/lib/monitoramento-glass': validators,
    '@/lib/monitoramento-infra': infraLib,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (!(id in dependencies)) throw new Error(`Missing mock ${id}`);
    return dependencies[id];
  }, module, module.exports);
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(html, /Consulta falhou/);
  assert.match(html, /42ms/);
  assert.match(html, /histórico não é salvo/);
  assert.match(html, /Integridade estrutural das tabelas/);
  assert.match(html, /Integridade dos índices B-tree/);
  assert.match(html, /Não foi possível verificar \(42501\)/);
  assert.match(html, /Sem teste registrado/);
  assert.match(html, /Chaves estrangeiras ainda não validadas/);
  assert.match(html, /Possível violação/);
  assert.match(html, /1 sem metadados em 2 registros/);
  assert.match(html, /Empresa do histórico e do orçamento/);
  assert.match(html, /Possível inconsistência/);
  assert.match(html, /Outras regras de negócio, outros relacionamentos sem chave estrangeira/);
  assert.match(html, /tabela_15/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Uso de CPU/);
  assert.match(html, /25%/);
  assert.match(html, /60%/);
  assert.match(html, /ficticia/);
  assert.match(html, /338,2 MB/);
  assert.match(html, /Parcial: 300 MB/);
  assert.match(html, /1 objeto\(s\) sem tamanho válido/);
  assert.match(html, /não garante ausência de toda corrupção/);
});

test('card recolhe e expande a lista completa', () => {
  const states = [[], '', false, null, true, 0, { status: 'pronto', lista: listaTabelas }, []];
  let hook = 0;
  const dependencies = {
    'react/jsx-runtime': jsxRuntime,
    react: {
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: () => {
        const index = hook++;
        return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update; }];
      },
    },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/supabase-browser': { createSupabaseBrowser: () => ({}) },
    '@/lib/monitoramento-glass': validators,
    '@/lib/monitoramento-infra': infraLib,
  };
  const Page = load('src/app/configuracoes/monitoramento-glass/page.tsx', dependencies).default;
  function render() { hook = 0; return Page(); }
  function findButton(element) {
    if (!React.isValidElement(element)) return undefined;
    if (element.type === 'button' && element.props['aria-controls'] === 'lista-tabelas-publicas') return element;
    for (const child of React.Children.toArray(element.props.children)) {
      const found = findButton(child);
      if (found) return found;
    }
  }
  let tree = render();
  assert.match(renderToStaticMarkup(tree), /tabela_15/);
  findButton(tree).props.onClick();
  tree = render();
  assert.equal(findButton(tree).props['aria-expanded'], false);
  assert.doesNotMatch(renderToStaticMarkup(tree), /tabela_15/);
  findButton(tree).props.onClick();
  tree = render();
  assert.equal(findButton(tree).props['aria-expanded'], true);
  assert.match(renderToStaticMarkup(tree), /tabela_15/);
  states[3] = { historico: amostras, historicoErro: null, integridade: null, integridadeErro: null, storage: null, storageErro: null, indices: null, indicesErro: null, referencias: null, referenciasErro: null };
  states[6] = { status: 'erro', mensagem: 'Lista completa indisponível.' };
  const fallback = renderToStaticMarkup(render());
  assert.match(fallback, /Lista completa indisponível/);
  assert.match(fallback, /Exibindo apenas as maiores da coleta/);
  assert.match(fallback, /ficticia/);
  assert.doesNotMatch(fallback, /tabela_15/);
});
