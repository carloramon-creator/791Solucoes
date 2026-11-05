"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { productivityCents, WEBSITE_PRODUCTION_STAGES, type WebsiteProductionStage } from '@/lib/website-production';
import { WebsiteProductionProgress } from './WebsiteProductionProgress';
import { commercialButtonClass, commercialSecondaryClass, commercialInputClass, commercialLabelClass, commercialMoney, HoldingCommercialSelect } from './HoldingCommercialFields';

type Rate = { amount_cents: number; version: number };
type Plan = { id: string; name: string; active: boolean; holding_website_productivity_rates: Rate | Rate[] | null };
type Project = {
  id: string; customer_snapshot: { name: string }; plan_snapshot: { name: string };
  designer_email: string | null; production_stage: WebsiteProductionStage;
};
type Earning = {
  contract_id: string; designer_email: string; amount_cents: number; approved_at: string; approved_by: string;
  customer_snapshot: { name: string };
  finance_record_count: number; pending_cents: number; paid_cents: number; cancelled_cents: number;
};
type ProductionData = {
  plans?: Plan[]; projects?: Project[]; earnings?: Earning[]; count: number; manager: boolean; error?: string;
};
const rateFor = (plan: Plan) => Array.isArray(plan.holding_website_productivity_rates)
  ? plan.holding_website_productivity_rates[0] : plan.holding_website_productivity_rates;

export function WebsiteProductivity() {
  const [tab, setTab] = useState('projects');
  const [manager, setManager] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [edit, setEdit] = useState<{ id: string; amount: string; version: number } | null>(null);
  const busy = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await holdingAuthFetch(`/api/admin/website-production?${new URLSearchParams({ mode: tab, page: String(page), stage })}`, { signal });
    const body: ProductionData = await response.json();
    if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a produtividade.');
    if (!Array.isArray(tab === 'rates' ? body.plans : tab === 'earnings' ? body.earnings : body.projects)
      || !Number.isSafeInteger(body.count) || typeof body.manager !== 'boolean') throw new Error('Resposta de produtividade inválida.');
    return body;
  }, [tab, page, stage]);
  const applyData = useCallback((body: ProductionData) => {
    setPlans(body.plans || []); setProjects(body.projects || []); setEarnings(body.earnings || []);
    setManager(body.manager); setCount(body.count);
  }, []);
  function changingQuery() {
    setLoading(true); setError(''); setEdit(null); setMessage('');
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then((body) => {
      if (!controller.signal.aborted) applyData(body);
    }).catch((failure) => {
      if (!controller.signal.aborted) {
        console.error('[PRODUCTIVITY UI] Consulta falhou.');
        setError(failure instanceof Error ? failure.message : 'Falha ao carregar.');
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, applyData]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!edit || busy.current) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-production', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: edit.id, amount_cents: productivityCents(edit.amount), version: edit.version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Valor não confirmado.');
      setEdit(null);
      applyData(await load());
      setMessage('Valor salvo para futuras aprovações. Produtividades já aprovadas não foram alteradas.');
    } catch (failure) {
      console.error('[PRODUCTIVITY UI] Valor não salvo.');
      setError(failure instanceof Error ? failure.message : 'Falha ao salvar.');
    } finally { busy.current = false; setWorking(false); }
  }
  return <div className="mx-auto max-w-[1200px] space-y-5 pb-12">
    <header className="space-y-2"><h1 className="text-2xl font-bold">Produção — produtividade Websites</h1>
      <p className="text-sm text-slate-600">Valores por plano de criação e entregas remuneradas. As etapas são avançadas no Websites; a aprovação final ocorre em Assinaturas → Websites.</p>
      <p className="text-sm text-slate-600">Uma produtividade por contratação, sem repetição nas mensalidades. Aprovar gera uma despesa pendente no Financeiro, nunca pagamento automático. Aprovações anteriores à implantação não geram produtividade retroativa.</p>
    </header>
    <nav className="flex flex-wrap gap-3" aria-label="Produtividade">
      {([['projects', 'Projetos'], ['earnings', 'Produtividades aprovadas'], ...(manager ? [['rates', 'Valores por plano']] : [])]).map(([key, label]) =>
        <button key={key} className={tab === key ? commercialButtonClass : commercialSecondaryClass} disabled={working || loading || tab === key} onClick={() => { changingQuery(); setTab(key); setPage(0); }}>{label}</button>)}
      <button className={commercialSecondaryClass} disabled={working || loading} onClick={async () => {
        changingQuery();
        try { applyData(await load()); } catch (failure) {
          console.error('[PRODUCTIVITY UI] Atualização falhou.');
          setError(failure instanceof Error ? failure.message : 'Falha ao atualizar.');
        } finally { setLoading(false); }
      }}>Atualizar</button>
      <Link href="/assinaturas/websites" className={commercialSecondaryClass}>Assinaturas Websites</Link>
      <Link href="/financeiro" className={commercialSecondaryClass}>Financeiro</Link>
    </nav>
    {tab === 'projects' && <label className={commercialLabelClass}>Etapa<HoldingCommercialSelect value={stage} disabled={working || loading} onChange={(event) => { changingQuery(); setStage(event.target.value); setPage(0); }}>
      <option value="">Todas</option>{Object.entries(WEBSITE_PRODUCTION_STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </HoldingCommercialSelect></label>}
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {loading ? <p role="status">Carregando produtividade...</p> : !error && <>
      {tab === 'projects' && projects.map((project) => <article key={project.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">{project.customer_snapshot.name} · {project.plan_snapshot.name}</h2>
        <p className="text-sm">{project.designer_email || 'Sem webdesigner'}</p>
        <WebsiteProductionProgress stage={project.production_stage} />
      </article>)}
      {tab === 'rates' && plans.map((plan) => {
        const rate = rateFor(plan);
        return <article key={plan.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold">{plan.name}{!plan.active && ' · Inativo'}</h2>
          <p>{rate ? commercialMoney(rate.amount_cents) : 'Valor não configurado — bloqueia novas aprovações deste plano'}</p>
          {edit?.id === plan.id ? <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <label className={commercialLabelClass}>Valor fixo por entrega (R$)<input required inputMode="decimal" className={commercialInputClass} value={edit.amount} disabled={working} onChange={(event) => setEdit({ ...edit, amount: event.target.value })} /></label>
            <button type="submit" className={commercialButtonClass} disabled={working}>Salvar valor</button>
            <button type="button" className={commercialSecondaryClass} disabled={working} onClick={() => setEdit(null)}>Cancelar</button>
          </form> : <button className={commercialSecondaryClass} onClick={() => setEdit({ id: plan.id, amount: rate ? (rate.amount_cents / 100).toFixed(2) : '', version: rate?.version || 0 })}>Configurar valor</button>}
        </article>;
      })}
      {tab === 'earnings' && earnings.map((earning) => <article key={earning.contract_id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">{earning.customer_snapshot.name} · {commercialMoney(earning.amount_cents)}</h2>
        <p className="text-sm">Webdesigner: {earning.designer_email}</p>
        <p className="text-sm">Aprovado em {new Date(earning.approved_at).toLocaleDateString('pt-BR')} por {earning.approved_by}</p>
        <p className="text-sm">Financeiro: {earning.finance_record_count > 0
          ? `Pendente: ${commercialMoney(earning.pending_cents)} · Pago: ${commercialMoney(earning.paid_cents)} · Cancelado / abonado: ${commercialMoney(earning.cancelled_cents)}`
          : 'Lançamento excluído — requer conferência; não será recriado automaticamente'}</p>
      </article>)}
      {count === 0 && <p>Nenhum registro encontrado.</p>}
      <div className="flex items-center gap-3">
        <button className={commercialSecondaryClass} disabled={page === 0 || working} onClick={() => { changingQuery(); setPage(page - 1); }}>Anterior</button>
        <span className="text-sm">Página {page + 1} · {count} registros</span>
        <button className={commercialSecondaryClass} disabled={(page + 1) * 25 >= count || working} onClick={() => { changingQuery(); setPage(page + 1); }}>Próxima</button>
      </div>
    </>}
  </div>;
}
