"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import {
  WEBSITE_BILLING_CYCLES, WEBSITE_RECURRING_CYCLES, websiteRecurringPrices,
  type WebsitePlan, type WebsiteRecurringCycle,
} from '@/lib/website-plans';
import { WEBSITE_PAYMENT_METHODS, type WebsitePaymentMethod } from '@/lib/website-contracts';
import type { WebsiteSubscription } from '@/lib/website-subscription-terms';
import {
  commercialButtonClass, commercialInputClass, commercialLabelClass, commercialMoney,
  commercialSecondaryClass, HoldingCommercialSelect,
} from '@/components/HoldingCommercialFields';

type Options = { customers: Array<{ id: string; name: string; document: string }>; plans: WebsitePlan[] };
type Form = {
  request_id: string; customer_id: string; plan_id: string; billing_cycle: WebsiteRecurringCycle;
  amount: string; first_due_date: string; payment_method: WebsitePaymentMethod; fiscal_confirmed: boolean;
};
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
  const selected = options.plans.find((plan) => plan.id === form?.plan_id);
  const cycles = selected ? WEBSITE_RECURRING_CYCLES.filter((cycle) => websiteRecurringPrices(selected)[cycle]) : [];

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
  async function billing(row: WebsiteSubscription, action: 'generate' | 'sync') {
    if (busy.current) return;
    if (!window.confirm(action === 'generate'
      ? `Ativar assinatura de ${commercialMoney(row.amount_cents)} por ciclo ${WEBSITE_BILLING_CYCLES[row.plan_snapshot.billing_cycle]} para ${row.customer_snapshot.name}?\n\nEm produção, o Asaas gerará cobranças contínuas até a pausa/cancelamento. Cada pagamento confirmado emitirá uma NFS-e real pelo valor do período. No sandbox não haverá nota de produção.`
      : 'Consultar a assinatura no Asaas? Pagamentos confirmados de produção ainda sem operação fiscal reservada poderão gerar NFS-e automaticamente.')) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-subscriptions/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, action }),
      });
      const payload: { message?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Falha no Asaas.');
      setMessage(payload.message || 'Consulta concluída.');
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
        <button className={commercialButtonClass} disabled={loading || working || Boolean(form) || Boolean(loadError)} onClick={() => {
          setError(''); setMessage(''); setForm({ request_id: crypto.randomUUID(), customer_id: '', plan_id: '',
            billing_cycle: 'monthly', amount: '', first_due_date: '', payment_method: 'PIX', fiscal_confirmed: false });
        }}>Nova assinatura</button>
      </div>
    </header>
    <div className="space-y-2 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
      <p>Hospedagem/manutenção com ciclos e preços do catálogo. Personalize o valor por cliente ao contratar; os demais contratos não mudam. Cada cobrança é o total do período, sem parcelamento.</p>
      <p>Salvar não cobra. Ativar cria a recorrência no Asaas. Pix/boleto exigem pagamento do cliente a cada ciclo; cartão é informado na fatura segura do Asaas, sem dados do cartão na Holding.</p>
      <p>NFS-e automática após confirmação do pagamento em produção, com competência na primeira data de confirmação registrada. Uma nota pelo valor integral do período, inclusive no anual. Empréstimos e transferências não são gatilhos fiscais.</p>
      <p>Somente ME/EPP do Simples, ISS não retido e prestação no município do emitente, com enquadramento e percentual vigentes confirmados pela contabilidade. O emissor atual suporta 2026; pagamentos de 2027 ficam em revisão até atualização IBS/CBS.</p>
      <p>Para pausar/cancelar, use o painel Asaas e depois Consultar Asaas. A pausa não cancela cobranças existentes; estornos não cancelam notas automaticamente. Nenhum fluxo Glass/Barber é alterado.</p>
    </div>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {(error || loadError) && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error || loadError}</p>}
    {form && <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold text-slate-800">Nova assinatura — valor personalizado</h2>
      <fieldset disabled={working} className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <label className={commercialLabelClass}><span>Cliente *</span>
            <HoldingCommercialSelect required value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value, fiscal_confirmed: false })}>
              <option value="">Selecione</option>{options.customers.map((row) => <option key={row.id} value={row.id}>{row.name} — {row.document}</option>)}
            </HoldingCommercialSelect></label>
          <label className={commercialLabelClass}><span>Produto *</span>
            <HoldingCommercialSelect required value={form.plan_id} onChange={(event) => {
              const plan = options.plans.find((row) => row.id === event.target.value);
              const cycle = plan?.billing_cycle === 'one_time' ? 'monthly' : plan?.billing_cycle || 'monthly';
              const price = plan ? websiteRecurringPrices(plan)[cycle] : undefined;
              setForm({ ...form, plan_id: event.target.value, billing_cycle: cycle, amount: price ? (price / 100).toFixed(2) : '', fiscal_confirmed: false });
            }}>
              <option value="">Selecione</option>{options.plans.map((row) => <option key={row.id} value={row.id}>{row.name}{!row.fiscal_config?.accountant_confirmed ? ' — fiscal pendente' : ''}</option>)}
            </HoldingCommercialSelect></label>
          <label className={commercialLabelClass}><span>Ciclo *</span>
            <HoldingCommercialSelect required value={form.billing_cycle} onChange={(event) => {
              const cycle = event.target.value as WebsiteRecurringCycle;
              const price = selected ? websiteRecurringPrices(selected)[cycle] : undefined;
              setForm({ ...form, billing_cycle: cycle, amount: price ? (price / 100).toFixed(2) : '', fiscal_confirmed: false });
            }}>
              {!selected && <option value="monthly">Selecione o produto</option>}
              {cycles.map((cycle) => <option key={cycle} value={cycle}>{WEBSITE_BILLING_CYCLES[cycle]}</option>)}
            </HoldingCommercialSelect></label>
          <label className={commercialLabelClass}><span>Valor personalizado por período (R$) *</span>
            <input className={commercialInputClass} type="number" step="0.01" min="0.01" max="9999999.99" required value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value, fiscal_confirmed: false })} /></label>
          <label className={commercialLabelClass}><span>Primeiro vencimento *</span>
            <input className={commercialInputClass} type="date" required value={form.first_due_date}
              onChange={(event) => setForm({ ...form, first_due_date: event.target.value })} /></label>
          <label className={commercialLabelClass}><span>Forma de pagamento *</span>
            <HoldingCommercialSelect value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value as WebsitePaymentMethod })}>
              {Object.entries(WEBSITE_PAYMENT_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </HoldingCommercialSelect></label>
        </div>
        {selected && <p className="whitespace-pre-wrap text-sm text-slate-600">Escopo: {selected.scope}</p>}
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" required checked={form.fiscal_confirmed} onChange={(event) => setForm({ ...form, fiscal_confirmed: event.target.checked })} />
          Confirmo o enquadramento e percentual vigentes, as condições tributárias acima e autorizo a emissão automática após cada pagamento, pela data de confirmação e total do período.
        </label>
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
      <div className="flex justify-end"><button className={commercialButtonClass} disabled={working || Boolean(form) || row.billing_state === 'processing'}
        onClick={() => void billing(row, row.billing_state === 'local' ? 'generate' : 'sync')}>
        {row.billing_state === 'local' ? 'Ativar no Asaas' : 'Consultar Asaas'}
      </button></div>
    </article>)}
  </div>;
}
