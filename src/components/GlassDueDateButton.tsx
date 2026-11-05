"use client";

import { useId, useRef, useState } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { subscriptionDaysUntilDue } from '@/lib/subscription-due-date';
import { commercialButtonClass, commercialSecondaryClass, commercialInputClass, commercialLabelClass } from './HoldingCommercialFields';

export type GlassDueDateTenant = {
  id: string;
  nome?: string;
  vencimento_assinatura?: string | null;
  status_assinatura: string;
  ativa: boolean;
  updated_at: string | null;
};

export default function GlassDueDateButton({ tenant, canEdit, onUpdated }: {
  tenant: GlassDueDateTenant;
  canEdit: boolean;
  onUpdated: (tenant: GlassDueDateTenant, message: string) => void;
}) {
  const titleId = useId();
  const [edit, setEdit] = useState<{ date: string; reason: string; confirmed: boolean; version: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const days = subscriptionDaysUntilDue(tenant.vencimento_assinatura);
  const formatted = tenant.vencimento_assinatura?.slice(0, 10).split('-').reverse().join('/');
  const content = <>
    <span className="text-[9px] font-black uppercase text-slate-500">{formatted ? `Vence ${formatted}` : 'Sem vencimento'}</span>
    {days !== null && <span className={`mt-0.5 text-[9px] font-bold ${days < 0 ? 'text-red-500' : days <= 5 ? 'text-amber-500' : 'text-emerald-500'}`}>
      {days < 0 ? `Atrasado ${Math.abs(days)} dias` : days === 0 ? 'Vence hoje' : `Faltam ${days} dias`}
    </span>}
  </>;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!edit || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await holdingAuthFetch('/api/admin/tenant-due-date', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tenant.id, dueDate: edit.date, reason: edit.reason, confirmed: edit.confirmed, expectedUpdatedAt: edit.version }),
      });
      const result = await response.json();
      if (!response.ok || !result.tenant) throw new Error(result.error || 'Não foi possível confirmar o ajuste.');
      onUpdated(result.tenant, result.message);
      setEdit(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Falha ao confirmar o ajuste.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return <>
    {canEdit ? <button type="button" title={`Alterar vencimento de ${tenant.nome || 'assinatura'}`}
      className="mx-auto flex min-w-[100px] flex-col items-center rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-center leading-tight hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-blue-500"
      onClick={() => { setError(''); setEdit({ date: tenant.vencimento_assinatura?.slice(0, 10) || '', reason: '', confirmed: false, version: tenant.updated_at }); }}>
      {content}
    </button> : <div className="mx-auto flex min-w-[100px] flex-col items-center leading-tight">{content}</div>}
    {edit && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={save} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 text-left shadow-xl">
        <h2 id={titleId} className="text-lg font-bold text-slate-800">Alterar vencimento · {tenant.nome || '791Glass'}</h2>
        <p className="text-sm text-slate-600">A situação será recalculada pela nova data. O bloqueio por atraso ocorre somente após mais de 10 dias. Nenhum pagamento será registrado nem a cobrança do Asaas será alterada.</p>
        <p className="text-sm text-amber-800">Uma assinatura bloqueada poderá ser reativada. Inativas, canceladas e bloqueios de módulos não serão liberados.</p>
        <label className={commercialLabelClass}>Novo vencimento<input autoFocus required type="date" min="2020-01-01" max="2100-12-31"
          className={commercialInputClass} value={edit.date} disabled={saving} onChange={(event) => setEdit({ ...edit, date: event.target.value })} /></label>
        <label className={commercialLabelClass}>Justificativa<input required minLength={10} maxLength={1000} className={commercialInputClass}
          value={edit.reason} disabled={saving} onChange={(event) => setEdit({ ...edit, reason: event.target.value })} /></label>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input required type="checkbox" className="mt-1" checked={edit.confirmed} disabled={saving}
          onChange={(event) => setEdit({ ...edit, confirmed: event.target.checked })} />Confirmo o ajuste administrativo e o recálculo da situação, inclusive eventual desbloqueio da assinatura.</label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} className={commercialSecondaryClass} onClick={() => setEdit(null)}>Cancelar</button>
          <button type="submit" disabled={saving || !edit.confirmed} className={commercialButtonClass}>{saving ? 'Salvando...' : 'Salvar vencimento'}</button>
        </div>
      </form>
    </div>}
  </>;
}
