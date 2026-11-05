"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import {
  WEBSITE_BILLING_CYCLES, type WebsitePlan,
} from '@/lib/website-plans';
import { WEBSITE_SUBSCRIPTION_STATES, type WebsiteSubscription, type WebsiteSubscriptionAction } from '@/lib/website-subscription-terms';
import { EMPTY_WEBSITE_SUBSCRIPTION, WebsiteSubscriptionFields, type WebsiteSubscriptionForm } from '@/components/WebsiteSubscriptionFields';
import {
  commercialButtonClass, commercialInputClass, commercialLabelClass, commercialMoney,
  commercialSecondaryClass, HoldingCommercialSelect,
} from '@/components/HoldingCommercialFields';

type Options = { customers: Array<{ id: string; name: string; document: string }>; plans: WebsitePlan[] };
type Form = WebsiteSubscriptionForm & { request_id: string; customer_id: string };
const STATES = { local: 'Somente na Holding', processing: 'Processando — não reenviar', review: 'Revisão necessária', issued: 'Vinculada ao Asaas' };
const dateLabel = (date: string) => date.split('-').reverse().join('/');

export default function WebsiteSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<WebsiteSubscription[]>([]);
  const [options, setOptions] = useState<Options>({ customers: [], plans: [] });
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [resume, setResume] = useState<{ row: WebsiteSubscription; date: string } | null>(null);
  const busy = useRef(false);
  const load = useCallback((signal?: AbortSignal) => (
    holdingAuthFetch('/api/admin/website-subscriptions', { signal }).then(async (response) => {
      const payload: Partial<Options> & { subscriptions?: WebsiteSubscription[]; error?: string } = await response.json();
      if (!response.ok || !Array.isArray(payload.subscriptions) || !Array.isArray(payload.customers) || !Array.isArray(payload.plans)) {
        throw new Error(payload.error || 'Resposta de assinaturas inválida.');
      }
      if (!signal?.aborted) {
        setSubscriptions(payload.subscriptions); setOptions({ customers: payload.customers, plans: payload.plans }); setLoadError('');
      }
    }).catch((failure: unknown) => {
      if (!signal?.aborted) {
        console.error('[WEBSITE SUBSCRIPTIONS] Falha ao carregar.');
        setLoadError(failure instanceof Error ? failure.message : 'Falha ao carregar assinaturas.');
      }
    }).finally(() => { if (!signal?.aborted) setLoading(false); })
  ), []);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy.current) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount_cents: Math.round(Number(form.amount) * 100) }),
      });
      const payload: { id?: string; error?: string } = await response.json();
      if (!response.ok || !payload.id) throw new Error(payload.error || 'Banco não confirmou a assinatura.');
      setForm(null); setMessage('Assinatura salva sem cobrar. Use Ativar no Asaas quando desejar iniciar a recorrência.');
      await load();
    } catch (failure) {
      console.error('[WEBSITE SUBSCRIPTIONS] Falha ao salvar.');
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
    } finally { busy.current = false; setWorking(false); }
  }
  async function billing(row: WebsiteSubscription, action: 'generate' | 'sync' | WebsiteSubscriptionAction, nextDueDate?: string) {
    if (busy.current) return;
    const change = action === 'pause' || action === 'resume' || action === 'cancel';
    const prompt = action === 'pause'
      ? 'Pausar novas cobranças desta assinatura Websites? Cobranças já emitidas, inclusive vencidas, continuam válidas. A hospedagem do site não será desligada automaticamente.'
      : action === 'cancel'
        ? 'Encerrar esta assinatura Websites? A recorrência será inativada no Asaas e não poderá ser reativada pela Holding. Cobranças pendentes/vencidas, pagamentos e notas serão preservados. A hospedagem do site não será desligada automaticamente.'
        : action === 'resume'
          ? `Reativar esta assinatura Websites com próximo vencimento em ${dateLabel(nextDueDate || '')}? Novas cobranças voltarão a ser geradas. Cobranças já emitidas não serão alteradas.`
          : action === 'generate'
      ? `Confirmo que o cliente aprovou a entrega e esta assinatura. Ativar ${commercialMoney(row.amount_cents)} por ciclo ${WEBSITE_BILLING_CYCLES[row.plan_snapshot.billing_cycle]} para ${row.customer_snapshot.name}?\n\nPara projetos vinculados, a primeira aprovação conclui a produção e gera uma única produtividade a pagar ao webdesigner, sem pagamento automático.\n\nEm produção, o Asaas gerará cobranças contínuas até a pausa/cancelamento. Cada pagamento confirmado emitirá uma NFS-e real pelo valor do período. No sandbox não haverá nota de produção.`
      : 'Consultar a assinatura no Asaas? Pagamentos confirmados de produção ainda sem operação fiscal reservada poderão gerar NFS-e automaticamente.';
    if (!window.confirm(`${row.customer_snapshot.name} — ${row.plan_snapshot.name}\n\n${prompt}`)) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-subscriptions/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          id: row.id, action, ...(change || action === 'generate' ? { confirmed: true } : {}), ...(action === 'resume' ? { next_due_date: nextDueDate } : {}),
        }),
      });
      const payload: { message?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Falha no Asaas.');
      setMessage(payload.message || 'Consulta concluída.');
      setResume(null);
    } catch (failure) {
      console.error('[WEBSITE SUBSCRIPTIONS] Falha na operação Asaas.');
      setError(failure instanceof Error ? failure.message : 'Falha no Asaas. Confira o painel antes de repetir.');
    } finally { await load(); busy.current = false; setWorking(false); }
  }
  return <div className="mx-auto max-w-[1200px] space-y-6 pb-12">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold text-slate-800">Websites — assinaturas recorrentes</h1>
        <Link href="/assinaturas/websites" className="text-sm text-blue-700 underline">Ver projetos e parcelamentos</Link></div>
      <div className="flex flex-wrap gap-2">
        <button className={commercialSecondaryClass} disabled={loading || working || Boolean(form)} onClick={() => { setLoading(true); void load(); }}>Atualizar</button>
        <button className={commercialButtonClass} disabled={loading || working || Boolean(form) || Boolean(resume) || Boolean(loadError)} onClick={() => {
          setError(''); setMessage(''); setForm({ ...EMPTY_WEBSITE_SUBSCRIPTION, request_id: crypto.randomUUID(), customer_id: '' });
        }}>Nova assinatura</button>
      </div>
    </header>
    <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
      <summary className="cursor-pointer font-semibold text-slate-700">Orientações de assinaturas e interrupção</summary>
      <div className="mt-3 space-y-2">
      <p>Hospedagem/manutenção com ciclos e preços do catálogo. Personalize o valor por cliente ao contratar; os demais contratos não mudam. Cada cobrança é o total do período, sem parcelamento.</p>
      <p>Salvar não cobra. Ativar cria a recorrência no Asaas. Pix/boleto exigem pagamento do cliente a cada ciclo; cartão é informado na fatura segura do Asaas, sem dados do cartão na Holding.</p>
      <p>NFS-e automática após confirmação do pagamento em produção, com competência na primeira data de confirmação registrada. Uma nota pelo valor integral do período, inclusive no anual. Empréstimos e transferências não são gatilhos fiscais.</p>
      <p>Somente ME/EPP do Simples, ISS não retido e prestação no município do emitente, com enquadramento e percentual vigentes confirmados pela contabilidade. O emissor atual suporta 2026; pagamentos de 2027 ficam em revisão até atualização IBS/CBS.</p>
      <p>Pause, reative com um novo vencimento ou encerre pelos botões da assinatura. Encerrar inativa a recorrência no Asaas e bloqueia reativação pela Holding, preservando cobranças pendentes/vencidas, pagamentos e notas. Não remove a assinatura via DELETE no Asaas nem desliga a hospedagem do site. Estornos não cancelam notas automaticamente. Nenhum fluxo Glass/Barber é alterado.</p>
      </div>
    </details>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {(error || loadError) && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
    {resume && <form className="space-y-4 rounded-xl border border-slate-200 bg-white p-5" onSubmit={(event) => {
      event.preventDefault(); void billing(resume.row, 'resume', resume.date);
    }}>
      <h2 className="font-bold text-slate-800">Reativar — {resume.row.customer_snapshot.name} / {resume.row.plan_snapshot.name}</h2>
      <fieldset disabled={working} className="space-y-4">
        <label className={commercialLabelClass}><span>Próximo vencimento *</span>
          <input required type="date" className={commercialInputClass} value={resume.date} onChange={(event) => setResume({ ...resume, date: event.target.value })} />
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className={commercialSecondaryClass} onClick={() => setResume(null)}>Voltar</button>
          <button type="submit" className={commercialButtonClass}>Confirmar reativação</button>
        </div>
      </fieldset>
    </form>}
    {form && <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold text-slate-800">Nova assinatura — valor personalizado</h2>
      <fieldset disabled={working} className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <label className={commercialLabelClass}><span>Cliente *</span>
            <HoldingCommercialSelect required value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value, fiscal_confirmed: false })}>
              <option value="">Selecione</option>{options.customers.map((row) => <option key={row.id} value={row.id}>{row.name} — {row.document}</option>)}
            </HoldingCommercialSelect></label>
        </div>
        <WebsiteSubscriptionFields value={form} plans={options.plans} onChange={(value) => setForm({ ...form, ...value })} />
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className={commercialSecondaryClass} onClick={() => setForm(null)}>Cancelar</button>
          <button type="submit" className={commercialButtonClass}>Salvar sem cobrar</button>
        </div>
      </fieldset>
    </form>}
    {loading && <p role="status">Carregando assinaturas...</p>}
    {!loading && !loadError && !subscriptions.length && <p className="rounded-xl border border-dashed p-6 text-slate-500">Nenhuma assinatura recorrente cadastrada.</p>}
    {subscriptions.map((row) => <article key={row.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div><h2 className="font-bold text-slate-800">{row.plan_snapshot.name}</h2><p className="text-sm text-slate-600">{row.customer_snapshot.name}</p></div>
        <div className="text-sm"><strong>{commercialMoney(row.amount_cents)}</strong> · {WEBSITE_BILLING_CYCLES[row.plan_snapshot.billing_cycle]}<p>{STATES[row.billing_state]}{row.remote_status ? ` · ${row.remote_status}` : ''}</p></div>
      </div>
      <p className="text-sm font-semibold text-slate-700">{row.approval_status === 'pending' ? 'Aguardando aprovação do cliente e ativação pelo gestor' : WEBSITE_SUBSCRIPTION_STATES[row.lifecycle_status]}</p>
      {row.contract_id && <Link href="/assinaturas/websites" className="block text-sm text-blue-700 underline">Contratada junto com a criação — ver projeto</Link>}
      {row.pending_action && <p role="alert" className="text-sm text-amber-800">Alteração pendente de confirmação. Consulte o Asaas antes de qualquer nova ação.</p>}
      {row.last_error && <p role="alert" className="text-sm text-red-700">{row.last_error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm"><thead><tr><th className="p-2">Vencimento</th><th className="p-2">Valor</th><th className="p-2">Pagamento</th><th className="p-2">NFS-e</th><th className="p-2">Cobrança</th></tr></thead>
          <tbody>{[...row.holding_website_subscription_payments].sort((a, b) => a.due_date.localeCompare(b.due_date)).map((payment) => <tr key={payment.id} className="border-t border-slate-100 align-top">
            <td className="p-2 whitespace-nowrap">{dateLabel(payment.due_date)}</td><td className="p-2 whitespace-nowrap">{commercialMoney(payment.amount_cents)}</td>
            <td className="p-2">{payment.status}{payment.paid_on && <p>{dateLabel(payment.paid_on)}</p>}</td>
            <td className="p-2"><Link href="/notas-fiscais" className="text-blue-700 underline">{payment.holding_website_invoices[0]?.status || (payment.fiscal_error ? 'Pendente / revisar' : row.asaas_environment === 'sandbox' ? 'Sandbox — sem emissão real' : 'Aguardando pagamento')}</Link>
              {payment.fiscal_error && <p role="alert" className="max-w-sm text-red-700">{payment.fiscal_error}</p>}</td>
            <td className="p-2"><a href={payment.invoice_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Abrir Asaas</a></td>
          </tr>)}</tbody></table>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        {row.lifecycle_status !== 'cancelled' && !row.pending_action && (row.billing_state === 'local' || row.billing_state === 'issued') && <>
          <button className={commercialSecondaryClass} disabled={working || Boolean(form) || Boolean(resume)} onClick={() => {
            if (row.lifecycle_status === 'paused') { setError(''); setResume({ row, date: '' }); }
            else void billing(row, 'pause');
          }}>{row.lifecycle_status === 'paused' ? 'Reativar' : 'Pausar'}</button>
          <button className={commercialSecondaryClass} disabled={working || Boolean(form) || Boolean(resume)} onClick={() => void billing(row, 'cancel')}>Encerrar assinatura</button>
        </>}
        {(row.billing_state !== 'local' || row.lifecycle_status === 'active') && <button className={commercialButtonClass} disabled={working || Boolean(form) || Boolean(resume) || row.billing_state === 'processing'}
        onClick={() => void billing(row, row.billing_state === 'local' ? 'generate' : 'sync')}>
        {row.billing_state === 'local' ? 'Ativar no Asaas' : 'Consultar Asaas'}
      </button>}
      </div>
    </article>)}
  </div>;
}
