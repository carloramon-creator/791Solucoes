"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Globe, Loader2, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import {
  commercialFieldClass as fieldClass,
  commercialInputClass as inputClass,
} from '@/components/HoldingCommercialFields';
import {
  WEBSITE_BILLING_CYCLES,
  WEBSITE_CATEGORIES,
  validateWebsitePlan,
  websiteBillingCycles,
  websiteRecurringPrices,
  WEBSITE_RECURRING_CYCLES,
  type WebsiteFiscalConfig,
  type WebsiteBillingCycle,
  type WebsiteCategory,
  type WebsitePlan,
} from '@/lib/website-plans';

type PlanForm = {
  name: string;
  description: string;
  scope: string;
  category: WebsiteCategory;
  billing_cycle: WebsiteBillingCycle;
  price: string;
  active: boolean;
  fiscal_config: WebsiteFiscalConfig;
  cycle_prices: Record<string, string>;
};

const EMPTY_FISCAL: WebsiteFiscalConfig = {
  national_code: '', municipal_code: '', nbs: '', service_description: '', accountant_confirmed: false,
  simples_percent: null,
};
const EMPTY_FORM: PlanForm = {
  name: '', description: '', scope: '', category: 'creation',
  billing_cycle: 'one_time', price: '', active: true,
  fiscal_config: EMPTY_FISCAL,
  cycle_prices: {},
};
const selectClass = `${inputClass} appearance-none pr-10`;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PlanosWebsitesPage() {
  const [plans, setPlans] = useState<WebsitePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const loadPlans = useCallback((signal?: AbortSignal) => (
    holdingAuthFetch('/api/admin/website-plans', { signal }).then(async (response) => {
      const payload: { plans?: WebsitePlan[]; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os produtos.');
      if (!Array.isArray(payload.plans)) throw new Error('O catálogo retornou uma resposta inválida.');
      return payload.plans;
    }).then((plans) => {
      if (!signal?.aborted) setPlans(plans);
    }).catch((error: unknown) => {
      if (!signal?.aborted) {
        console.error('[WEBSITE PLANS] Erro ao carregar:', error);
        setLoadError(error instanceof Error ? error.message : 'Erro ao carregar o catálogo.');
      }
    }).finally(() => {
      if (!signal?.aborted) setLoading(false);
    })
  ), []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlans(controller.signal);
    return () => controller.abort();
  }, [loadPlans]);

  const formOpen = form !== null;
  useEffect(() => {
    if (formOpen) nameInput.current?.focus();
  }, [formOpen, editingId]);

  function openForm(plan?: WebsitePlan) {
    setSaveError('');
    setSuccess('');
    setEditingId(plan?.id || null);
    setForm(plan ? {
      name: plan.name,
      description: plan.description,
      scope: plan.scope,
      category: plan.category,
      billing_cycle: plan.billing_cycle,
      price: (plan.price_cents / 100).toFixed(2),
      active: plan.active,
      fiscal_config: plan.fiscal_config ? { ...plan.fiscal_config } : { ...EMPTY_FISCAL },
      cycle_prices: Object.fromEntries(Object.entries(websiteRecurringPrices(plan)).map(([key, value]) => [key, (value / 100).toFixed(2)])),
    } : { ...EMPTY_FORM });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) return;
    setSaveError('');
    setSuccess('');
    const validated = validateWebsitePlan({
      name: form.name,
      description: form.description,
      scope: form.scope,
      category: form.category,
      billing_cycle: form.billing_cycle,
      price_cents: Math.round(Number(form.price) * 100),
      active: form.active,
      fiscal_config: form.fiscal_config,
      recurring_prices: form.billing_cycle === 'one_time' ? {} : Object.fromEntries(
        WEBSITE_RECURRING_CYCLES.filter((cycle) => (cycle === form.billing_cycle ? form.price : form.cycle_prices[cycle])?.trim())
          .map((cycle) => [cycle, Math.round(Number(cycle === form.billing_cycle ? form.price : form.cycle_prices[cycle]) * 100)]),
      ),
    });
    if (!validated.ok) {
      setSaveError(validated.error);
      return;
    }
    setSaving(true);
    try {
      const response = await holdingAuthFetch('/api/admin/website-plans', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validated.data, ...(editingId ? { id: editingId } : {}) }),
      });
      const payload: { plan?: WebsitePlan; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o produto.');
      const saved = payload.plan;
      if (!saved?.id) throw new Error('O servidor não confirmou o produto salvo. Atualize o catálogo antes de tentar novamente.');
      setPlans((current) => editingId
        ? current.map((plan) => plan.id === saved.id ? saved : plan)
        : [saved, ...current]);
      setForm(null);
      setEditingId(null);
      setSuccess('Produto salvo no catálogo. Nenhuma cobrança ou nota fiscal foi gerada.');
    } catch (error) {
      console.error('[WEBSITE PLANS] Erro ao salvar:', error);
      setSaveError(error instanceof Error ? error.message : 'Erro ao salvar o produto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pb-12">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-800">
            <Globe className="text-[#3b597b]" size={24} /> Planos de Websites
          </h1>
          <p className="mt-1 text-sm text-slate-500">Produtos e serviços próprios da Holding, independentes do Glass e do Barber.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setLoading(true); setLoadError(''); void loadPlans(); }} disabled={loading || formOpen}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <RefreshCw size={16} /> Atualizar
          </button>
          <button type="button" onClick={() => openForm()} disabled={loading || Boolean(loadError) || formOpen}
            className="flex items-center gap-2 rounded-md bg-[#3b597b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2e4763] disabled:opacity-50">
            <Plus size={16} /> Novo produto
          </button>
        </div>
      </header>

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>Catálogo comercial.</strong> Cadastre a confecção como projeto de cobrança única e a hospedagem ou manutenção com preços mensais, trimestrais, semestrais ou anuais.
        O parcelamento de projetos será definido na contratação. Este cadastro não cria assinaturas no Asaas nem emite notas fiscais.
      </div>

      {success && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0" /> {success}
        </div>
      )}
      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={18} className="shrink-0" /> {loadError}
        </div>
      )}

      {form && (
        <form onSubmit={handleSave} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="website-form-title">
          <h2 id="website-form-title" className="mb-5 text-lg font-bold text-slate-800">{editingId ? 'Editar produto' : 'Novo produto de Websites'}</h2>
          <fieldset disabled={saving} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                <span>Nome do produto *</span>
                <input ref={nameInput} className={inputClass} value={form.name} required maxLength={120}
                  onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Website institucional" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                <span>Categoria *</span>
                <span className="relative block">
                  <select className={selectClass} value={form.category} onChange={(event) => {
                    const category = event.target.value as WebsiteCategory;
                    const cycles = websiteBillingCycles(category);
                    const billing_cycle = cycles.includes(form.billing_cycle) ? form.billing_cycle : cycles[0];
                    setForm({ ...form, category, billing_cycle,
                      price: billing_cycle === form.billing_cycle ? form.price : (form.cycle_prices[billing_cycle] || ''),
                    });
                  }}>
                    {Object.entries(WEBSITE_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                <span>{form.billing_cycle === 'one_time' ? 'Modalidade de cobrança *' : 'Ciclo padrão do catálogo *'}</span>
                <span className="relative block">
                  <select className={selectClass} value={form.billing_cycle}
                    onChange={(event) => setForm({ ...form, billing_cycle: event.target.value as WebsiteBillingCycle,
                      cycle_prices: { ...form.cycle_prices, [form.billing_cycle]: form.price },
                      price: form.cycle_prices[event.target.value] || '',
                    })}>
                    {websiteBillingCycles(form.category).map((cycle) => <option key={cycle} value={cycle}>{WEBSITE_BILLING_CYCLES[cycle]}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                </span>
              </label>
              {form.billing_cycle === 'one_time' && <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                <span>Preço total (R$) *</span>
                <input type="number" inputMode="decimal" min="0.01" max="9999999.99" step="0.01" required
                  className={inputClass} value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0,00" />
              </label>}
            </div>
            {form.billing_cycle !== 'one_time' && <section className="space-y-3">
              <h3 className="font-bold text-slate-800">Preços por ciclo</h3>
              <p className="text-sm text-slate-500">Informe o total do período, não o equivalente mensal. Deixe em branco os ciclos não oferecidos; preencha o ciclo padrão. O valor pode ser personalizado ao contratar, sem mudar estes preços.</p>
              <div className="grid gap-5 md:grid-cols-2">
                {WEBSITE_RECURRING_CYCLES.map((cycle) => <label key={cycle} className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                  <span>{WEBSITE_BILLING_CYCLES[cycle]} (R$){cycle === form.billing_cycle ? ' *' : ''}</span>
                  <input className={inputClass} type="number" step="0.01" min="0.01" max="9999999.99"
                    required={cycle === form.billing_cycle} value={cycle === form.billing_cycle ? form.price : (form.cycle_prices[cycle] || '')}
                    onChange={(event) => setForm({ ...form, ...(cycle === form.billing_cycle ? { price: event.target.value } : {}),
                      cycle_prices: { ...form.cycle_prices, [cycle]: event.target.value },
                    })} />
                </label>)}
              </div>
            </section>}
            {form.billing_cycle === 'one_time' && (
              <p className="text-sm text-slate-500">
                Informe o valor total do projeto, não o valor da parcela. Cobrança única significa um projeto sem renovação recorrente:
                o pagamento poderá ser à vista ou parcelado, com quantidade de parcelas e vencimentos definidos na contratação.
                O parcelamento ainda não é configurado nesta tela.
              </p>
            )}
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
              <span>Descrição comercial</span>
              <textarea className={fieldClass} rows={2} maxLength={2000} value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
              <span>Escopo, limites e condições *</span>
              <textarea className={fieldClass} rows={4} maxLength={5000} required value={form.scope}
                onChange={(event) => setForm({ ...form, scope: event.target.value })}
                placeholder="Defina entregas, revisões, prazo, suporte, backups e o que não está incluído." />
            </label>
            <section aria-labelledby="website-fiscal-title" className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 id="website-fiscal-title" className="font-bold text-slate-800">Dados fiscais deste produto</h3>
              <p className="text-sm text-slate-600">
                {form.billing_cycle === 'one_time'
                  ? 'Regra: emissão manual de uma NFS-e pelo valor total do projeto, com confirmação explícita, independentemente do pagamento.'
                  : 'Regra: emissão automática de NFS-e após confirmação do pagamento da assinatura.'}
                {' '}Entradas bancárias, empréstimos, aportes e transferências não são gatilhos fiscais.
                Estes dados não alteram a configuração fiscal do Glass ou do Barber. Projetos podem ser emitidos pelo botão no contrato, após validação.
                Nas assinaturas, a competência será a data de confirmação do pagamento e a nota terá o valor integral do período.
              </p>
              <div className="grid gap-5 md:grid-cols-2">
                {([
                  ['national_code', 'Tributação nacional (6 dígitos)', 6],
                  ['municipal_code', 'Tributação municipal (opcional)', 3],
                  ['nbs', 'NBS (9 dígitos)', 9],
                ] as const).map(([key, label, max]) => (
                  <label key={key} className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                    <span>{label}</span>
                    <input className={inputClass} inputMode="numeric" maxLength={max} value={form.fiscal_config[key]}
                      onChange={(event) => setForm({ ...form, fiscal_config: { ...form.fiscal_config, [key]: event.target.value, accountant_confirmed: false } })} />
                  </label>
                ))}
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
                  <span>Tributos aproximados do Simples (%)</span>
                  <input className={inputClass} type="number" step="0.01" min="0" max="100"
                    value={form.fiscal_config.simples_percent ?? ''}
                    onChange={(event) => setForm({ ...form, fiscal_config: {
                      ...form.fiscal_config, simples_percent: event.target.value === '' ? null : Number(event.target.value),
                      accountant_confirmed: false,
                    } })} />
                </label>
              </div>
              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
                <span>Descrição fiscal do serviço</span>
                <textarea className={fieldClass} rows={3} maxLength={2000} value={form.fiscal_config.service_description}
                  onChange={(event) => setForm({ ...form, fiscal_config: { ...form.fiscal_config, service_description: event.target.value, accountant_confirmed: false } })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.fiscal_config.accountant_confirmed}
                  onChange={(event) => setForm({ ...form, fiscal_config: { ...form.fiscal_config, accountant_confirmed: event.target.checked } })} />
                Enquadramento deste serviço validado com a contabilidade
              </label>
              <p className="text-xs text-slate-500">Informe os dados e o percentual vigentes confirmados pela contabilidade; não copie o enquadramento de licenciamento. O percentual é informativo (pTotTribSN), não uma alíquota de ISS. Tributação municipal é um complemento opcional no padrão nacional. Salvar este formulário nunca emite nota.</p>
            </section>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
              Produto ativo para novas contratações
            </label>
            <p className="text-xs text-slate-500">Inative produtos que não serão mais oferecidos, preservando o cadastro. Alterar o catálogo não altera contratos ou cobranças existentes.</p>
            {saveError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => { setForm(null); setEditingId(null); setSaveError(''); }}
                className="flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                <X size={16} /> Cancelar
              </button>
              <button type="submit" className="flex items-center gap-2 rounded-md bg-[#3b597b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                {saving ? 'Salvando...' : 'Salvar produto'}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-slate-500"><Loader2 className="animate-spin" size={20} /> Carregando catálogo...</div>
      ) : !loadError && (
        plans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Globe className="mx-auto mb-3 text-slate-400" size={32} />
            <h2 className="font-bold text-slate-800">Nenhum produto cadastrado</h2>
            <p className="mt-2 text-sm text-slate-500">Comece pela confecção de websites e depois cadastre seus planos de hospedagem e manutenção.</p>
          </div>
        ) : (
          <section aria-label="Produtos de Websites" className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <article key={plan.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#3b597b]">{WEBSITE_CATEGORIES[plan.category]}</p>
                    <h2 className="mt-1 text-lg font-bold text-slate-800 break-words">{plan.name}</h2>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${plan.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {plan.active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <p className="mt-4 text-2xl font-bold text-slate-800">
                  {currency.format(plan.price_cents / 100)}
                  <span className="ml-2 text-xs font-medium text-slate-500">{WEBSITE_BILLING_CYCLES[plan.billing_cycle]}</span>
                </p>
                {plan.billing_cycle !== 'one_time' && <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {WEBSITE_RECURRING_CYCLES.filter((cycle) => websiteRecurringPrices(plan)[cycle]).map((cycle) => <li key={cycle}>
                    {WEBSITE_BILLING_CYCLES[cycle]}: {currency.format(websiteRecurringPrices(plan)[cycle]! / 100)}
                  </li>)}
                </ul>}
                {plan.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 break-words">{plan.description}</p>}
                <div className="mt-4 flex-1 border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-bold uppercase text-slate-500">Escopo e condições</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 break-words">{plan.scope}</p>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Fiscal: {plan.fiscal_config?.accountant_confirmed ? 'enquadramento confirmado' : 'pendente de validação'}.
                  {' '}{plan.billing_cycle === 'one_time' ? 'Regra: nota manual do total.' : 'Regra: nota após pagamento da assinatura.'}
                  {' '}Salvar o produto não emite nota.
                </p>
                <button type="button" disabled={formOpen} onClick={() => openForm(plan)} aria-label={`Editar ${plan.name}`}
                  className="mt-5 flex items-center justify-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <Pencil size={15} /> Editar produto
                </button>
              </article>
            ))}
          </section>
        )
      )}
    </div>
  );
}
