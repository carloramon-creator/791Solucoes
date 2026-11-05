"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { WEBSITE_BILLING_CYCLES, type WebsitePlan, type WebsiteProjectType } from '@/lib/website-plans';
import { WEBSITE_SUBSCRIPTION_STATES, type WebsiteSubscription } from '@/lib/website-subscription-terms';
import { EMPTY_WEBSITE_SUBSCRIPTION, WebsiteSubscriptionFields, type WebsiteSubscriptionForm } from './WebsiteSubscriptionFields';
import { commercialButtonClass, commercialSecondaryClass, commercialMoney, commercialLabelClass, HoldingCommercialSelect } from './HoldingCommercialFields';

export function WebsiteContractSubscriptions({ contractId, customerId, customerName, projectType }: {
  contractId: string; customerId: string; customerName: string; projectType: WebsiteProjectType | null;
}) {
  const [rows, setRows] = useState<WebsiteSubscription[]>([]);
  const [plans, setPlans] = useState<WebsitePlan[]>([]);
  const [manager, setManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<(WebsiteSubscriptionForm & { request_id: string }) | null>(null);
  const [existingId, setExistingId] = useState('');
  const busy = useRef(false);
  const load = useCallback(() => Promise.all([
      holdingAuthFetch('/api/admin/website-subscriptions'),
      holdingAuthFetch('/api/admin/permissions/me'),
    ]).then(async ([response, permissionResponse]) => {
    const data = await response.json();
    const permissions = await permissionResponse.json();
    if (!response.ok || !Array.isArray(data.subscriptions) || !Array.isArray(data.plans)) {
      throw new Error(data.error || 'Não foi possível carregar as assinaturas.');
    }
    if (!permissionResponse.ok || !Array.isArray(permissions.permissionCodes)) {
      throw new Error(permissions.error || 'Não foi possível verificar a permissão de ativação.');
    }
    setRows(data.subscriptions);
    setPlans(data.plans);
    setManager(permissions.permissionCodes.includes('action.websites.manage'));
  }), []);
  useEffect(() => {
    void load().catch((failure: unknown) => {
      console.error('[CONTRACT SUBSCRIPTIONS] Falha ao carregar.');
      setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as assinaturas.');
    }).finally(() => setLoading(false));
  }, [load]);
  const linked = rows.filter((row) => row.contract_id === contractId);
  const available = rows.filter((row) => row.customer_id === customerId && !row.contract_id && row.lifecycle_status !== 'cancelled');
  const compatiblePlans = plans.filter((plan) => !plan.project_type || plan.project_type === projectType);
  const pending = linked.filter((row) => row.billing_state === 'local' && row.lifecycle_status === 'active');

  async function save(event: FormEvent, existing = false) {
    event.preventDefault();
    if (busy.current || (!existing && !form)) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-subscriptions', {
        method: existing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing ? { contract_id: contractId, id: existingId } : {
          ...form, contract_id: contractId, amount_cents: Math.round(Number(form!.amount) * 100),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.id) throw new Error(data.error || 'O banco não confirmou a assinatura.');
      setForm(null); setExistingId('');
      setMessage(existing ? 'Assinatura vinculada. Sua cobrança e situação foram preservadas.' : 'Assinatura salva e vinculada, aguardando aprovação. Nenhuma cobrança foi gerada.');
      await load();
    } catch (failure) {
      console.error('[CONTRACT SUBSCRIPTIONS] Salvamento interrompido.');
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar. Atualize antes de repetir.');
    } finally { busy.current = false; setWorking(false); }
  }
  async function activate() {
    if (busy.current || !manager || !pending.length) return;
    const details = pending.map((row) => `${row.plan_snapshot.name}: ${commercialMoney(row.amount_cents)} / ${WEBSITE_BILLING_CYCLES[row.plan_snapshot.billing_cycle]}, primeiro vencimento ${row.first_due_date.split('-').reverse().join('/')}`).join('\n');
    if (!window.confirm(`Confirmo que ${customerName} aprovou estas assinaturas:\n\n${details}\n\nAtivar no Asaas? Em produção serão geradas cobranças recorrentes, e pagamentos confirmados terão NFS-e automática. A criação do website é cobrada separadamente.`)) return;
    busy.current = true; setWorking(true); setError(''); setMessage('');
    let completed = 0;
    try {
      for (const row of pending) {
        const response = await holdingAuthFetch('/api/admin/website-subscriptions/billing', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, action: 'generate', confirmed: true }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`${row.plan_snapshot.name}: ${data.error || 'Ativação não confirmada.'}`);
        completed++;
      }
      setMessage(`${completed} assinatura(s) ativada(s). Confira o ambiente e as cobranças em Assinaturas recorrentes.`);
    } catch (failure) {
      console.error('[CONTRACT SUBSCRIPTIONS] Ativação interrompida, sem repetir pedidos.');
      setError(`${completed} assinatura(s) ativada(s) antes da interrupção. ${failure instanceof Error ? failure.message : 'Falha ao ativar.'} Confira o Asaas antes de repetir; as demais não foram enviadas.`);
    } finally {
      try { await load(); } catch (failure) {
        console.error('[CONTRACT SUBSCRIPTIONS] Atualização após ativação falhou.');
        setError((current) => `${current} ${failure instanceof Error ? failure.message : 'Atualize para conferir as assinaturas.'}`.trim());
      }
      busy.current = false; setWorking(false);
    }
  }
  return <details open className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Assinaturas vinculadas à contratação">
    <summary className="cursor-pointer text-slate-800">
      <h2 className="inline text-lg font-bold">Assinaturas vinculadas</h2>
      <span className="ml-3 text-sm text-slate-500">Expandir / recolher</span>
    </summary>
    <div className="mt-5 space-y-5">
    <p className="text-sm text-slate-600">{customerName} — o cliente e a contratação são herdados automaticamente.</p>
    <p className="text-sm text-slate-600">Adicione uma ou mais assinaturas, cada uma com seu valor, ciclo, vencimento, pagamento e confirmação fiscal. Salvar libera a preparação do website quando o tipo estiver revisado, mas não gera cobrança. Somente o gestor ativa após aprovação do cliente.</p>
    {loading && <p role="status">Carregando assinaturas...</p>}
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {linked.map((row) => <article key={row.id} className="rounded-xl border border-slate-200 p-4 text-sm">
      <h3 className="font-bold text-slate-800">{row.plan_snapshot.name}</h3>
      <p>{commercialMoney(row.amount_cents)} · {WEBSITE_BILLING_CYCLES[row.plan_snapshot.billing_cycle]} · {row.first_due_date.split('-').reverse().join('/')}</p>
      <p>{row.approval_status === 'pending' ? 'Aguardando aprovação do cliente' : 'Aprovação registrada / cadastro anterior preservado'} · {row.approval_status === 'pending' && row.lifecycle_status === 'active' ? 'Preparação liberada, sem ativação de cobrança' : WEBSITE_SUBSCRIPTION_STATES[row.lifecycle_status]}</p>
      <p>{row.billing_state === 'local' ? 'Sem recorrência gerada no Asaas' : row.billing_state === 'issued' ? `Vinculada ao Asaas (${row.asaas_environment})` : 'Processamento ou revisão: consulte o Asaas antes de continuar'}</p>
      {row.last_error && <p role="alert" className="text-red-700">{row.last_error}</p>}
    </article>)}
    {!loading && !linked.length && <p className="text-sm text-slate-500">Nenhuma assinatura vinculada a esta contratação.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className={commercialSecondaryClass} disabled={loading || working || Boolean(form)} onClick={() => {
        setError(''); setMessage(''); setForm({ ...EMPTY_WEBSITE_SUBSCRIPTION, request_id: crypto.randomUUID() });
      }}>Adicionar assinatura</button>
      {manager && pending.length > 0 && <button type="button" className={commercialButtonClass} disabled={loading || working || Boolean(form)} onClick={() => void activate()}>
        {working ? 'Aguarde...' : `Ativar assinaturas (${pending.length})`}
      </button>}
    </div>
    {form && <form onSubmit={(event) => void save(event)} className="space-y-5 rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold text-slate-800">Nova assinatura para esta contratação</h3>
      <fieldset disabled={working} className="space-y-5">
        <WebsiteSubscriptionFields value={form} plans={compatiblePlans} onChange={(value) => setForm({ ...value, request_id: form.request_id })} />
        <div className="flex justify-end gap-3">
          <button type="button" className={commercialSecondaryClass} onClick={() => setForm(null)}>Cancelar assinatura</button>
          <button type="submit" className={commercialButtonClass}>Salvar assinatura sem ativar</button>
        </div>
      </fieldset>
    </form>}
    {available.length > 0 && <form onSubmit={(event) => void save(event, true)} className="space-y-3">
      <fieldset disabled={working || Boolean(form)} className="space-y-3">
        <label className={commercialLabelClass}><span>Vincular assinatura existente deste cliente</span>
          <HoldingCommercialSelect required value={existingId} onChange={(event) => setExistingId(event.target.value)}>
            <option value="">Selecione uma assinatura sem projeto</option>
            {available.map((row) => <option key={row.id} value={row.id}>{row.plan_snapshot.name} · {commercialMoney(row.amount_cents)} · {WEBSITE_BILLING_CYCLES[row.plan_snapshot.billing_cycle]}</option>)}
          </HoldingCommercialSelect>
        </label>
        <button type="submit" className={commercialSecondaryClass}>Vincular sem alterar cobrança</button>
      </fieldset>
    </form>}
    </div>
  </details>;
}
