"use client";

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { WEBSITE_PROJECT_TYPES, type WebsiteProjectType } from '@/lib/website-plans';
import { commercialInputClass, commercialButtonClass, commercialLabelClass } from '@/components/HoldingCommercialFields';

type Contract = {
  id: string; customer_snapshot: { name: string }; plan_snapshot: { name: string; scope: string };
  project_type: WebsiteProjectType | null; designer_email: string | null;
  holding_website_subscriptions: Array<{ id: string; lifecycle_status: string }>;
};

export default function WebsiteProjects() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [designers, setDesigners] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    holdingAuthFetch('/api/admin/website-projects', { signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.contracts) || !Array.isArray(body.designers)) throw new Error(body.error || 'Resposta inválida.');
      setContracts(body.contracts); setDesigners(body.designers);
    }).catch((failure) => {
      if (!controller.signal.aborted) { console.error('[WEBSITE PROJECTS] Falha na distribuição.'); setError(failure instanceof Error ? failure.message : 'Falha ao carregar.'); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/website-projects', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Distribuição não confirmada.');
      setContracts((current) => current.map((contract) => contract.id === values.id
        ? { ...contract, designer_email: String(values.designer_email) || null } : contract));
      setMessage('Atribuição salva. O Websites verifica este acesso a cada operação.');
    } catch (failure) {
      console.error('[WEBSITE PROJECTS] Falha ao salvar.');
      setError(failure instanceof Error ? failure.message : 'Falha ao salvar.');
    } finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1200px] space-y-6 pb-12">
    <header><Link href="/assinaturas/websites">← Contratações de Websites</Link><h1 className="mt-4 text-2xl font-bold">Distribuição de projetos</h1></header>
    <p>Gestores veem todos os projetos. Cada webdesigner vê somente os que lhe forem atribuídos e não pode mudar o tipo vendido. A criação exige contratação e assinatura vinculada ativa, sem exigir pagamento.</p>
    <p>O tipo contratado vem automaticamente do plano e não pode ser alterado aqui. Contratos antigos sem tipo herdam o plano vinculado; tipos já definidos permanecem preservados. Escolha somente o webdesigner responsável.</p>
    {loading && <p role="status">Carregando…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {contracts.map((contract) => <form key={`${contract.id}-${contract.project_type}`} onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="font-bold">{contract.customer_snapshot.name} · {contract.plan_snapshot.name}</h2>
      <p className="text-sm text-slate-600">{contract.plan_snapshot.scope}</p>
      <p className="text-sm">{contract.holding_website_subscriptions.some((subscription) => subscription.lifecycle_status === 'active')
        ? 'Assinatura vinculada ativa' : 'Pendente: assinatura vinculada ativa. A criação no Websites permanece bloqueada.'}</p>
      <input type="hidden" name="id" value={contract.id} />
      <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
        <label className={commercialLabelClass}>Tipo contratado
          <input className={commercialInputClass} readOnly value={contract.project_type ? WEBSITE_PROJECT_TYPES[contract.project_type] : 'Defina o tipo no plano vinculado'} />
        </label>
        <label className={commercialLabelClass}>Webdesigner responsável
          <select name="designer_email" className={commercialInputClass} defaultValue={contract.designer_email || ''}>
            <option value="">Sem atribuição — somente gestores</option>
            {contract.designer_email && !designers.includes(contract.designer_email) && <option value={contract.designer_email}>{contract.designer_email} · acesso revogado</option>}
            {designers.map((email) => <option key={email}>{email}</option>)}
          </select>
        </label>
        <button className={commercialButtonClass} type="submit" disabled={!contract.project_type}>Confirmar webdesigner</button>
      </fieldset>
    </form>)}
  </div>;
}
