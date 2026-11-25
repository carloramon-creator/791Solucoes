'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type Verificacao = {
  status: 'disponivel' | 'indisponivel';
  verificadoEm: string;
  tempoMs?: number;
};

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
});

export default function MonitoramentoGlassPage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [historico, setHistorico] = useState<Verificacao[]>([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
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
    } catch (error) {
      if (montado.current) setErro(error instanceof Error ? error.message : 'Não foi possível verificar a integração.');
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

  const ultima = historico.at(-1);
  const tempos = historico.flatMap(item => item.tempoMs === undefined ? [] : [item.tempoMs]);
  const maximo = Math.max(1, ...tempos);

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
    <p className="text-xs text-slate-500">A verificação apenas lê um registro da tabela de vidraçarias. Ela não mede o tamanho do banco, não testa o Storage e não confirma a existência ou restauração de backups.</p>
  </main>;
}
