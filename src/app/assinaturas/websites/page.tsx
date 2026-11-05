"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Globe, Loader2, Plus } from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { buildWebsiteSchedule, WEBSITE_PAYMENT_METHODS, type WebsiteContract, type WebsitePaymentMethod } from '@/lib/website-contracts';
import type { WebsitePlan } from '@/lib/website-plans';
import { EMPTY_WEBSITE_SUBSCRIPTION, WebsiteSubscriptionFields, type WebsiteSubscriptionForm } from '@/components/WebsiteSubscriptionFields';
import {
  commercialButtonClass, commercialInputClass, commercialLabelClass, commercialMoney,
  commercialSecondaryClass, HoldingCommercialSelect,
} from '@/components/HoldingCommercialFields';

type Options = {
  customers: Array<{ id: string; name: string; document: string }>;
  plans: Array<{ id: string; name: string; price_cents: number; scope: string }>;
  recurring_plans: WebsitePlan[];
};
type Form = {
  id?: string; revision?: number;
  request_id: string; customer_id: string; plan_id: string; total: string; count: string;
  first_due_date: string; deposit: string; deposit_due_date: string; payment_method: WebsitePaymentMethod;
  subscription: WebsiteSubscriptionForm | null;
};
const STATES = { local: 'Somente na Holding', processing: 'Processando — não reenviar', review: 'Revisão necessária', issued: 'Emitido no Asaas' };
const STATUS: Record<string, string> = {
  LOCAL: 'Sem cobrança emitida', PENDING: 'Pendente', RECEIVED: 'Recebido', CONFIRMED: 'Confirmado',
  RECEIVED_IN_CASH: 'Recebido em dinheiro', OVERDUE: 'Vencido', REFUNDED: 'Estornado',
  DELETED: 'Excluído', REFUND_REQUESTED: 'Estorno solicitado',
};
const dateLabel = (value: string) => value.split('-').reverse().join('/');

export default function WebsiteContractsPage() {
  const [contracts, setContracts] = useState<WebsiteContract[]>([]);
  const [options, setOptions] = useState<Options>({ customers: [], plans: [], recurring_plans: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [billingId, setBillingId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<{
    id: string; competence: string;
    preview: { customer: string; total_cents: number; national_code: string; municipal_code: string; nbs: string; description: string; simples_percent: number } | null;
  } | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  const busy = useRef(false);

  const load = useCallback((signal?: AbortSignal) => (
    Promise.all([
      holdingAuthFetch('/api/admin/website-contracts', { signal }),
      holdingAuthFetch('/api/admin/website-contracts/options', { signal }),
    ]).then(async ([contractRes, optionsRes]) => {
      const contractData: { contracts?: WebsiteContract[]; error?: string } = await contractRes.json();
      const optionData: Partial<Options> & { error?: string } = await optionsRes.json();
      if (!contractRes.ok || !Array.isArray(contractData.contracts)) throw new Error(contractData.error || 'Não foi possível carregar as contratações.');
      if (!optionsRes.ok || !Array.isArray(optionData.customers) || !Array.isArray(optionData.plans) || !Array.isArray(optionData.recurring_plans)) {
        throw new Error(optionData.error || 'Não foi possível carregar clientes e produtos.');
      }
      if (!signal?.aborted) {
        setContracts(contractData.contracts);
        setOptions({ customers: optionData.customers, plans: optionData.plans, recurring_plans: optionData.recurring_plans });
      }
    }).catch((failure: unknown) => {
      if (!signal?.aborted) {
        console.error('[WEBSITE CONTRACTS] Falha ao carregar dados.');
        setLoadError(failure instanceof Error ? failure.message : 'Falha ao carregar dados.');
      }
    }).finally(() => { if (!signal?.aborted) setLoading(false); })
  ), []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const scheduleInput = form ? {
    total_cents: Math.round(Number(form.total) * 100), count: Number(form.count),
    first_due_date: form.first_due_date, deposit_cents: Math.round(Number(form.deposit || 0) * 100),
    deposit_due_date: form.deposit_due_date,
  } : null;
  let preview: ReturnType<typeof buildWebsiteSchedule> = [];
  let previewError = '';
  if (scheduleInput) {
    try { preview = buildWebsiteSchedule(scheduleInput); } catch (failure) {
      previewError = failure instanceof Error ? failure.message : 'Cronograma inválido.';
    }
  }
  function newContract() {
    setError(''); setMessage('');
    setForm({
      request_id: crypto.randomUUID(), customer_id: '', plan_id: '', total: '', count: '1',
      first_due_date: '', deposit: '', deposit_due_date: '', payment_method: 'PIX',
      subscription: null,
    });
  }
  function editContract(contract: WebsiteContract) {
    if (busy.current) return;
    if (contract.asaas_environment && !window.confirm(
      'Para editar, todas as cobranças anteriores precisam estar excluídas no Asaas e não pode haver nota fiscal vinculada. O sistema verificará isso ao salvar, sem excluir cobranças automaticamente. Continuar?',
    )) return;
    const rows = [...contract.holding_website_installments].sort((a, b) => a.number - b.number);
    const deposit = rows.find((row) => row.kind === 'deposit');
    const balance = rows.filter((row) => row.kind === 'balance');
    setError(''); setMessage('');
    setForm({
      id: contract.id, revision: contract.edit_revision ?? 0, request_id: crypto.randomUUID(),
      customer_id: contract.customer_id, plan_id: contract.plan_id, total: (contract.total_cents / 100).toFixed(2),
      payment_method: contract.payment_method, count: String(balance.length),
      first_due_date: balance[0]?.due_date || '', deposit: deposit ? (deposit.amount_cents / 100).toFixed(2) : '',
      deposit_due_date: deposit?.due_date || '', subscription: null,
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !scheduleInput || busy.current) return;
    if (previewError) { setError(previewError); return; }
    busy.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-contracts', {
        method: form.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scheduleInput, customer_id: form.customer_id, plan_id: form.plan_id,
          payment_method: form.payment_method, request_id: form.request_id,
          ...(form.id ? { id: form.id, revision: form.revision } : {}),
          subscription: form.subscription ? { ...form.subscription, amount_cents: Math.round(Number(form.subscription.amount) * 100) } : null,
        }),
      });
      const payload: { id?: string; subscription_id?: string; error?: string } = await response.json();
      if (!response.ok || !payload.id) throw new Error(payload.error || 'O banco não confirmou a contratação.');
      if (form.subscription && !payload.subscription_id) throw new Error('O banco não confirmou a assinatura conjunta. Atualize e confira os cadastros antes de repetir.');
      setForm(null);
      setMessage(form.id ? 'Contratação editada, com histórico preservado e sem cobrar. A assinatura recorrente não foi alterada.' : payload.subscription_id
        ? 'Criação e assinatura salvas juntas, sem cobrar. Gere as parcelas do projeto aqui e ative a hospedagem/manutenção em Assinaturas recorrentes.'
        : 'Contratação e parcelas salvas somente na Holding. Para cobrar, use Gerar no Asaas.');
      await load();
    } catch (failure) {
      console.error('[WEBSITE CONTRACTS] Falha ao salvar contratação.');
      setError(failure instanceof Error ? failure.message : 'Falha ao salvar contratação.');
    } finally { busy.current = false; setSaving(false); }
  }
  async function billing(contract: WebsiteContract, action: 'generate' | 'sync') {
    if (busy.current) return;
    if (action === 'generate' && !window.confirm(
      `Gerar cobranças para ${contract.customer_snapshot.name}, no total de ${commercialMoney(contract.total_cents)}, via ${WEBSITE_PAYMENT_METHODS[contract.payment_method]}?\n\nSe o Asaas estiver em produção, serão cobranças reais e o cliente poderá receber notificações. Entrada e saldo no cartão geram pagamentos separados. Nenhuma nota fiscal será emitida.`,
    )) return;
    busy.current = true; setBillingId(contract.id); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-contracts/billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: contract.id, action }),
      });
      const payload: { message?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Falha no Asaas.');
      setMessage(payload.message || 'Consulta concluída.');
    } catch (failure) {
      console.error('[WEBSITE CONTRACTS] Falha na operação Asaas.');
      setError(failure instanceof Error ? failure.message : 'Falha no Asaas. Confira o painel antes de tentar novamente.');
    } finally {
      await load();
      busy.current = false; setBillingId(null);
    }
  }
  async function invoice(event: FormEvent, confirmed: boolean) {
    event.preventDefault();
    if (!invoiceForm || busy.current) return;
    if (confirmed && (!invoiceForm.preview || !window.confirm(
      `Emitir NFS-e REAL em PRODUÇÃO para ${invoiceForm.preview.customer}, no total de ${commercialMoney(invoiceForm.preview.total_cents)}, competência ${dateLabel(invoiceForm.competence)}?\n\nA emissão independe do pagamento. Confirme a prestação, o enquadramento fiscal e o percentual de tributos vigentes. Este fluxo exige ME/EPP do Simples, ISS não retido e prestação no município do emitente. Não use para outro tratamento tributário. Esta operação não poderá ser repetida para o mesmo contrato.`,
    ))) return;
    busy.current = true; setInvoicing(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-contracts/invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invoiceForm.id, competence: invoiceForm.competence, confirmed }),
      });
      const payload: { sent?: boolean; preview?: NonNullable<typeof invoiceForm>['preview']; message?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível processar a nota.');
      if (confirmed) {
        if (payload.sent !== true) throw new Error('Emissão não confirmada. Consulte o histórico antes de repetir.');
        setInvoiceForm(null); setMessage(payload.message || 'Nota emitida.');
      } else {
        if (!payload.preview) throw new Error('Prévia fiscal não retornada.');
        setInvoiceForm({ ...invoiceForm, preview: payload.preview });
      }
    } catch (failure) {
      console.error('[WEBSITE NFS-E] Falha ao processar nota.');
      setError(failure instanceof Error ? failure.message : 'Confira a operação fiscal antes de reenviar.');
      if (confirmed) setInvoiceForm(null);
    } finally {
      if (confirmed) await load();
      busy.current = false; setInvoicing(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800"><Globe size={24} /> Websites — contratações</h1>
          <p className="mt-1 text-sm text-slate-500">Projetos e parcelas da Holding, sem integração operacional com Glass ou Barber.</p>
          <Link href="/assinaturas/websites/recorrentes" className="text-sm text-blue-700 underline">Hospedagem e manutenção — assinaturas recorrentes</Link>
        </div>
        <div className="flex gap-2">
          <button type="button" className={commercialSecondaryClass} disabled={loading || Boolean(form) || Boolean(billingId) || Boolean(invoiceForm)} onClick={() => {
            setLoading(true); setLoadError(''); void load();
          }}>Atualizar</button>
          <button type="button" className={commercialButtonClass} disabled={loading || Boolean(loadError) || Boolean(form) || Boolean(billingId) || Boolean(invoiceForm)}
            onClick={newContract}><Plus size={16} /> Nova contratação</button>
        </div>
      </header>
      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">Orientações de contratação e cobrança</summary>
        <div className="mt-3 space-y-2">
        <p>1. Cadastre o cliente em <Link href="/clientes" className="font-bold underline">Clientes</Link>. 2. Escolha um produto de cobrança única. 3. Confira as parcelas e salve. 4. Gere no Asaas somente quando desejar cobrar.</p>
        <p>Pix e boleto: parcelas mensais por vencimento. Cartão: uma compra parcelada para o saldo, com preenchimento do cartão na página segura do Asaas. Com entrada, haverá um pagamento separado para ela.</p>
        <p>Projetos: NFS-e nacional somente pelo botão, no valor total e independentemente do pagamento. Entradas bancárias, empréstimos, aportes e transferências não geram nota. Para hospedagem/manutenção, use Assinaturas recorrentes acima.</p>
        <p>O acompanhamento das cobranças é por consulta explícita ao Asaas, sem baixa automática no financeiro e sem encaminhar Websites ao processamento SaaS.</p>
        </div>
      </details>
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{loadError}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {invoiceForm && (
        <form onSubmit={(event) => void invoice(event, Boolean(invoiceForm.preview))} className="space-y-4 rounded-2xl border border-amber-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-800">Emitir NFS-e nacional — projeto completo</h2>
          <fieldset disabled={invoicing} className="space-y-4">
            <label className={commercialLabelClass}><span>Competência da prestação *</span>
              <input className={commercialInputClass} type="date" required value={invoiceForm.competence}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, competence: event.target.value, preview: null })} />
            </label>
            <p className="text-sm text-slate-600">Confirme a competência e o enquadramento fiscal com a contabilidade. A nota usa os dados preservados na contratação e o certificado A1 da Holding, sem consultar Glass/Barber.</p>
            <p className="text-sm text-amber-800">Somente ME/EPP do Simples, com ISS não retido e prestação no município do emitente. Se o serviço exigir outro tratamento tributário, não emita por este fluxo.</p>
            {invoiceForm.preview && <div className="space-y-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              <p><strong>Tomador:</strong> {invoiceForm.preview.customer}</p>
              <p><strong>Valor total:</strong> {commercialMoney(invoiceForm.preview.total_cents)}</p>
              <p><strong>Tributação nacional:</strong> {invoiceForm.preview.national_code} · <strong>NBS:</strong> {invoiceForm.preview.nbs}</p>
              <p><strong>Complemento municipal:</strong> {invoiceForm.preview.municipal_code || 'Não informado (opcional)'}</p>
              <p><strong>Tributos aproximados do Simples:</strong> {invoiceForm.preview.simples_percent}%</p>
              <p className="whitespace-pre-wrap">{invoiceForm.preview.description}</p>
              <p className="font-bold">A próxima confirmação enviará uma nota real ao Emissor Nacional. Não é cobrança bancária.</p>
            </div>}
            <div className="flex justify-end gap-3">
              <button type="button" className={commercialSecondaryClass} onClick={() => setInvoiceForm(null)}>Cancelar</button>
              <button type="submit" className={commercialButtonClass}>
                {invoicing && <Loader2 className="animate-spin" size={16} />}
                {invoiceForm.preview ? 'Confirmar emissão real' : 'Validar e visualizar prévia'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {form && (
        <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800">{form.id ? 'Editar contratação de projeto' : 'Nova contratação de projeto'}</h2>
          {form.id && <p className="text-sm text-amber-800">A edição exige ausência de nota fiscal e exclusão das cobranças anteriores no Asaas. O histórico será preservado. Hospedagem/manutenção é gerenciada separadamente.</p>}
          <fieldset disabled={saving} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className={commercialLabelClass}><span>Cliente *</span>
                <HoldingCommercialSelect required disabled={Boolean(form.id)} value={form.customer_id} onChange={(event) => setForm({
                  ...form, customer_id: event.target.value, subscription: form.subscription ? { ...form.subscription, fiscal_confirmed: false } : null,
                })}>
                  <option value="">Selecione o cliente</option>
                  {options.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} — {customer.document}</option>)}
                </HoldingCommercialSelect>
              </label>
              <label className={commercialLabelClass}><span>Produto *</span>
                <HoldingCommercialSelect required value={form.plan_id} onChange={(event) => {
                  const plan = options.plans.find((item) => item.id === event.target.value);
                  setForm({ ...form, plan_id: event.target.value, total: plan ? (plan.price_cents / 100).toFixed(2) : '' });
                }}>
                  <option value="">Selecione o produto</option>
                  {options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </HoldingCommercialSelect>
              </label>
              <label className={commercialLabelClass}><span>Preço total negociado (R$) *</span>
                <input className={commercialInputClass} type="number" step="0.01" min="0.01" max="9999999.99" required value={form.total}
                  onChange={(event) => setForm({ ...form, total: event.target.value })} />
              </label>
              <label className={commercialLabelClass}><span>Forma de pagamento *</span>
                <HoldingCommercialSelect value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value as WebsitePaymentMethod })}>
                  {Object.entries(WEBSITE_PAYMENT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </HoldingCommercialSelect>
              </label>
              <label className={commercialLabelClass}><span>Entrada opcional (R$)</span>
                <input className={commercialInputClass} type="number" min="0" step="0.01" max="9999999.98" value={form.deposit}
                  onChange={(event) => setForm({ ...form, deposit: event.target.value })} placeholder="Sem entrada" />
              </label>
              <label className={commercialLabelClass}><span>Vencimento da entrada{Number(form.deposit) > 0 ? ' *' : ''}</span>
                <input className={commercialInputClass} type="date" disabled={Number(form.deposit) <= 0} required={Number(form.deposit) > 0}
                  value={form.deposit_due_date} onChange={(event) => setForm({ ...form, deposit_due_date: event.target.value })} />
              </label>
              <label className={commercialLabelClass}><span>Parcelas do saldo *</span>
                <HoldingCommercialSelect value={form.count} onChange={(event) => setForm({ ...form, count: event.target.value })}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1 === 1 ? 'À vista / saldo em 1×' : `${i + 1}× mensais`}</option>)}
                </HoldingCommercialSelect>
              </label>
              <label className={commercialLabelClass}><span>Primeiro vencimento do saldo *</span>
                <input className={commercialInputClass} type="date" required value={form.first_due_date}
                  onChange={(event) => setForm({ ...form, first_due_date: event.target.value })} />
              </label>
            </div>
            {form.plan_id && <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              <strong>Escopo contratado: </strong>{options.plans.find((plan) => plan.id === form.plan_id)?.scope}
            </p>}
            {!options.customers.length && <p className="text-sm text-amber-700">Cadastre primeiro um cliente ativo em Clientes.</p>}
            {!options.plans.length && <p className="text-sm text-amber-700">Cadastre primeiro um produto ativo de confecção ou alterações em Planos → Websites.</p>}
            {preview.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <caption className="p-3 text-left font-bold text-slate-700">Prévia das parcelas — total {commercialMoney(scheduleInput!.total_cents)}</caption>
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Parcela</th><th className="p-3">Vencimento</th><th className="p-3">Valor</th></tr></thead>
                  <tbody>{preview.map((row) => <tr key={row.number} className="border-t border-slate-100">
                    <td className="p-3">{row.kind === 'deposit' ? 'Entrada' : `Saldo ${row.number - (Number(form.deposit) > 0 ? 1 : 0)}/${form.count}`}</td>
                    <td className="p-3">{dateLabel(row.due_date)}</td><td className="p-3">{commercialMoney(row.amount_cents)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">{previewError}</p>}
            <p className="text-xs text-slate-500">Sem juros adicionais nesta etapa. Eventuais centavos ficam na última parcela. Edições preservam o histórico e atualizam o escopo e os dados cadastrais a partir do cliente e produto atuais.</p>
            {!form.id && <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={Boolean(form.subscription)} onChange={(event) => setForm({
                ...form, subscription: event.target.checked ? { ...EMPTY_WEBSITE_SUBSCRIPTION } : null,
              })} /> Incluir hospedagem / manutenção nesta contratação
            </label>}
            {form.subscription && <section className="space-y-5 rounded-xl border border-slate-200 p-4">
              <h3 className="font-bold text-slate-800">Assinatura opcional para o mesmo cliente</h3>
              <WebsiteSubscriptionFields value={form.subscription} plans={options.recurring_plans}
                onChange={(subscription) => setForm({ ...form, subscription })} />
              {!options.recurring_plans.length && <p role="alert" className="text-sm text-amber-700">Cadastre primeiro um produto recorrente em Planos → Websites.</p>}
            </section>}
            <div className="flex justify-end gap-3">
              <button type="button" className={commercialSecondaryClass} onClick={() => setForm(null)}>Cancelar</button>
              <button type="submit" className={commercialButtonClass} disabled={Boolean(previewError) || !form.customer_id || !form.plan_id}>
                {saving && <Loader2 className="animate-spin" size={16} />} Salvar sem cobrar
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {loading ? <p role="status" className="py-8 text-center text-slate-500">Carregando contratações...</p> : !form && !loadError && (
        contracts.length ? contracts.map((contract) => (
          <article key={contract.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{contract.plan_snapshot.name}</h2>
                <p className="text-sm text-slate-500">{contract.customer_snapshot.name}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-800">{commercialMoney(contract.total_cents)}</p>
                <p className="text-xs text-slate-500">{WEBSITE_PAYMENT_METHODS[contract.payment_method]} · {STATES[contract.billing_state]}</p>
                {contract.asaas_environment && <p className="text-xs font-bold text-[#3b597b]">Asaas: {contract.asaas_environment === 'production' ? 'PRODUÇÃO' : 'SANDBOX'}</p>}
              </div>
            </div>
            <details className="text-sm text-slate-600"><summary className="cursor-pointer">Escopo preservado na contratação</summary><p className="mt-2 whitespace-pre-wrap">{contract.plan_snapshot.scope}</p></details>
            {contract.bundled_subscription && <Link href="/assinaturas/websites/recorrentes" className="block text-sm text-blue-700 underline">Hospedagem/manutenção contratada junto — gerenciar assinatura recorrente</Link>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Parcela</th><th className="p-3">Vencimento</th><th className="p-3">Valor</th><th className="p-3">Última situação consultada</th><th className="p-3">Cobrança</th></tr></thead>
                <tbody>{[...contract.holding_website_installments].sort((a, b) => a.number - b.number).map((row, index) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="p-3">{row.kind === 'deposit' ? 'Entrada' : `Parcela ${row.number}`}</td>
                    <td className="p-3">{dateLabel(row.due_date)}</td><td className="p-3">{commercialMoney(row.amount_cents)}</td>
                    <td className="p-3">{STATUS[row.status] || row.status}</td>
                    <td className="p-3">{row.invoice_url && (contract.payment_method !== 'CREDIT_CARD' || row.kind === 'deposit'
                      || index === (contract.holding_website_installments.some((item) => item.kind === 'deposit') ? 1 : 0))
                      ? <a href={row.invoice_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#3b597b] underline">
                        {contract.payment_method === 'CREDIT_CARD' ? 'Pagar no cartão' : 'Abrir cobrança'}
                      </a> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {(contract.billing_state === 'review' || contract.billing_state === 'processing') && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Confira o painel Asaas antes de qualquer nova emissão. Consultar Asaas apenas recupera cobranças existentes, sem criar outras. Emissão parcial ou processamento interrompido exige revisão administrativa.</p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" className={commercialSecondaryClass}
                disabled={Boolean(billingId) || Boolean(form) || Boolean(invoiceForm) || contract.billing_state === 'processing' || Boolean(contract.holding_website_invoices?.length)}
                onClick={() => editContract(contract)}>Editar contratação</button>
              {contract.holding_website_invoices?.length ? (
                <Link href="/notas-fiscais" className={commercialSecondaryClass}>
                  NFS-e: {contract.holding_website_invoices[0].status === 'authorized' ? 'autorizada' : 'reservada / conferir no portal'}
                </Link>
              ) : (
                <button type="button" className={commercialSecondaryClass} disabled={Boolean(billingId) || Boolean(form) || Boolean(invoiceForm)}
                  onClick={() => { setError(''); setMessage(''); setInvoiceForm({ id: contract.id, competence: '', preview: null }); }}>Emitir NFS-e</button>
              )}
              {contract.billing_state === 'local' ? (
                <button type="button" className={commercialButtonClass} disabled={Boolean(billingId) || Boolean(form) || Boolean(invoiceForm)}
                  onClick={() => void billing(contract, 'generate')}>{billingId === contract.id && <Loader2 className="animate-spin" size={16} />} Gerar no Asaas</button>
              ) : (
                <button type="button" className={commercialSecondaryClass} disabled={Boolean(billingId) || Boolean(form) || Boolean(invoiceForm) || contract.billing_state === 'processing'}
                  onClick={() => void billing(contract, 'sync')}>{billingId === contract.id && <Loader2 className="animate-spin" size={16} />} Consultar Asaas</button>
              )}
            </div>
          </article>
        )) : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Nenhuma contratação cadastrada.</p>
      )}
    </div>
  );
}
