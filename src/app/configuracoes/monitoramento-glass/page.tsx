'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import type { BackupArquivoDrive, BackupStatus } from '@/lib/backup-glass';
import { validarHistorico, validarIndices, validarIntegridade, validarListaTabelas, validarReferencias, validarStorage, type AmostraBanco, type AmostraStorage, type ListaTabelas, type ResultadoIndices, type ResultadoIntegridade, type ResultadoReferencias } from '@/lib/monitoramento-glass';
import { alertaSustentado, percentualCpu, taxasDisco, validarInfra, type DispositivoAmostra, type InfraAmostra, type LeituraAlerta } from '@/lib/monitoramento-infra';

type Verificacao = {
  status: 'disponivel' | 'indisponivel';
  verificadoEm: string;
  tempoMs?: number;
};

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
});
const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
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
  infra: InfraAmostra | null;
  infraErro: string | null;
};

function Cartao({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-xs font-bold uppercase text-slate-500">{titulo}</p>
    <p className="mt-1 text-xl font-bold text-slate-800">{valor}</p>
    <p className="mt-1 text-xs text-slate-500">{detalhe}</p>
  </div>;
}

// ─── Estado e lógica do botão de backup ──────────────────────────────────────

const faseLabel: Record<BackupStatus['fase'], string> = {
  ocioso: 'Fazer backup agora',
  exportando: 'Exportando banco...',
  enviando: 'Enviando para o Drive...',
  concluido: 'Fazer backup agora',
  erro: 'Tentar novamente',
};

function PainelBackup({ supabase }: { supabase: ReturnType<typeof createSupabaseBrowser> }) {
  const [statusBackup, setStatusBackup] = useState<BackupStatus>({ fase: 'ocioso' });
  const [erroBackup, setErroBackup] = useState('');
  const [disparando, setDisparando] = useState(false);
  const [arquivos, setArquivos] = useState<BackupArquivoDrive[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [erroLista, setErroLista] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pararPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, []);

  const carregarLista = useCallback(async () => {
    setCarregandoLista(true);
    setErroLista('');
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) { setCarregandoLista(false); return; }
    try {
      const r = await fetch('/api/admin/backup-glass?lista=1', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: 'no-store',
      });
      const json = await r.json() as { status?: BackupStatus; arquivos?: BackupArquivoDrive[]; listaErro?: string | null; error?: string };
      if (!r.ok) { setErroLista(json.error ?? 'Erro ao carregar backups.'); return; }
      if (json.status) setStatusBackup(json.status);
      if (json.arquivos) setArquivos(json.arquivos);
      if (json.listaErro) setErroLista(json.listaErro);
    } catch {
      setErroLista('Não foi possível consultar a lista de backups no Drive.');
    } finally {
      setCarregandoLista(false);
    }
  }, [supabase]);

  const consultarStatus = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return;
    try {
      const r = await fetch('/api/admin/backup-glass', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: 'no-store',
      });
      const json = await r.json() as { status?: BackupStatus; error?: string };
      if (!r.ok) { setErroBackup(json.error ?? 'Erro ao consultar status.'); return; }
      if (json.status) {
        setStatusBackup(json.status);
        if (json.status.fase !== 'exportando' && json.status.fase !== 'enviando') {
          pararPolling();
          setDisparando(false);
          if (json.status.fase === 'concluido') {
            void carregarLista();
          }
        }
      }
    } catch { /* polling silencioso */ }
  }, [supabase, pararPolling, carregarLista]);

  const dispararBackup = useCallback(async () => {
    setErroBackup('');
    setDisparando(true);
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) { setErroBackup('Sessão expirada.'); setDisparando(false); return; }
    try {
      const r = await fetch('/api/admin/backup-glass', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const json = await r.json() as { error?: string };
      if (!r.ok) { setErroBackup(json.error ?? 'Não foi possível iniciar o backup.'); setDisparando(false); return; }
      // Polling a cada 3 s enquanto estiver em andamento
      pollingRef.current = setInterval(() => void consultarStatus(), 3000);
    } catch { setErroBackup('Falha de comunicação ao iniciar o backup.'); setDisparando(false); }
  }, [supabase, consultarStatus]);

  useEffect(() => {
    void carregarLista();
    return () => pararPolling();
  }, [carregarLista, pararPolling]);

  const emAndamento = statusBackup.fase === 'exportando' || statusBackup.fase === 'enviando';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">Backup e restauração</p>
          {statusBackup.fase === 'ocioso' && (
            <p className="mt-1 text-sm text-slate-600">
              {arquivos.length > 0
                ? `✅ Último backup no Drive: ${dataHora.format(new Date(arquivos[0].criadoEm))} (${bytes(arquivos[0].tamanhoBytes)})`
                : 'Nenhum backup em execução no momento.'}
            </p>
          )}
          {statusBackup.fase === 'exportando' && (
            <p className="mt-1 text-sm text-slate-600">Exportando banco do Glass...</p>
          )}
          {statusBackup.fase === 'enviando' && (
            <p className="mt-1 text-sm text-slate-600">
              Enviando para o Drive ({Math.round(statusBackup.bytesExportados / 1024)} KB exportados)...
            </p>
          )}
          {statusBackup.fase === 'concluido' && (
            <p className="mt-1 text-sm text-slate-600">
              ✅ Concluído em {dataHora.format(new Date(statusBackup.concluidoEm))}{' '}
              · {Math.round(statusBackup.bytesExportados / 1024)} KB exportados
              {statusBackup.bytesEnviados ? ` · ${Math.round(statusBackup.bytesEnviados / 1024)} KB enviados (comprimido)` : ''}
            </p>
          )}
          {statusBackup.fase === 'erro' && (
            <p className="mt-1 text-sm text-red-700">❌ {statusBackup.mensagem}</p>
          )}
          {erroBackup && (
            <p role="alert" className="mt-1 text-sm text-red-700">{erroBackup}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void dispararBackup()}
          disabled={emAndamento || disparando}
          className="rounded-lg bg-[#3b597b] px-4 py-2 text-sm font-bold text-white disabled:opacity-50 whitespace-nowrap"
        >
          {emAndamento ? faseLabel[statusBackup.fase] : faseLabel[statusBackup.fase]}
        </button>
      </div>
      <div className="border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-bold uppercase text-slate-500">Backups salvos no Google Drive (últimos 30 · retenção de 90 dias)</p>
          <button
            type="button"
            onClick={() => void carregarLista()}
            disabled={carregandoLista}
            className="text-xs font-semibold text-[#3b597b] hover:underline disabled:opacity-50"
          >
            {carregandoLista ? 'Atualizando...' : 'Atualizar lista'}
          </button>
        </div>
        {erroLista && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{erroLista}</p>}
        {!erroLista && carregandoLista && arquivos.length === 0 && (
          <p className="text-xs text-slate-500">Consultando arquivos no Google Drive...</p>
        )}
        {!erroLista && !carregandoLista && arquivos.length === 0 && (
          <p className="text-xs text-slate-500">Nenhum backup encontrado na pasta do Drive.</p>
        )}
        {arquivos.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-2.5">Arquivo</th>
                  <th className="p-2.5">Data / Hora</th>
                  <th className="p-2.5 text-right">Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {arquivos.map(arq => (
                  <tr key={arq.id} className="border-t border-slate-100 text-slate-700">
                    <td className="p-2.5 font-mono">{arq.nome}</td>
                    <td className="p-2.5 whitespace-nowrap">{dataHora.format(new Date(arq.criadoEm))}</td>
                    <td className="p-2.5 text-right whitespace-nowrap">{bytes(arq.tamanhoBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Exportação lógica (schema + dados públicos e de autenticação). Objetos do Storage e configurações gerenciadas pelo Supabase não são incluídos neste backup. Restauração deve ser testada em projeto isolado.
      </p>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function MonitoramentoGlassPage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [historico, setHistorico] = useState<Verificacao[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [dadosBanco, setDadosBanco] = useState<DadosBanco | null>(null);
  const [tabelasAbertas, setTabelasAbertas] = useState(true);
  const [atualizacaoTabelas, setAtualizacaoTabelas] = useState(0);
  const [listaTabelas, setListaTabelas] = useState<{ status: 'carregando' } | { status: 'erro'; mensagem: string } | { status: 'pronto'; lista: ListaTabelas }>({ status: 'carregando' });
  const [historicoInfra, setHistoricoInfra] = useState<(LeituraAlerta & { taxas: DispositivoAmostra[] })[]>([]);
  const emAndamento = useRef(false);
  const montado = useRef(false);
  const infraAnterior = useRef<InfraAmostra | null>(null);

  const verificar = useCallback(async () => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setCarregando(true);
    const registrarFalhaInfra = () => {
      infraAnterior.current = null;
      setHistoricoInfra(atual => [...atual, { consultadoEm: new Date().toISOString(), cpu: null, memoria: null, taxas: [] }].slice(-20));
    };
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
          || !(result.infra === null || validarInfra(result.infra))
          || !(result.historicoErro === null || typeof result.historicoErro === 'string')
          || !(result.integridadeErro === null || typeof result.integridadeErro === 'string')
          || !(result.storageErro === null || typeof result.storageErro === 'string')
          || !(result.indicesErro === null || typeof result.indicesErro === 'string')
          || !(result.referenciasErro === null || typeof result.referenciasErro === 'string')
          || !(result.infraErro === null || typeof result.infraErro === 'string')) {
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
          infra: result.infra,
          infraErro: result.infraErro,
        });
        if (result.infra) {
          const infra: InfraAmostra = result.infra;
          const cpu = percentualCpu(infraAnterior.current, infra);
          const taxas = taxasDisco(infraAnterior.current, infra);
          infraAnterior.current = infra;
          const memoria = infra.memoria_total !== null && infra.memoria_disponivel !== null
            ? (1 - infra.memoria_disponivel / infra.memoria_total) * 100 : null;
          setHistoricoInfra(atual => [...atual, { consultadoEm: infra.consultado_em, cpu, memoria, taxas }].slice(-20));
        } else {
          registrarFalhaInfra();
        }
      } else {
        setDadosBanco(null);
        registrarFalhaInfra();
      }
    } catch (error) {
      if (montado.current) {
        setDadosBanco(null);
        registrarFalhaInfra();
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
  const infra = dadosBanco?.infra;
  const ultimaInfra = historicoInfra.at(-1);
  const percentual = (valor: number) => `${numero.format(Math.round(valor * 10) / 10)}%`;
  const alertas: string[] = [];
  if (infra) {
    if (alertaSustentado(historicoInfra, 'cpu')) alertas.push('CPU a partir de 80% por pelo menos 5 minutos nas leituras.');
    if (alertaSustentado(historicoInfra, 'memoria')) alertas.push('Memória a partir de 80% por pelo menos 5 minutos nas leituras.');
    for (const disco of infra.discos) {
      if (disco.total !== null && disco.disponivel !== null) {
        const uso = (1 - disco.disponivel / disco.total) * 100;
        if (disco.disponivel * 100 <= disco.total * 15) alertas.push(`Disco ${disco.ponto} com ${percentual(uso)} de uso (limite: 85%).`);
      }
    }
  }

  return <main className="space-y-4 pb-12">
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
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold uppercase text-slate-500">Última verificação do Glass</p>
        <p className={`mt-2 text-xl font-bold ${ultima?.status === 'disponivel' && !erro ? 'text-emerald-700' : 'text-slate-700'}`}>
          {erro && ultima?.status !== 'indisponivel' ? 'Não verificado' : ultima ? ultima.status === 'disponivel' ? 'Consulta realizada' : 'Consulta falhou' : 'Ainda não verificado'}
        </p>
        <p className="mt-1 text-xs text-slate-500">{ultima ? dataHora.format(new Date(ultima.verificadoEm)) : 'Aguardando verificação'}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold uppercase text-slate-500">Tempo da última consulta</p>
        <p className="mt-2 text-xl font-bold text-slate-800">{!erro && ultima?.tempoMs !== undefined ? `${ultima.tempoMs} ms` : 'Não disponível'}</p>
        <p className="mt-1 text-xs text-slate-500">Inclui a obtenção da configuração na Holding.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-bold uppercase text-slate-500">Verificações nesta tela</p>
        <p className="mt-2 text-xl font-bold text-slate-800">{historico.length}</p>
        <p className="mt-1 text-xs text-slate-500">Atualiza a cada minuto enquanto a página estiver aberta.</p>
      </div>
    </section>

    <details className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-bold text-slate-800">Tempo de resposta das últimas verificações</summary>
      <p className="mt-1 text-xs text-slate-500">Até 20 medições nesta página; falhas aparecem em vermelho. O histórico não é salvo.</p>
      {historico.length ? <div className="mt-4 flex h-36 items-end gap-2 overflow-x-auto" aria-label="Histórico de verificações">
        {historico.map((item, index) => <div key={`${item.verificadoEm}-${index}`} className="flex min-w-8 flex-col items-center justify-end gap-1">
          <span className="text-[10px] text-slate-600">{item.tempoMs === undefined ? 'Falha' : `${item.tempoMs}ms`}</span>
          <div className={`w-6 rounded-t ${item.status === 'disponivel' ? 'bg-emerald-500' : 'bg-red-500'}`}
            style={{ height: item.tempoMs === undefined ? 12 : Math.max(8, Math.round(item.tempoMs / maximo * 90)) }}
            title={`${dataHora.format(new Date(item.verificadoEm))}: ${item.tempoMs === undefined ? 'falhou' : `${item.tempoMs} ms`}`} />
        </div>)}
      </div> : <p className="mt-4 text-sm text-slate-500">Nenhuma verificação concluída nesta página.</p>}
    </details>

    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Desempenho do banco Glass</h2>
        <p className="mt-1 text-sm text-slate-500">CPU, memória e disco da instância principal do Supabase, não do aplicativo no Railway.</p>
      </div>
      {dadosBanco?.infraErro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{dadosBanco.infraErro}</p>}
      <div className={`rounded-xl border p-3 text-sm ${alertas.length || !infra ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
        <h3 className="font-bold">Alertas nesta tela</h3>
        {alertas.length > 0 ? <ul role="alert" className="mt-2 list-inside list-disc font-bold">{alertas.map(alerta => <li key={alerta}>{alerta}</li>)}</ul>
          : <p className="mt-1">{infra ? 'Nenhum alerta identificado nas leituras disponíveis; dados ausentes não são avaliados.' : 'Aguardando métricas disponíveis para avaliar os alertas.'}</p>}
        <p className="mt-1 text-xs">CPU ou memória a partir de 80% em leituras consecutivas por 5 minutos; disco a partir de 85%. Avisos apenas enquanto esta página estiver aberta, sem notificações.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Cartao titulo="Uso de CPU" valor={infra && ultimaInfra?.cpu != null ? percentual(ultimaInfra.cpu) : 'Não disponível'}
          detalhe={infra && infra.cpu.length ? ultimaInfra?.cpu == null ? 'Aguardando duas leituras válidas para calcular o uso.' : 'Calculado entre as duas últimas leituras válidas.' : 'Métrica de CPU não disponível.'} />
        <Cartao titulo="Memória utilizada" valor={infra && ultimaInfra?.memoria != null ? percentual(ultimaInfra.memoria) : 'Não disponível'}
          detalhe={infra?.memoria_total != null && infra.memoria_disponivel != null
            ? `${bytes(infra.memoria_total - infra.memoria_disponivel)} de ${bytes(infra.memoria_total)}; considera memória disponível para o sistema.`
            : 'Métrica de memória não disponível.'} />
        {(['/', '/data'] as const).map(ponto => {
          const disco = infra?.discos.find(item => item.ponto === ponto);
          const uso = disco?.total != null && disco.disponivel != null ? (1 - disco.disponivel / disco.total) * 100 : null;
          return <Cartao key={ponto} titulo={`Disco ${ponto}`} valor={uso === null ? 'Não disponível' : percentual(uso)}
            detalhe={disco?.total != null && disco.disponivel != null
              ? `${bytes(disco.total - disco.disponivel)} ocupados ou reservados de ${bytes(disco.total)}; ${bytes(disco.disponivel)} disponíveis.`
              : 'Métrica deste sistema de arquivos não disponível.'} />;
        })}
      </div>
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-800">Atividade de disco por dispositivo</summary>
        <p className="mt-1 text-xs text-slate-500">Taxas aproximadas entre leituras; dispositivos não são somados, pois podem se sobrepor. Disco da instância não é o Storage de objetos nem a cobrança.</p>
        {infra?.dispositivos.length ? <div className="mt-3 space-y-2">
          {(ultimaInfra?.taxas ?? []).map(dispositivo => <p key={dispositivo.nome} className="text-sm text-slate-700">
            <strong>{dispositivo.nome}</strong>: leitura {dispositivo.leitura === null ? 'indisponível' : `${bytes(dispositivo.leitura)}/s`} · gravação {dispositivo.gravacao === null ? 'indisponível' : `${bytes(dispositivo.gravacao)}/s`}
          </p>)}
          {!ultimaInfra?.taxas?.length && <p className="text-sm text-slate-500">Aguardando leituras para calcular as taxas.</p>}
        </div> : <p className="mt-3 text-sm text-slate-500">Métricas de atividade de disco não disponíveis.</p>}
      </details>
      {infra && <p className="text-xs text-slate-500">Última consulta à API de métricas: {dataHora.format(new Date(infra.consultado_em))}. A origem é atualizada aproximadamente a cada minuto.</p>}
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-800">Evolução nesta tela (CPU e memória)</summary>
        <p className="mt-1 text-xs text-slate-500">Até 20 leituras enquanto a página estiver aberta; o histórico não é salvo. CPU depende de duas leituras diferentes.</p>
        {historicoInfra.length ? <div className="mt-4 flex h-36 items-end gap-3 overflow-x-auto" aria-label="Histórico de CPU e memória">
          {historicoInfra.map((item, index) => <div key={`${item.consultadoEm}-${index}`} className="flex min-w-12 flex-col items-center gap-1">
            <div className="flex h-24 items-end gap-1" title={`${dataHora.format(new Date(item.consultadoEm))}: CPU ${item.cpu === null ? 'indisponível' : percentual(item.cpu)}; memória ${item.memoria === null ? 'indisponível' : percentual(item.memoria)}`}>
              <div className="w-4 rounded-t bg-[#3b597b]" style={{ height: item.cpu === null ? 0 : Math.max(2, item.cpu * 0.9) }} />
              <div className="w-4 rounded-t bg-emerald-500" style={{ height: item.memoria === null ? 0 : Math.max(2, item.memoria * 0.9) }} />
            </div>
            <span className="text-[10px] text-slate-500">{hora.format(new Date(item.consultadoEm))}</span>
          </div>)}
        </div> : <p className="mt-4 text-sm text-slate-500">Nenhuma leitura disponível nesta página.</p>}
        <p className="mt-2 text-xs text-slate-500">Azul: CPU · Verde: memória. Ausência de barra não indica uso zero.</p>
      </details>
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
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-800">Evolução do tamanho do banco</summary>
        <p className="mt-1 text-xs text-slate-500">Última coleta de cada dia, nos últimos 30 dias; lacunas indicam dias sem coleta.</p>
        {diarias.length ? <div className="mt-4 flex h-40 items-end gap-2 overflow-x-auto" aria-label="Tamanho do banco por dia">
          {diarias.map(item => <div key={item.coletado_em} className="flex min-w-10 flex-col items-center justify-end gap-1">
            <div className="w-7 rounded-t bg-[#3b597b]" style={{ height: Math.max(8, Math.round(item.metricas.banco_bytes / maiorBanco * 105)) }}
              title={`${dataHora.format(new Date(item.coletado_em))}: ${bytes(item.metricas.banco_bytes)}`} />
            <span className="text-[10px] text-slate-500">{dia.format(new Date(item.coletado_em))}</span>
          </div>)}
        </div> : <p className="mt-4 text-sm text-slate-500">Sem dados para o gráfico.</p>}
      </details>
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
            <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label="Lista de tabelas públicas">
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
            </div>
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
        <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-800">Detalhes da verificação de tabelas</summary>
        {integridade.tabelas.length > 0 && <figure className="mt-4">
          <figcaption className="font-bold text-slate-800">Resultado da última verificação</figcaption>
          <div className="mt-4 flex h-5 overflow-hidden rounded-full" aria-label={`${semProblemas.length} sem problemas detectados, ${problemas.length} com problemas, ${errosIntegridade.length} sem verificação`}>
            <div className="bg-emerald-500" style={{ width: `${semProblemas.length / integridade.tabelas.length * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${problemas.length / integridade.tabelas.length * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${errosIntegridade.length / integridade.tabelas.length * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-600">Sem problemas detectados: {numero.format(semProblemas.length)} · Problemas: {numero.format(problemas.length)} · Falhas de verificação: {numero.format(errosIntegridade.length)}</p>
        </figure>}
        <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} role="region" aria-label="Resultados de integridade das tabelas">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Tabela</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{integridade.tabelas.map(t => <tr key={t.nome} className="border-t border-slate-100">
              <td className="p-3">{t.nome}</td><td className="p-3">{t.status === 'sem_problemas_detectados' ? 'Sem problemas detectados' : t.status === 'problemas' ? 'Problema detectado' : `Não foi possível verificar (${t.codigo})`}</td>
            </tr>)}</tbody>
          </table>
          {!integridade.tabelas.length && <p className="p-5 text-sm text-slate-500">Nenhuma tabela compatível foi verificada.</p>}
        </div>
        </details>
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
        <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-800">Detalhes da verificação de índices</summary>
        <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-slate-200" tabIndex={0} role="region" aria-label="Resultados de integridade dos índices">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Índice</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{indices.indices.map(i => <tr key={i.nome} className="border-t border-slate-100">
              <td className="p-3">{i.nome}</td><td className="p-3">{i.status === 'sem_problemas_detectados' ? 'Sem problemas detectados' : i.status === 'indice_invalido' ? 'Índice inválido ou não pronto; não verificado' : i.status === 'problemas' ? `Possível corrupção (${i.codigo})` : `Não foi possível verificar (${i.codigo})`}</td>
            </tr>)}</tbody>
          </table>
          {!indices.indices.length && <p className="p-5 text-sm text-slate-500">Nenhum índice B-tree compatível identificado.</p>}
        </div>
        </details>
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
        <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-slate-800">Detalhes de relacionamentos e arquivos</summary>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
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
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-slate-800">Regras de vínculo entre registros</h3>
          <p className="mt-1 text-xs text-slate-500">Apenas as quatro regras listadas, baseadas nos vínculos de orçamento e financeiro. Não substituem a verificação de todas as regras de negócio.</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">Regra</th><th className="p-3">Resultado</th></tr></thead>
            <tbody>{referencias.regras.map(r => <tr key={r.nome} className="border-t border-slate-100">
              <td className="p-3">{nomesRegras[r.nome] ?? r.nome}</td><td className="p-3">{r.status === 'erro_verificacao' ? `Não foi possível verificar (${r.codigo})` : r.status === 'possivel_violacao' ? 'Possível inconsistência' : 'Sem ocorrências detectadas'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
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
        </details>
      </>}
    </section>
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Backup do banco</h2>
        <p className="mt-1 text-sm text-slate-500">Exportação manual para o Google Drive. Restauração deve ser testada em projeto isolado, nunca em produção.</p>
      </div>
      <PainelBackup supabase={supabase} />
    </section>
    <section className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800">Verificações ainda não disponíveis</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Cartao titulo="Restauração testada" valor="Sem teste registrado" detalhe="Nenhuma restauração foi executada e comprovada em projeto isolado até o momento." />
        <Cartao titulo="Dados e arquivos" valor="Cobertura parcial" detalhe="Outras regras de negócio, outros relacionamentos sem chave estrangeira e existência física dos arquivos não são verificados por este painel." />
      </div>
    </section>
  </main>;
}
