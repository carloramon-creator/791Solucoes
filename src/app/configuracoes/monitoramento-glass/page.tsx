'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { validarHistorico, validarIndices, validarIntegridade, validarListaTabelas, validarReferencias, validarStorage, type AmostraBanco, type AmostraStorage, type ListaTabelas, type ResultadoIndices, type ResultadoIntegridade, type ResultadoReferencias } from '@/lib/monitoramento-glass';

type Verificacao = {
  status: 'disponivel' | 'indisponivel';
  verificadoEm: string;
  tempoMs?: number;
};

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
});
const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const diaChave = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const numero = new Intl.NumberFormat('pt-BR');
const nomesRegras: Record<string, string> = {
  orcamento_anexo_empresa: 'Empresa do anexo e do orçamento',
  orcamento_historico_empresa: 'Empresa do histórico e do orçamento',
  financeiro_anexo_empresa: 'Empresa do anexo e do lançamento',
  financeiro_anexo_baixa: 'Baixa, lançamento e empresa do anexo',
};
const bytes = (valor: number) => {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let tamanho = valor;
  let unidade = 0;
  while (tamanho >= 1000 && unidade < unidades.length - 1) {
    tamanho /= 1000;
    unidade++;
  }
  return `${numero.format(Math.round(tamanho * 100) / 100)} ${unidades[unidade]}`;
};

type DadosBanco = {
  historico: AmostraBanco[] | null;
  historicoErro: string | null;
  integridade: ResultadoIntegridade | null;
  integridadeErro: string | null;
  storage: AmostraStorage | null;
  storageErro: string | null;
  indices: ResultadoIndices | null;
  indicesErro: string | null;
  referencias: ResultadoReferencias | null;
  referenciasErro: string | null;
};

function Cartao({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5">
    <p className="text-xs font-bold uppercase text-slate-500">{titulo}</p>
    <p className="mt-2 text-xl font-bold text-slate-800">{valor}</p>
    <p className="mt-1 text-xs text-slate-500">{detalhe}</p>
  </div>;
}

export default function MonitoramentoGlassPage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [historico, setHistorico] = useState<Verificacao[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [dadosBanco, setDadosBanco] = useState<DadosBanco | null>(null);
  const [tabelasAbertas, setTabelasAbertas] = useState(true);
  const [atualizacaoTabelas, setAtualizacaoTabelas] = useState(0);
  const [listaTabelas, setListaTabelas] = useState<{ status: 'carregando' } | { status: 'erro'; mensagem: string } | { status: 'pronto'; lista: ListaTabelas }>({ status: 'carregando' });
  const emAndamento = useRef(false);
  const montado = useRef(false);

  const verificar = useCallback(async () => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setCarregando(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) throw new Error('Sessão expirada. Entre novamente.');

      const response = await fetch('/api/admin/monitoramento-glass', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok && result.status !== 'indisponivel') {
        throw new Error(result.error || 'Não foi possível verificar a integração.');
      }
      if ((result.status !== 'disponivel' && result.status !== 'indisponivel')
        || typeof result.verificadoEm !== 'string' || !Number.isFinite(Date.parse(result.verificadoEm))
        || (result.status === 'disponivel' && (typeof result.tempoMs !== 'number' || !Number.isFinite(result.tempoMs) || result.tempoMs < 0))
        || (response.ok !== (result.status === 'disponivel'))) {
        throw new Error('A resposta do monitoramento é inválida.');
      }
      if (!montado.current) return;
      setHistorico(atual => [...atual, {
        status: result.status,
        verificadoEm: result.verificadoEm,
        ...(result.status === 'disponivel' ? { tempoMs: result.tempoMs } : {}),
      }].slice(-20));
      setErro(response.ok ? '' : result.error);
      if (response.ok) {
        if (!(result.historico === null || validarHistorico(result.historico))
          || !validarIntegridade(result.integridade)
          || !validarStorage(result.storage)
          || !validarIndices(result.indices)
          || !validarReferencias(result.referencias)
          || !(result.historicoErro === null || typeof result.historicoErro === 'string')
          || !(result.integridadeErro === null || typeof result.integridadeErro === 'string')
          || !(result.storageErro === null || typeof result.storageErro === 'string')
          || !(result.indicesErro === null || typeof result.indicesErro === 'string')
          || !(result.referenciasErro === null || typeof result.referenciasErro === 'string')) {
          throw new Error('Os dados do banco retornados são inválidos.');
        }
        setDadosBanco({
          historico: result.historico,
          historicoErro: result.historicoErro,
          integridade: result.integridade,
          integridadeErro: result.integridadeErro,
          storage: result.storage,
          storageErro: result.storageErro,
          indices: result.indices,
          indicesErro: result.indicesErro,
          referencias: result.referencias,
          referenciasErro: result.referenciasErro,
        });
      } else {
        setDadosBanco(null);
      }
    } catch (error) {
      if (montado.current) {
        setDadosBanco(null);
        setErro(error instanceof Error ? error.message : 'Não foi possível verificar a integração.');
      }
    } finally {
      emAndamento.current = false;
      if (montado.current) setCarregando(false);
    }
  }, [supabase]);

  useEffect(() => {
    montado.current = true;
    const inicial = setTimeout(() => void verificar(), 0);
    const timer = setInterval(() => void verificar(), 60000);
    return () => {
      montado.current = false;
      clearTimeout(inicial);
      clearInterval(timer);
    };
  }, [verificar]);

  useEffect(() => {
    if (!tabelasAbertas) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setListaTabelas({ status: 'carregando' });
      void (async () => {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) throw new Error('Sessão expirada. Entre novamente.');
          const response = await fetch('/api/admin/monitoramento-glass?tabelas=1', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
            cache: 'no-store',
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Não foi possível consultar todas as tabelas.');
          if (!validarListaTabelas(result.lista)) throw new Error('A lista de tabelas retornada é inválida.');
          if (!controller.signal.aborted) setListaTabelas({ status: 'pronto', lista: result.lista });
        } catch (error) {
          if (!controller.signal.aborted) setListaTabelas({
            status: 'erro',
            mensagem: error instanceof Error ? error.message : 'Não foi possível consultar todas as tabelas.',
          });
        }
      })();
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [supabase, tabelasAbertas, atualizacaoTabelas]);

  const ultima = historico.at(-1);
  const tempos = historico.flatMap(item => item.tempoMs === undefined ? [] : [item.tempoMs]);
  const maximo = Math.max(1, ...tempos);
  const amostras = dadosBanco?.historico ?? [];
  const ultimaAmostra = amostras.at(-1);
  const metricas = ultimaAmostra?.metricas;
  const tabelasExibidas = listaTabelas.status === 'pronto' ? listaTabelas.lista.tabelas
    : listaTabelas.status === 'erro' ? metricas?.maiores_tabelas : undefined;
  const dias = new Map<string, AmostraBanco>();
  for (const amostra of amostras) dias.set(diaChave.format(new Date(amostra.coletado_em)), amostra);
  const diarias = Array.from(dias.values()).slice(-30);
  const maiorBanco = Math.max(1, ...diarias.map(item => item.metricas.banco_bytes));
  const integridade = dadosBanco?.integridade;
  const problemas = integridade?.tabelas.filter(t => t.status === 'problemas') ?? [];
  const errosIntegridade = integridade?.tabelas.filter(t => t.status === 'erro_verificacao') ?? [];
  const semProblemas = integridade?.tabelas.filter(t => t.status === 'sem_problemas_detectados') ?? [];
  const verificadoMs = ultima ? new Date(ultima.verificadoEm).getTime() : null;
  const integridadeAntiga = integridade && verificadoMs !== null && verificadoMs - new Date(integridade.concluido_em).getTime() > 48 * 60 * 60 * 1000;
  const metricasAntigas = ultimaAmostra && verificadoMs !== null && verificadoMs - new Date(ultimaAmostra.coletado_em).getTime() > 2 * 60 * 60 * 1000;
  const storage = dadosBanco?.storage;
  const storageAntigo = storage && verificadoMs !== null && verificadoMs - new Date(storage.coletado_em).getTime() > 2 * 60 * 60 * 1000;
  const indices = dadosBanco?.indices;
  const indicesAntigos = indices && verificadoMs !== null && verificadoMs - new Date(indices.concluido_em).getTime() > 48 * 60 * 60 * 1000;
  const referencias = dadosBanco?.referencias;
  const referenciasAntigas = referencias && verificadoMs !== null && verificadoMs - new Date(referencias.concluido_em).getTime() > 48 * 60 * 60 * 1000;

  return <main className="space-y-5 pb-12">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Monitoramento do Glass</h1>
        <p className="mt-1 text-sm text-slate-500">Conexão da Holding com a API de dados do Supabase do Glass.</p>
      </div>
      <div className="flex gap-2">
        <Link href="/configuracoes" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600">Voltar</Link>
        <button type="button" onClick={() => void verificar()} disabled={carregando} className="rounded-lg bg-[#3b597b] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {carregando ? 'Verificando...' : 'Verificar agora'}
        </button>
      </div>
    </header>

    {erro && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</p>}

    <section className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-bold uppercase text-slate-500">Última verificação do Glass</p>
        <p className={`mt-2 text-xl font-bold ${ultima?.status === 'disponivel' && !erro ? 'text-emerald-700' : 'text-slate-700'}`}>
          {erro && ultima?.status !== 'indisponivel' ? 'Não verificado' : ultima ? ultima.status === 'disponivel' ? 'Consulta realizada' : 'Consulta falhou' : 'Ainda não verificado'}
        </p>
        <p className="mt-1 text-xs text-slate-500">{ultima ? dataHora.format(new Date(ultima.verificadoEm)) : 'Aguardando verificação'}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-bold uppercase text-slate-500">Tempo da última consulta</p>
        <p className="mt-2 text-xl font-bold text-slate-800">{!erro && ultima?.tempoMs !== undefined ? `${ultima.tempoMs} ms` : 'Não disponível'}</p>
        <p className="mt-1 text-xs text-slate-500">Inclui a obtenção da configuração na Holding.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-bold uppercase text-slate-500">Verificações nesta tela</p>
        <p className="mt-2 text-xl font-bold text-slate-800">{historico.length}</p>
        <p className="mt-1 text-xs text-slate-500">Atualiza a cada minuto enquanto a página estiver aberta.</p>
      </div>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-800">Tempo de resposta das últimas verificações</h2>
      <p className="mt-1 text-xs text-slate-500">Até 20 medições nesta página; falhas aparecem em vermelho. O histórico não é salvo.</p>
      {historico.length ? <div className="mt-4 flex h-36 items-end gap-2 overflow-x-auto" aria-label="Histórico de verificações">
        {historico.map((item, index) => <div key={`${item.verificadoEm}-${index}`} className="flex min-w-8 flex-col items-center justify-end gap-1">
          <span className="text-[10px] text-slate-600">{item.tempoMs === undefined ? 'Falha' : `${item.tempoMs}ms`}</span>
          <div className={`w-6 rounded-t ${item.status === 'disponivel' ? 'bg-emerald-500' : 'bg-red-500'}`}
            style={{ height: item.tempoMs === undefined ? 12 : Math.max(8, Math.round(item.tempoMs / maximo * 90)) }}
            title={`${dataHora.format(new Date(item.verificadoEm))}: ${item.tempoMs === undefined ? 'falhou' : `${item.tempoMs} ms`}`} />
        </div>)}
      </div> : <p className="mt-4 text-sm text-slate-500">Nenhuma verificação concluída nesta página.</p>}
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Banco de dados do Glass</h2>
        <p className="mt-1 text-sm text-slate-500">Coletas horárias; histórico de 30 dias. Não representam espaço total do disco ou dos arquivos no Storage.</p>
      </div>
      {dadosBanco?.historicoErro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{dadosBanco.historicoErro}</p>}
      {metricasAntigas && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">A última coleta tem mais de duas horas. Verifique o agendamento no Supabase.</p>}
      {dadosBanco?.storageErro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{dadosBanco.storageErro}</p>}
      {storageAntigo && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">A última coleta do Storage tem mais de duas horas. Verifique o agendamento no Supabase.</p>}
      {storage && storage.objetos_sem_tamanho > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">O tamanho do Storage é parcial: {numero.format(storage.objetos_sem_tamanho)} objeto(s) sem tamanho válido nos metadados.</p>}
      {ultimaAmostra && <p className="text-xs text-slate-500">Última coleta: {dataHora.format(new Date(ultimaAmostra.coletado_em))}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Cartao titulo="Tamanho do banco" valor={metricas ? bytes(metricas.banco_bytes) : 'Não disponível'} detalhe="Tamanho do banco PostgreSQL, não do disco completo." />
        <Cartao titulo="Storage" valor={storage && (storage.objetos === 0 || storage.objetos_sem_tamanho < storage.objetos) ? `${storage.objetos_sem_tamanho ? 'Parcial: ' : ''}${bytes(storage.bytes_conhecidos)}` : 'Não disponível'}
          detalhe={storage ? `${numero.format(storage.objetos)} objetos; coleta em ${dataHora.format(new Date(storage.coletado_em))}.` : 'Aguardando coleta dos metadados dos arquivos.'} />
        <Cartao titulo="Tabelas públicas" valor={metricas ? numero.format(metricas.tabelas_publicas) : 'Não disponível'} detalhe="Tabelas físicas e visões materializadas do esquema public." />
        <Cartao titulo="Conexões do banco" valor={metricas ? numero.format(metricas.conexoes) : 'Não disponível'} detalhe={metricas ? `${metricas.conexoes_ativas === null ? 'Ativas não disponíveis' : `${numero.format(metricas.conexoes_ativas)} ativas`}; limite do servidor ${numero.format(metricas.limite_conexoes_servidor)}.` : 'Aguardando coleta.'} />
        <Cartao titulo="Aguardando bloqueio" valor={metricas?.aguardando_bloqueio != null ? numero.format(metricas.aguardando_bloqueio) : 'Não disponível'} detalhe="Sessões clientes esperando por bloqueio no momento da coleta." />
        <Cartao titulo="Acertos de cache" valor={metricas?.cache_percentual != null ? `${numero.format(metricas.cache_percentual)}%` : 'Não disponível'} detalhe="Estatística acumulada do PostgreSQL desde o último reset." />
        <Cartao titulo="Linhas mortas" valor={metricas?.linhas_mortas_estimadas != null ? numero.format(metricas.linhas_mortas_estimadas) : 'Não disponível'} detalhe="Estimativa das tabelas públicas; não indica corrupção." />
        <Cartao titulo="Restrições não validadas" valor={metricas ? numero.format(metricas.restricoes_nao_validadas) : 'Não disponível'} detalhe="Restrições do esquema public pendentes de validação; não confirma erro nos dados." />
      </div>
      <p className="text-xs text-slate-500">O Storage soma os tamanhos presentes nos metadados de storage.objects; não é verificação dos arquivos nem representa outras categorias de uso ou a cobrança oficial.</p>
      {dadosBanco?.historico && amostras.length === 0 && <p className="text-sm text-slate-500">Ainda não há coletas registradas.</p>}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-bold text-slate-800">Evolução do tamanho do banco</h3>
        <p className="mt-1 text-xs text-slate-500">Última coleta de cada dia, nos últimos 30 dias; lacunas indicam dias sem coleta.</p>
        {diarias.length ? <div className="mt-4 flex h-40 items-end gap-2 overflow-x-auto" aria-label="Tamanho do banco por dia">
          {diarias.map(item => <div key={item.coletado_em} className="flex min-w-10 flex-col items-center justify-end gap-1">
            <div className="w-7 rounded-t bg-[#3b597b]" style={{ height: Math.max(8, Math.round(item.metricas.banco_bytes / maiorBanco * 105)) }}
              title={`${dataHora.format(new Date(item.coletado_em))}: ${bytes(item.metricas.banco_bytes)}`} />
            <span className="text-[10px] text-slate-500">{dia.format(new Date(item.coletado_em))}</span>
          </div>)}
        </div> : <p className="mt-4 text-sm text-slate-500">Sem dados para o gráfico.</p>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h3><button type="button" aria-expanded={tabelasAbertas} aria-controls="lista-tabelas-publicas"
          onClick={() => setTabelasAbertas(aberto => !aberto)}
          className="flex w-full items-center justify-between gap-3 p-5 text-left font-bold text-slate-800">
          <span>Tabelas públicas</span><span className="text-sm text-slate-500">{tabelasAbertas ? 'Recolher' : 'Expandir'}</span>
        </button></h3>
        <div id="lista-tabelas-publicas" hidden={!tabelasAbertas}>
        {tabelasAbertas && <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
            <p className="text-xs text-slate-500">{listaTabelas.status === 'pronto'
              ? `${numero.format(listaTabelas.lista.tabelas.length)} itens · consulta em ${dataHora.format(new Date(listaTabelas.lista.consultado_em))}.`
              : listaTabelas.status === 'erro' && ultimaAmostra ? `Exibindo apenas as maiores da coleta de ${dataHora.format(new Date(ultimaAmostra.coletado_em))}.` : 'Consulta da lista completa sob demanda.'}</p>
            <button type="button" onClick={() => setAtualizacaoTabelas(atual => atual + 1)}
              disabled={listaTabelas.status === 'carregando'} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 disabled:opacity-50">Atualizar lista</button>
          </div>
          {listaTabelas.status === 'carregando' && <p className="px-5 pb-4 text-sm text-slate-500">Carregando todas as tabelas...</p>}
          {listaTabelas.status === 'erro' && <p role="alert" className="mx-5 mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{listaTabelas.mensagem}</p>}
          {tabelasExibidas && <>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Tabela</th><th className="p-3">Tamanho com índices</th><th className="p-3">Linhas vivas estimadas</th><th className="p-3">Linhas mortas estimadas</th><th className="p-3">Último autovacuum</th></tr></thead>
              <tbody>{tabelasExibidas.map(t => <tr key={t.nome} className="border-t border-slate-100">
                <td className="p-3">{t.nome}{'tipo' in t && t.tipo !== 'tabela' ? ` (${t.tipo})` : ''}</td>
                <td className="p-3">{t.bytes === null ? 'Não disponível' : bytes(t.bytes)}</td>
                <td className="p-3">{t.linhas_vivas_estimadas === null ? 'Não disponível' : numero.format(t.linhas_vivas_estimadas)}</td>
                <td className="p-3">{t.linhas_mortas_estimadas === null ? 'Não disponível' : numero.format(t.linhas_mortas_estimadas)}</td>
                <td className="p-3">{t.ultimo_autovacuum ? dataHora.format(new Date(t.ultimo_autovacuum)) : 'Não informado'}</td>
              </tr>)}</tbody>
            </table>
            {!tabelasExibidas.length && <p className="p-5 text-sm text-slate-500">Nenhuma tabela disponível.</p>}
          </>}
          <p className="px-5 pb-4 pt-3 text-xs text-slate-500">Inclui tabelas físicas, particionadas e externas e visões materializadas de public. Tamanho de tabelas particionadas e externas não é informado; as partições físicas aparecem separadamente.</p>
        </>}
        </div>
      </div>
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Integridade estrutural das tabelas</h2>
        <p className="mt-1 text-sm text-slate-500">Verificação diária às 3h de Brasília usando amcheck nas tabelas heap do esquema public.</p>
      </div>
      {dadosBanco?.integridadeErro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{dadosBanco.integridadeErro}</p>}
      {integridadeAntiga && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">A última verificação tem mais de 48 horas. Confira a execução agendada no Supabase.</p>}
      {problemas.length > 0 && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Foram detectados possíveis problemas estruturais em {numero.format(problemas.length)} tabela(s). Investigue com o suporte antes de qualquer reparo.</p>}
      {errosIntegridade.length > 0 && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Não foi possível verificar {numero.format(errosIntegridade.length)} tabela(s). Confira os códigos na lista e os logs no Supabase.</p>}
      {!integridade && !dadosBanco?.integridadeErro && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Nenhuma verificação concluída disponível.</p>}
      {integridade && <>
        <p className="text-xs text-slate-500">Concluída em {dataHora.format(new Date(integridade.concluido_em))} · {numero.format(integridade.tabelas.length)} tabelas verificadas ou tentadas.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Cartao titulo="Sem problemas detectados" valor={numero.format(semProblemas.length)} detalhe="Somente no escopo verificado pelo amcheck." />
          <Cartao titulo="Problemas detectados" valor={numero.format(problemas.length)} detalhe="Tabelas com ocorrências estruturais detectadas." />
          <Cartao titulo="Falha ao verificar" valor={numero.format(errosIntegridade.length)} detalhe="Não são consideradas íntegras nem corrompidas." />
        </div>
        {integridade.tabelas.length > 0 && <figure className="rounded-xl border border-slate-200 bg-white p-5">
          <figcaption className="font-bold text-slate-800">Resultado da última verificação</figcaption>
          <div className="mt-4 flex h-5 overflow-hidden rounded-full" aria-label={`${semProblemas.length} sem problemas detectados, ${problemas.length} com problemas, ${errosIntegridade.length} sem verificação`}>
            <div className="bg-emerald-500" style={{ width: `${semProblemas.length / integridade.tabelas.length * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${problemas.length / integridade.tabelas.length * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${errosIntegridade.length / integridade.tabelas.length * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-600">Sem problemas detectados: {numero.format(semProblemas.length)} · Problemas: {numero.format(problemas.length)} · Falhas de verificação: {numero.format(errosIntegridade.length)}</p>
        </figure>}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Tabela</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{integridade.tabelas.map(t => <tr key={t.nome} className="border-t border-slate-100">
              <td className="p-3">{t.nome}</td><td className="p-3">{t.status === 'sem_problemas_detectados' ? 'Sem problemas detectados' : t.status === 'problemas' ? 'Problema detectado' : `Não foi possível verificar (${t.codigo})`}</td>
            </tr>)}</tbody>
          </table>
          {!integridade.tabelas.length && <p className="p-5 text-sm text-slate-500">Nenhuma tabela compatível foi verificada.</p>}
        </div>
      </>}
      <p className="text-xs text-slate-500">O teste examina a estrutura das tabelas heap, parando no primeiro bloco com problemas. Não verifica índices, valores TOAST, arquivos do Storage, lógica dos dados ou backups; um resultado sem problemas não garante ausência de toda corrupção.</p>
    </section>
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Integridade dos índices B-tree</h2>
        <p className="mt-1 text-sm text-slate-500">Verificação diária às 4h de Brasília, separada do teste de tabelas.</p>
      </div>
      {dadosBanco?.indicesErro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{dadosBanco.indicesErro}</p>}
      {indicesAntigos && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">A última verificação de índices tem mais de 48 horas. Confira o agendamento no Supabase.</p>}
      {!indices && !dadosBanco?.indicesErro && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Nenhuma verificação concluída disponível.</p>}
      {indices && <>
        <p className="text-xs text-slate-500">Concluída em {dataHora.format(new Date(indices.concluido_em))} · {numero.format(indices.indices.length)} índices identificados.</p>
        {indices.indices.some(i => i.status !== 'sem_problemas_detectados') && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Há índices com problemas, inválidos ou não verificados. Investigue antes de qualquer reparo.</p>}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Índice</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{indices.indices.map(i => <tr key={i.nome} className="border-t border-slate-100">
              <td className="p-3">{i.nome}</td><td className="p-3">{i.status === 'sem_problemas_detectados' ? 'Sem problemas detectados' : i.status === 'indice_invalido' ? 'Índice inválido ou não pronto; não verificado' : i.status === 'problemas' ? `Possível corrupção (${i.codigo})` : `Não foi possível verificar (${i.codigo})`}</td>
            </tr>)}</tbody>
          </table>
          {!indices.indices.length && <p className="p-5 text-sm text-slate-500">Nenhum índice B-tree compatível identificado.</p>}
        </div>
      </>}
      <p className="text-xs text-slate-500">Examina somente índices B-tree físicos de public; não verifica a correspondência de todas as linhas da tabela com o índice nem garante ausência de corrupção.</p>
    </section>
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Relacionamentos e referências de arquivos</h2>
        <p className="mt-1 text-sm text-slate-500">Verificação diária às 6h de Brasília. Resultados são indícios para investigação, não reparos automáticos.</p>
      </div>
      {dadosBanco?.referenciasErro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{dadosBanco.referenciasErro}</p>}
      {referenciasAntigas && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">A última verificação de referências tem mais de 48 horas. Confira o agendamento no Supabase.</p>}
      {!referencias && !dadosBanco?.referenciasErro && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Nenhuma verificação concluída disponível.</p>}
      {referencias && <>
        <p className="text-xs text-slate-500">Concluída em {dataHora.format(new Date(referencias.concluido_em))}.</p>
        {referencias.relacionamentos.some(r => r.status !== 'sem_ocorrencias') && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Há possíveis violações ou falhas na verificação de relacionamentos pendentes.</p>}
        {referencias.arquivos.some(a => a.status === 'erro_verificacao' || (a.status === 'verificado' && a.sem_metadados > 0)) && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Há referências sem metadados no Storage ou fontes não verificadas. Confira os detalhes antes de qualquer ação.</p>}
        {referencias.regras.some(r => r.status !== 'sem_ocorrencias') && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Há possíveis inconsistências ou falhas nas regras verificadas.</p>}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold text-slate-800">Chaves estrangeiras ainda não validadas</h3>
          <p className="mt-1 text-xs text-slate-500">Somente restrições NOT VALID do esquema public. Sem ocorrências não valida a restrição nem cobre relacionamentos sem chave estrangeira.</p>
          {referencias.relacionamentos.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nenhuma chave estrangeira pendente de validação encontrada.</p> :
            <table className="mt-3 w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Tabela e restrição</th><th className="p-3">Resultado</th></tr></thead>
              <tbody>{referencias.relacionamentos.map(r => <tr key={`${r.tabela}:${r.restricao}`} className="border-t border-slate-100">
                <td className="p-3">{r.tabela} · {r.restricao}</td><td className="p-3">{r.status === 'erro_verificacao' ? `Não foi possível verificar (${r.codigo})` : r.status === 'possivel_violacao' ? 'Possível violação' : 'Sem ocorrências detectadas'}</td>
              </tr>)}</tbody>
            </table>}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold text-slate-800">Regras de vínculo entre registros</h3>
          <p className="mt-1 text-xs text-slate-500">Apenas as quatro regras listadas, baseadas nos vínculos de orçamento e financeiro. Não substituem a verificação de todas as regras de negócio.</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Regra</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{referencias.regras.map(r => <tr key={r.nome} className="border-t border-slate-100">
              <td className="p-3">{nomesRegras[r.nome] ?? r.nome}</td><td className="p-3">{r.status === 'erro_verificacao' ? `Não foi possível verificar (${r.codigo})` : r.status === 'possivel_violacao' ? 'Possível inconsistência' : 'Sem ocorrências detectadas'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold text-slate-800">Referências de anexos ao Storage</h3>
          <p className="mt-1 text-xs text-slate-500">Somente anexos de orçamento, OS, financeiro e chat interno criados há mais de uma hora. Compara os caminhos com os metadados; não confirma a existência física nem inclui todos os arquivos. Ausências podem ser temporárias.</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Fonte</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{referencias.arquivos.map(a => <tr key={a.tabela} className="border-t border-slate-100">
              <td className="p-3">{a.tabela}</td><td className="p-3">{a.status === 'erro_verificacao' ? `Não foi possível verificar (${a.codigo})` : `${numero.format(a.sem_metadados)} sem metadados em ${numero.format(a.registros)} registros`}</td>
            </tr>)}</tbody>
          </table>
          {!referencias.arquivos.length && <p className="mt-3 text-sm text-slate-500">Nenhuma fonte de arquivos verificada.</p>}
        </div>
      </>}
    </section>
    <section className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800">Verificações ainda não disponíveis</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Cartao titulo="Backup e restauração" valor="Sem teste registrado" detalhe="Este painel ainda não monitora backups no Drive nem testes de restauração." />
        <Cartao titulo="Dados e arquivos" valor="Cobertura parcial" detalhe="Outras regras de negócio, outros relacionamentos sem chave estrangeira e existência física dos arquivos não são verificados por este painel." />
      </div>
    </section>
  </main>;
}
