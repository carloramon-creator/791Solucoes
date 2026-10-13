'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { formatarCustoIA, funcoesConsumoIA, type RelatorioConsumoIA } from '@/lib/ai-usage-report';

const numero = new Intl.NumberFormat('pt-BR');
const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' });
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const quantidade = (value: number | null) => value === null ? 'Não informado' : numero.format(value);
const status = { em_andamento: 'Em andamento', concluida: 'Concluída', erro: 'Erro' };
const campo = 'mt-1 block h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700';
const campoData = `${campo} min-w-36 appearance-none py-0 leading-10`;
const botao = 'rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-40';

export default function ConsumoIAPage() {
  const [inicio, setInicio] = useState(() => `${hoje().slice(0, 7)}-01`);
  const [fim, setFim] = useState(hoje);
  const [tenant, setTenant] = useState('');
  const [funcao, setFuncao] = useState('');
  const [report, setReport] = useState<RelatorioConsumoIA | null>(null);
  const [opcoesTenants, setOpcoesTenants] = useState<RelatorioConsumoIA['tenants']>([]);
  const [mensalAberto, setMensalAberto] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const auth = useMemo(() => createSupabaseBrowser(), []);

  async function carregar(pagina = 1, filtros?: { inicio: string; fim: string; tenant: string; funcao: string }) {
    setLoading(true);
    setError('');
    try {
      const { data, error: authError } = await auth.auth.getSession();
      if (authError) throw authError;
      if (!data.session) throw new Error('Sessão expirada. Entre novamente.');
      const params = new URLSearchParams({ ...(filtros || { inicio, fim, tenant, funcao }), pagina: String(pagina) });
      const response = await fetch(`/api/admin/ai-usage?${params}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o relatório.');
      const result: RelatorioConsumoIA = payload;
      setReport(result);
      setMensalAberto('');
      setFiltrosAplicados(filtros || { inicio, fim, tenant, funcao });
      if (!(filtros?.tenant || tenant)) setOpcoesTenants(result.tenants);
    } catch (caught) {
      setReport(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o relatório.');
    } finally {
      setLoading(false);
    }
  }
  const [filtrosAplicados, setFiltrosAplicados] = useState({ inicio, fim, tenant, funcao });
  const totals = report?.tenants.reduce((sum, t) => ({
    entrada: sum.entrada + t.tokens_entrada, saida: sum.saida + t.tokens_saida, total: sum.total + t.tokens_total,
    desconhecido: sum.desconhecido + t.chamadas - t.chamadas_com_consumo,
    custo: sum.custo + (t.custo_estimado_usd ?? 0),
    comCusto: sum.comCusto + t.chamadas_com_custo,
    semCusto: sum.semCusto + t.chamadas - t.chamadas_com_custo,
  }), { entrada: 0, saida: 0, total: 0, desconhecido: 0, custo: 0, comCusto: 0, semCusto: 0 });
  const nomes = new Map(report?.tenants.map(t => [t.tenant_id, t.nome]));

  return <main className="mx-auto max-w-[1600px] space-y-5 pb-12">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-black text-slate-800">Consumo de IA por tenant</h1><p className="text-xs text-slate-500">Tokens informados pelo provedor · Horário de Brasília · Cada tentativa é uma chamada</p></div>
      <Link className={botao} href="/assinaturas/relatorio-consumo">Voltar ao relatório de consumo</Link>
    </header>
    <form onSubmit={event => { event.preventDefault(); void carregar(); }} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <label className="flex flex-col text-xs font-bold">Data inicial<input disabled={loading} required type="date" value={inicio} onChange={e => setInicio(e.target.value)} className={campoData} /></label>
      <label className="flex flex-col text-xs font-bold">Data final<input disabled={loading} required type="date" value={fim} onChange={e => setFim(e.target.value)} className={campoData} /></label>
      <label className="flex flex-col text-xs font-bold">Tenant<select disabled={loading} value={tenant} onChange={e => setTenant(e.target.value)} className={campo}><option value="">Todos</option>{opcoesTenants.map(t => <option key={t.tenant_id} value={t.tenant_id}>{t.nome}</option>)}</select></label>
      <label className="flex flex-col text-xs font-bold">Função<select disabled={loading} value={funcao} onChange={e => setFuncao(e.target.value)} className={campo}><option value="">Todas</option>{Object.entries(funcoesConsumoIA).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button disabled={loading} className={botao}>{loading ? 'Carregando...' : 'Gerar relatório'}</button>
    </form>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {!report && !loading && !error && <p className="text-sm text-slate-500">Selecione o período e clique em Gerar relatório.</p>}
    {report && totals && <>
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-lg font-black text-emerald-700">Consumo geral da Holding: {formatarCustoIA(totals.comCusto ? totals.custo : null)}</p>
        <p className="mt-1 text-sm text-emerald-900">{numero.format(report.total)} chamadas · {numero.format(totals.total)} tokens ({numero.format(totals.entrada)} entrada / {numero.format(totals.saida)} saída)</p>
        <p className="mt-1 text-xs text-slate-500">Estimativa pelos tokens informados pelo provedor; não é o saldo oficial da OpenAI.{totals.semCusto ? ` ${totals.semCusto} chamada(s) sem custo calculado.` : ''}</p>
      </section>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="p-4 font-bold">Tenants</h2>
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="bg-slate-50"><tr>{['Tenant', 'Chamadas', 'Tokens', 'Custo US$', ''].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead>
          <tbody>{report.tenants.map(t => {
            const aberto = mensalAberto === t.tenant_id;
            const meses = report.mensal.filter(m => m.tenant_id === t.tenant_id);
            return <Fragment key={t.tenant_id}>
              <tr className="border-t border-slate-100">
                <td className="p-3 font-semibold" title={t.tenant_id}>{t.nome}</td>
                <td className="p-3 tabular-nums">{numero.format(t.chamadas)}</td>
                <td className="p-3 tabular-nums">{numero.format(t.tokens_total)}</td>
                <td className="p-3 tabular-nums">{formatarCustoIA(t.custo_estimado_usd)}</td>
                <td className="p-3 text-right"><button type="button" aria-expanded={aberto} className="rounded-md border border-slate-200 px-3 py-1 font-bold text-slate-600" onClick={() => setMensalAberto(aberto ? '' : t.tenant_id)}>{aberto ? 'Fechar evolução' : 'Evolução mensal'}</button></td>
              </tr>
              {aberto && <tr className="bg-slate-50"><td colSpan={5} className="p-3">
                <table className="w-full text-left text-xs">
                  <thead><tr>{['Mês', 'Chamadas', 'Tokens', 'Custo US$'].map(h => <th className="px-3 py-1 text-slate-500" key={h}>{h}</th>)}</tr></thead>
                  <tbody>{meses.map(m => <tr key={m.mes} className="border-t border-slate-200">
                    <td className="px-3 py-1">{m.mes.slice(5, 7)}/{m.mes.slice(0, 4)}</td><td className="px-3 py-1 tabular-nums">{numero.format(m.chamadas)}</td>
                    <td className="px-3 py-1 tabular-nums">{numero.format(m.tokens_total)}</td><td className="px-3 py-1 tabular-nums">{formatarCustoIA(m.custo_estimado_usd)}</td>
                  </tr>)}</tbody>
                </table>
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </section>
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="p-4 font-bold">Histórico de chamadas</h2>
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead className="bg-slate-50"><tr>{['Data / hora', 'Tenant', 'O que consumiu', 'Modelo', 'Tokens', 'Custo US$', 'Status'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead>
          <tbody>{report.eventos.map(e => <tr key={e.id} className="border-t border-slate-100">
            <td className="p-3">{dataHora.format(new Date(e.created_at))}</td><td className="p-3">{nomes.get(e.tenant_id) || e.tenant_id}</td>
            <td className="p-3">{funcoesConsumoIA[e.funcao] || e.funcao}{e.tentativa > 1 ? ` (tentativa ${e.tentativa})` : ''}</td><td className="p-3">{e.model}</td>
            <td className="p-3 tabular-nums" title={`Entrada ${quantidade(e.tokens_entrada)} · Saída ${quantidade(e.tokens_saida)} · Cache ${quantidade(e.tokens_cache)}`}>{quantidade(e.tokens_total)}</td>
            <td className="p-3 tabular-nums">{formatarCustoIA(e.custo_estimado_usd)}</td>
            <td className="p-3">{status[e.status]}{e.erro_codigo ? ` (${e.erro_codigo})` : ''}</td>
          </tr>)}</tbody>
        </table>
        {!report.total && <p className="p-8 text-center text-sm text-slate-500">Nenhuma chamada registrada no período. O histórico começa com a implantação deste registro.</p>}
      </section>
      <div className="flex items-center justify-end gap-3 text-sm">
        <button disabled={loading || report.pagina <= 1} className={botao} onClick={() => void carregar(report.pagina - 1, filtrosAplicados)}>Anterior</button>
        <span>Página {report.pagina} de {Math.max(1, Math.ceil(report.total / 50))}</span>
        <button disabled={loading || report.pagina * 50 >= report.total} className={botao} onClick={() => void carregar(report.pagina + 1, filtrosAplicados)}>Próxima</button>
      </div>
    </>}
  </main>;
}
