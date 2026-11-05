"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import {
  OPERATIONS_PRODUCTS, operationsStages, type OperationsArea, type OperationsRecord,
  type OperationsEvent, type OperationsMember, type OperationsMetric, type OperationsCommission,
} from '@/lib/holding-operations';
import {
  commercialButtonClass, commercialSecondaryClass, commercialInputClass, commercialFieldClass,
  commercialLabelClass, HoldingCommercialSelect,
} from '@/components/HoldingCommercialFields';

type Source = { id: string; name: string; contact: string; status: string; type: string; title?: string };
type Commission = OperationsCommission & { holding_operations: { customer_name: string; title: string; product: keyof typeof OPERATIONS_PRODUCTS } };
type Edit = {
  id?: string; version?: number; request_id: string; product: string; customer_name: string; title: string; contact: string;
  owner_email: string; due_date: string; stage: string; next_action: string; loss_reason: string; note: string;
  source_type: string; source_id?: string; source_status?: string;
};
const cardClass = 'space-y-4 rounded-xl border border-slate-200 bg-white p-5';
const dateLabel = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('/') : 'Sem prazo';
async function request(path: string, init?: RequestInit) {
  const response = await holdingAuthFetch(`/api/admin/operations${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Operação não confirmada.');
  return body;
}

export function HoldingOperations({ area }: { area: OperationsArea | 'gestao' }) {
  const metricsMode = area === 'gestao';
  const workArea: OperationsArea = area === 'producao' ? 'producao' : 'comercial';
  const stages = operationsStages(workArea);
  const [records, setRecords] = useState<OperationsRecord[]>([]);
  const [members, setMembers] = useState<OperationsMember[]>([]);
  const [metrics, setMetrics] = useState<OperationsMetric[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [manager, setManager] = useState(false);
  const [product, setProduct] = useState('');
  const [stage, setStage] = useState('');
  const [owner, setOwner] = useState('');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [start, setStart] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState('records');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourceProduct, setSourceProduct] = useState(workArea === 'comercial' ? 'glass' : 'websites');
  const [sourceStatus, setSourceStatus] = useState('');
  const [sourcePage, setSourcePage] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  const [history, setHistory] = useState<{ id: string; page: number; count: number; events: OperationsEvent[] } | null>(null);
  const busy = useRef(false);

  const load = useCallback((signal?: AbortSignal) => {
    const params = new URLSearchParams({ area: workArea, page: String(page), product, stage, owner });
    if (metricsMode) { params.set('mode', 'metrics'); params.set('start', start); params.set('end', end); }
    else if (tab === 'commissions') params.set('mode', 'commissions');
    return request(`?${params}`, { signal }).then(async (body) => {
      if (signal?.aborted) return;
      if (metricsMode) {
        setMetrics(body.metrics); setMembers(body.members.map((member: { email: string; nome: string }) => ({ email: member.email, name: member.nome || member.email })));
      } else if (tab === 'commissions') {
        setCommissions(body.commissions); setCount(body.count);
      } else {
        setRecords(body.records); setCount(body.count); setManager(body.manager);
        if (body.manager) {
          const options = await request(`?area=${workArea}&mode=members`, { signal });
          if (!signal?.aborted) setMembers(options.members);
        }
      }
    }).finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [workArea, page, product, stage, owner, metricsMode, start, end, tab]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((failure) => {
      if (!controller.signal.aborted) { console.error('[OPERATIONS UI] Consulta falhou.'); setError(failure instanceof Error ? failure.message : 'Falha ao carregar.'); }
    });
    return () => controller.abort();
  }, [load]);

  async function execute(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    try { await action(); } catch (failure) {
      console.error('[OPERATIONS UI] Operação interrompida.');
      setError(failure instanceof Error ? failure.message : 'Operação não confirmada. Atualize antes de repetir.');
    } finally { busy.current = false; setWorking(false); }
  }
  function newRecord(source?: Source) {
    setEdit({
      request_id: crypto.randomUUID(), product: source ? sourceProduct : product || 'glass',
      customer_name: source?.name || '', title: source?.title || '', contact: source?.contact || '',
      owner_email: '', due_date: '', stage: workArea === 'comercial' ? 'available' : 'materials',
      next_action: '', loss_reason: '', note: '', source_type: source?.type || 'manual',
      ...(source ? { source_id: source.id, source_status: source.status } : {}),
    });
    setSources(null);
  }
  function editRecord(row: OperationsRecord) {
    setEdit({
      ...row, request_id: crypto.randomUUID(), source_id: row.source_id || undefined,
      source_status: row.source_status || undefined, owner_email: row.owner_email || '', due_date: row.due_date || '', note: '',
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!edit) return;
    void execute(async () => {
      await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...edit, area: workArea }) });
      setEdit(null);
      await load();
      setMessage('Registro salvo com histórico. Nenhuma cobrança ou comissão foi paga.');
    });
  }
  function showSources(targetPage = 0) {
    void execute(async () => {
      const body = await request(`?${new URLSearchParams({ area: workArea, mode: 'sources', product: sourceProduct, page: String(targetPage), source_status: sourceStatus })}`);
      setSources(body.sources); setSourceCount(body.count); setSourcePage(targetPage);
    });
  }
  function showHistory(id: string, targetPage = 0) {
    void execute(async () => {
      const body = await request(`?area=${workArea}&mode=history&id=${id}&page=${targetPage}`);
      setHistory({ id, page: targetPage, count: body.count, events: body.events });
    });
  }
  const name = (email: string | null) => email ? members.find((member) => member.email === email)?.name || email : 'Sem responsável';
  const updateEdit = (key: keyof Edit, value: string) => setEdit((current) => current && ({ ...current, [key]: value }));
  const visibleMetrics = metrics.filter((metric) => !owner || (owner === 'unassigned' ? !metric.owner_email : metric.owner_email === owner));

  return <div className="mx-auto max-w-[1200px] space-y-6 pb-12">
    <header className="space-y-3">
      <h1 className="text-2xl font-bold">{metricsMode ? 'Gestão — indicadores operacionais' : workArea === 'comercial' ? 'Comercial — carteira e oportunidades' : 'Produção — projetos e entregas'}</h1>
      <nav className="flex flex-wrap gap-4 text-sm text-blue-800">
        <Link href="/comercial">Comercial</Link><Link href="/producao">Produção</Link><Link href="/gestao">Gestão</Link>
      </nav>
      <p className="text-sm text-slate-600">{metricsMode
        ? 'Indicadores por produto, responsável e período. Carga e atrasos representam a situação atual; entradas, conversões e entregas representam o período selecionado.'
        : workArea === 'comercial'
          ? 'Cada vendedor acessa sua carteira. Conversão registrada não comprova pagamento. Comissões aguardam definição de regra e não geram cálculo nem pagamento.'
          : 'Etapas registradas na Holding. Aguardando materiais e aprovação do cliente não somam tempo de produção. Nenhuma etapa publica sites nem altera contratos.'}</p>
    </header>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    <div className="grid gap-4 md:grid-cols-3">
      <label className={commercialLabelClass}>Produto<HoldingCommercialSelect value={product} onChange={(event) => { setProduct(event.target.value); setPage(0); }}>
        <option value="">Todos os produtos</option>{Object.entries(OPERATIONS_PRODUCTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </HoldingCommercialSelect></label>
      {metricsMode ? <>
        <label className={commercialLabelClass}>Início<input type="date" className={commercialInputClass} value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className={commercialLabelClass}>Fim<input type="date" className={commercialInputClass} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      </> : <>
        <label className={commercialLabelClass}>Etapa<HoldingCommercialSelect disabled={tab === 'commissions'} value={stage} onChange={(event) => { setStage(event.target.value); setPage(0); }}>
          <option value="">Todas as etapas</option>{Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </HoldingCommercialSelect></label>
        {manager && <label className={commercialLabelClass}>Responsável<HoldingCommercialSelect disabled={tab === 'commissions'} value={owner} onChange={(event) => { setOwner(event.target.value); setPage(0); }}>
          <option value="">Todos</option><option value="unassigned">Sem responsável</option>
          {members.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
        </HoldingCommercialSelect></label>}
      </>}
    </div>
    {metricsMode && <label className={commercialLabelClass}>Responsável nos indicadores<HoldingCommercialSelect value={owner} onChange={(event) => setOwner(event.target.value)}>
      <option value="">Todos</option><option value="unassigned">Sem responsável</option>
      {members.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
    </HoldingCommercialSelect></label>}
    <div className="flex flex-wrap gap-3">
      <button className={commercialSecondaryClass} disabled={working} onClick={() => void execute(async () => { await load(); setMessage('Dados atualizados.'); })}>Atualizar</button>
      {!metricsMode && <>
        {manager && <button className={commercialButtonClass} disabled={working} onClick={() => newRecord()}>Novo {workArea === 'comercial' ? 'lead / oportunidade' : 'projeto'}</button>}
        {workArea === 'comercial' && <button className={commercialSecondaryClass} onClick={() => { setTab(tab === 'records' ? 'commissions' : 'records'); setPage(0); }}>{tab === 'records' ? 'Comissões — estrutura' : 'Voltar à carteira'}</button>}
      </>}
    </div>
    {!metricsMode && manager && <details className={cardClass}><summary className="cursor-pointer font-semibold">Importar da base existente</summary>
      <p className="text-sm text-slate-600">Importação individual, sem duplicar a origem. Glass: somente leitura dos dados comerciais; status é o informado pelo sistema, não uma medida de uso. Websites: contratações da Holding. Barber e demais origens: cadastro manual nesta etapa.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className={commercialLabelClass}>Origem<HoldingCommercialSelect value={sourceProduct} onChange={(event) => { setSourceProduct(event.target.value); setSources(null); setSourceStatus(''); }}>
          {workArea === 'comercial' && <option value="glass">Assinantes Glass</option>}<option value="websites">Contratos Websites</option>
        </HoldingCommercialSelect></label>
        {sourceProduct === 'glass' && <label className={commercialLabelClass}>Status exato na origem<input className={commercialInputClass} placeholder="Ex.: trial; vazio mostra todos" value={sourceStatus} onChange={(event) => { setSourceStatus(event.target.value); setSources(null); }} /></label>}
        <button className={commercialSecondaryClass} disabled={working} onClick={() => showSources()}>Consultar origem</button>
      </div>
      {sources && <div className="space-y-3">{sources.map((source) => <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
        <p>{source.name} <span className="text-sm text-slate-500">· {source.status || 'Status não informado'}</span></p>
        <button className={commercialSecondaryClass} onClick={() => newRecord(source)}>Preparar importação</button>
      </div>)}{sources.length === 0 && <p>Nenhuma origem encontrada com este filtro.</p>}
        <div className="flex items-center gap-3"><button className={commercialSecondaryClass} disabled={working || sourcePage === 0} onClick={() => showSources(sourcePage - 1)}>Origens anteriores</button>
          <span>Página {sourcePage + 1} · {sourceCount} origens</span><button className={commercialSecondaryClass} disabled={working || (sourcePage + 1) * 25 >= sourceCount} onClick={() => showSources(sourcePage + 1)}>Próximas origens</button></div>
      </div>}
    </details>}
    {edit && !metricsMode && <form onSubmit={save} className={cardClass}>
      <h2 className="text-lg font-bold">{edit.id ? 'Atualizar registro / registrar contato' : 'Novo registro'}</h2>
      <fieldset disabled={working} className="grid gap-4 md:grid-cols-2">
        <label className={commercialLabelClass}>Produto<HoldingCommercialSelect disabled={Boolean(edit.id || edit.source_id)} value={edit.product} onChange={(event) => updateEdit('product', event.target.value)}>
          {Object.entries(OPERATIONS_PRODUCTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </HoldingCommercialSelect></label>
        <label className={commercialLabelClass}>Cliente<input required maxLength={200} readOnly={Boolean(edit.id || edit.source_id)} className={commercialInputClass} value={edit.customer_name} onChange={(event) => updateEdit('customer_name', event.target.value)} /></label>
        <label className={commercialLabelClass}>Título / objetivo<input required maxLength={200} readOnly={Boolean(edit.id)} className={commercialInputClass} value={edit.title} onChange={(event) => updateEdit('title', event.target.value)} /></label>
        <label className={commercialLabelClass}>Contato comercial<input maxLength={300} readOnly={Boolean(edit.id || edit.source_id)} className={commercialInputClass} value={edit.contact} onChange={(event) => updateEdit('contact', event.target.value)} /></label>
        {manager && <label className={commercialLabelClass}>Responsável pelo registro<HoldingCommercialSelect value={edit.owner_email} onChange={(event) => updateEdit('owner_email', event.target.value)}>
          <option value="">Sem responsável</option>
          {edit.owner_email && !members.some((member) => member.email === edit.owner_email) && <option value={edit.owner_email}>{edit.owner_email} · acesso revogado</option>}
          {members.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
        </HoldingCommercialSelect></label>}
        <label className={commercialLabelClass}>Etapa<HoldingCommercialSelect value={edit.stage} onChange={(event) => updateEdit('stage', event.target.value)}>
          {Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </HoldingCommercialSelect></label>
        <label className={commercialLabelClass}>{workArea === 'comercial' ? 'Prazo de acompanhamento' : 'Prazo de entrega'}<input type="date" readOnly={!manager} min="2020-01-01" max="2100-12-31" className={commercialInputClass} value={edit.due_date} onChange={(event) => updateEdit('due_date', event.target.value)} /></label>
        <label className={commercialLabelClass}>Próxima ação<input maxLength={2000} className={commercialInputClass} value={edit.next_action} onChange={(event) => updateEdit('next_action', event.target.value)} /></label>
        {edit.stage === 'lost' && <label className={commercialLabelClass}>Motivo da perda<textarea required maxLength={2000} className={commercialFieldClass} value={edit.loss_reason} onChange={(event) => updateEdit('loss_reason', event.target.value)} /></label>}
        <label className={`${commercialLabelClass} md:col-span-2`}>Registro de contato / atividade<textarea maxLength={5000} className={commercialFieldClass} value={edit.note} onChange={(event) => updateEdit('note', event.target.value)} /></label>
        <div className="flex gap-3 md:col-span-2"><button type="button" className={commercialSecondaryClass} onClick={() => setEdit(null)}>Cancelar</button><button type="submit" className={commercialButtonClass}>Salvar registro</button></div>
      </fieldset>
    </form>}
    {loading && <p role="status">Carregando operações...</p>}
    {!loading && metricsMode && <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-sm"><caption className="p-3 text-left">Conversões e entregas são registros de etapa, não recebimentos financeiros. Sem prazo definido, uma entrega não conta como “no prazo”.</caption>
        <thead><tr>{['Módulo', 'Produto', 'Responsável', 'Abertos agora', 'Atrasados agora', 'Entradas no período', 'Conversões', 'Entregas', 'Entregas no prazo'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{visibleMetrics.map((metric) => <tr key={`${metric.area}-${metric.product}-${metric.owner_email}`} className="border-t">
          <td className="p-3">{metric.area === 'comercial' ? 'Comercial' : 'Produção'}</td>
          <td className="p-3">{OPERATIONS_PRODUCTS[metric.product]}</td><td className="p-3">{name(metric.owner_email)}</td>
          {[metric.open_records, metric.overdue_records, metric.created, metric.conversions, metric.deliveries, metric.on_time_deliveries].map((value, index) => <td key={index} className="p-3">{value}</td>)}
        </tr>)}</tbody>
      </table>{visibleMetrics.length === 0 && <p className="p-5">Nenhum indicador registrado com estes filtros.</p>}
    </div>}
    {!loading && !metricsMode && tab === 'commissions' && <section className={cardClass}>
      <h2 className="text-lg font-bold">Comissões — aguardando definição da regra</h2>
      <p>Vendedor preservado na primeira conversão. Sem percentual, base de cálculo, comprovação de recebimento ou pagamento automático. Reabrir uma conversão invalida sua previsão; não a recalcula.</p>
      {commissions.map((commission) => <article key={commission.record_id} className="rounded-md border p-3">
        <h3 className="font-bold">{commission.holding_operations.customer_name} · {OPERATIONS_PRODUCTS[commission.holding_operations.product]}</h3>
        <p>{commission.holding_operations.title} · {name(commission.seller_email)} · {dateLabel(commission.converted_at)}</p>
        <p>{commission.state === 'void' ? 'Previsão invalidada pela reabertura' : 'Aguardando regra e validação de recebimento — valor não calculado'}</p>
      </article>)}
      {commissions.length === 0 && <p>Nenhuma conversão registrada para comissão.</p>}
    </section>}
    {!loading && !metricsMode && tab === 'records' && <div className="space-y-4">{records.map((row) => <article key={row.id} className={cardClass}>
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-bold">{row.customer_name}</h2><p>{row.title} · {OPERATIONS_PRODUCTS[row.product]}</p></div><strong>{stages[row.stage]}</strong></div>
      <p>Responsável: <strong>{name(row.owner_email)}</strong> · {workArea === 'comercial' ? 'Acompanhamento' : 'Entrega'}: {dateLabel(row.due_date)}</p>
      {row.contact && <p>Contato: {row.contact}</p>}
      {row.source_status && <p className="text-sm text-slate-600">Situação na importação: {row.source_status}. Este snapshot não comprova uso nem pagamento.</p>}
      {row.next_action && <p>Próxima ação: {row.next_action}</p>}
      {row.loss_reason && row.stage === 'lost' && <p>Motivo da perda: {row.loss_reason}</p>}
      <div className="flex gap-3"><button className={commercialSecondaryClass} disabled={working} onClick={() => editRecord(row)}>Atualizar / registrar atividade</button>
        <button className={commercialSecondaryClass} disabled={working} onClick={() => showHistory(row.id)}>Histórico</button></div>
    </article>)}{records.length === 0 && <p className={cardClass}>Nenhum registro disponível com estes filtros.</p>}</div>}
    {!metricsMode && <div className="flex flex-wrap items-center gap-3">
      <button className={commercialSecondaryClass} disabled={working || page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>Página {page + 1} · {count} registros</span><button className={commercialSecondaryClass} disabled={working || (page + 1) * 25 >= count} onClick={() => setPage(page + 1)}>Próxima</button>
    </div>}
    {history && <section className={cardClass} aria-label="Histórico de atividades">
      <h2 className="font-bold">Histórico de atividades</h2><button className={commercialSecondaryClass} onClick={() => setHistory(null)}>Fechar histórico</button>
      {history.events.map((event) => <article key={event.id} className="border-t pt-3"><p>{new Date(event.created_at).toLocaleString('pt-BR')} · {event.actor_email}</p>
        <p>{event.previous_stage ? `${stages[event.previous_stage]} → ` : ''}{stages[event.stage]} · responsável: {name(event.owner_email)}</p><p className="whitespace-pre-wrap">{event.note || 'Alteração de cadastro ou etapa registrada.'}</p></article>)}
      <div className="flex gap-3"><button className={commercialSecondaryClass} disabled={working || history.page === 0} onClick={() => showHistory(history.id, history.page - 1)}>Histórico anterior</button>
        <span>{history.count} eventos</span><button className={commercialSecondaryClass} disabled={working || (history.page + 1) * 25 >= history.count} onClick={() => showHistory(history.id, history.page + 1)}>Próximo histórico</button></div>
    </section>}
  </div>;
}
