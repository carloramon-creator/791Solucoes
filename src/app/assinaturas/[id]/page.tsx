"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  FileCheck,
  FileText,
  Layers,
  Loader2,
  Lock,
  Receipt,
  RefreshCw,
  X,
} from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import OverageSettleModal from '@/components/OverageSettleModal';

type PanelModule = {
  id: string;
  nome: string;
  price: number;
  sponsored?: boolean;
  active: boolean;
  locked: boolean;
  blockedByOverage: boolean;
  modulos: string[];
};

type PanelInvoice = {
  id: string;
  source: 'invoice' | 'record' | 'asaas';
  createdAt: string;
  dueDate: string | null;
  reference: string;
  type: 'Assinatura' | 'Excedente' | 'Avulsa';
  description: string;
  status: string;
  situation: 'pending' | 'overdue' | 'paid' | 'cancelled' | 'other';
  value: number;
  recordId?: string;
  asaasPaymentId?: string | null;
  settleable?: boolean;
  cancellable?: boolean;
  paymentUrl: string | null;
  fiscalUrl: string | null;
  reportUrl: string | null;
};

type PanelData = {
  tenant: Record<string, any>;
  sponsorName: string | null;
  pricing: { total: number; base: number; extras: number; discountPercent: number; combos: Array<{ id: string; nome: string; active: boolean; price: number }> };
  modules: PanelModule[];
  blocks: Array<{ finance_record_id: string; ref_month: string | null; valor: number; vencimento: string; whatsapp_bloqueado_em: string | null; bloqueia_whatsapp: boolean; bloqueia_consultflex: boolean }>;
  invoices: PanelInvoice[];
  warnings: string[];
  permissions: { modules: boolean; invoices: boolean };
};

const currency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const dateBr = (value?: string | null) => {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

const CYCLE_LABEL: Record<string, string> = { monthly: 'Mensal', semiannual: 'Semestral', annual: 'Anual' };

const th = 'px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-slate-500';
const td = 'px-4 py-2.5 text-xs text-slate-700';

function Section({ title, icon, children, right }: { title: string; icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2 text-[#3b597b]">
          {icon}
          <h2 className="text-xs font-black uppercase tracking-wider">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function SituationBadge({ invoice }: { invoice: PanelInvoice }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    overdue: 'bg-red-50 text-red-700 border-red-200',
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
    other: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  const label: Record<string, string> = { pending: 'A vencer', overdue: 'Vencida', paid: 'Paga', cancelled: 'Cancelada', other: invoice.status };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${map[invoice.situation]}`}>{label[invoice.situation]}</span>;
}

export default function TenantPanelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [busyModule, setBusyModule] = useState<string | null>(null);
  const [confirmModule, setConfirmModule] = useState<PanelModule | null>(null);
  const [cancelInvoice, setCancelInvoice] = useState<PanelInvoice | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [settleInvoice, setSettleInvoice] = useState<PanelInvoice | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await holdingAuthFetch(`/api/admin/tenant-panel/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Falha ao carregar o painel.');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o painel.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const invoices = data?.invoices || [];
    const open = invoices.filter((i) => i.situation === 'pending' || i.situation === 'overdue')
      .sort((a, b) => String(a.dueDate || a.createdAt).localeCompare(String(b.dueDate || b.createdAt)));
    return {
      open,
      overdue: open.filter((i) => i.situation === 'overdue'),
      paid: invoices.filter((i) => i.situation === 'paid'),
      cancelled: invoices.filter((i) => i.situation === 'cancelled'),
    };
  }, [data]);

  async function toggleModule(mod: PanelModule) {
    setConfirmModule(null);
    setBusyModule(mod.id);
    setNotice(null);
    try {
      const res = await holdingAuthFetch(`/api/admin/tenant-panel/${id}/modules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combo: mod.id, enabled: !mod.active }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json?.error || 'Falha ao alterar o módulo.');
      const parts = [`${mod.nome} ${mod.active ? 'desligado' : 'ligado'}.`];
      if (json.valueBefore !== undefined && json.valueBefore !== json.valueAfter) {
        parts.push(`Assinatura: ${currency(json.valueBefore)} → ${currency(json.valueAfter)}.`);
        if (json.subscriptionsUpdated) parts.push('Valor ajustado no Asaas.');
      }
      const warnings: string[] = json.warnings || [];
      setNotice({ kind: warnings.length ? 'warn' : 'ok', text: [...parts, ...warnings].join(' ') });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao alterar o módulo.' });
    } finally {
      setBusyModule(null);
    }
  }

  async function confirmCancel() {
    if (!cancelInvoice) return;
    setCancelling(true);
    try {
      const isOverage = cancelInvoice.type === 'Excedente';
      const res = isOverage
        ? await holdingAuthFetch('/api/admin/overage-settle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: cancelInvoice.recordId, mode: 'waived', note: cancelNote }),
        })
        : await holdingAuthFetch(`/api/admin/tenant-panel/${id}/invoices/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: cancelInvoice.recordId, asaasPaymentId: cancelInvoice.asaasPaymentId, note: cancelNote }),
        });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json?.error || 'Falha ao cancelar a fatura.');
      const warnings: string[] = json.warnings || [];
      setNotice({ kind: warnings.length ? 'warn' : 'ok', text: ['Fatura cancelada.', ...warnings].join(' ') });
      setCancelInvoice(null);
      setCancelNote('');
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Falha ao cancelar a fatura.' });
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-[#3b597b]" size={36} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <p className="mb-4 text-sm text-red-600">{error || 'Painel indisponível.'}</p>
        <button onClick={load} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold uppercase">Tentar de novo</button>
      </div>
    );
  }

  const { tenant, pricing, modules, blocks, permissions } = data;
  const blockedNow = blocks.filter((b) => b.whatsapp_bloqueado_em);
  const openTotal = groups.open.reduce((s, i) => s + i.value, 0);
  const overdueTotal = groups.overdue.reduce((s, i) => s + i.value, 0);
  const paidTotal = groups.paid.reduce((s, i) => s + i.value, 0);
  const activeCount = modules.filter((m) => m.active).length;

  const invoiceLinks = (inv: PanelInvoice) => (
    <div className="inline-flex items-center gap-1.5">
      {inv.paymentUrl && (
        <a href={inv.paymentUrl} target="_blank" rel="noreferrer" title="Abrir boleto/fatura" className="inline-flex rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"><ExternalLink size={13} /></a>
      )}
      {inv.fiscalUrl && (
        <a href={inv.fiscalUrl} target="_blank" rel="noreferrer" title="Nota fiscal" className="inline-flex rounded-lg border border-purple-200 bg-purple-50 p-1.5 text-purple-600"><FileCheck size={13} /></a>
      )}
      {inv.reportUrl && (
        <a href={inv.reportUrl} target="_blank" rel="noreferrer" title="Relatório de consumo" className="inline-flex rounded-lg border border-blue-200 bg-blue-50 p-1.5 text-blue-600"><FileText size={13} /></a>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/assinaturas')} className="rounded p-1 text-slate-400 hover:bg-slate-50" title="Voltar"><ChevronLeft size={20} /></button>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-[#3b597b]"><Building2 size={22} /></div>
          <div>
            <h1 className="text-base font-bold text-slate-900">{tenant.nome_fantasia || tenant.nome}</h1>
            <p className="text-xs text-slate-500">
              /{tenant.slug} · {tenant.email || 'sem e-mail'}{tenant.cnpj ? ` · ${tenant.cnpj}` : ''}
            </p>
            {data.sponsorName && <p className="text-[10px] font-black uppercase text-red-600">Patrocinado por {data.sponsorName}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {notice && (
        <div className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${notice.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.kind === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}
      {data.warnings.map((w) => (
        <div key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{w}</div>
      ))}
      {blockedNow.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          <AlertTriangle size={16} /> Módulos bloqueados por excedente vencido. Pague, dê baixa ou cancele a fatura de excedente para liberar.
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: 'Situação', value: tenant.ativa === false ? 'Bloqueada' : String(tenant.status_assinatura || 'ativa'), tone: tenant.ativa === false ? 'text-red-600' : 'text-emerald-600' },
          { label: 'Vencimento', value: dateBr(tenant.vencimento_assinatura), tone: 'text-slate-800' },
          { label: `Assinatura (${CYCLE_LABEL[tenant.ciclo_pagamento] || 'Mensal'})`, value: currency(pricing.total), tone: 'text-slate-800', hint: data.sponsorName ? 'Combos (plano base patrocinado)' : 'Plano base + combos' },
          { label: `Em aberto (${groups.open.length})`, value: currency(openTotal), tone: groups.open.length ? 'text-amber-600' : 'text-slate-800' },
          { label: `Vencidas (${groups.overdue.length})`, value: currency(overdueTotal), tone: groups.overdue.length ? 'text-red-600' : 'text-slate-800' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{card.label}</p>
            <p className={`mt-1 text-lg font-black capitalize ${card.tone}`}>{card.value}</p>
            {'hint' in card && card.hint && <p className="text-[10px] font-semibold text-slate-400">{card.hint}</p>}
          </div>
        ))}
      </div>

      {/* Módulos */}
      <Section
        title={`Módulos (${activeCount}/${modules.length} ligados)`}
        icon={<Layers size={16} />}
        right={!permissions.modules ? <span className="text-[10px] font-bold uppercase text-slate-400">Somente leitura</span> : null}
      >
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Módulo</th>
              <th className={th}>Inclui</th>
              <th className={`${th} text-right`}>Valor/mês</th>
              <th className={th}>Situação</th>
              <th className={`${th} text-center`}>Ligado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {modules.map((mod) => {
              const disabled = !permissions.modules || mod.locked || busyModule !== null;
              return (
                <tr key={mod.id} className="hover:bg-slate-50/50">
                  <td className={`${td} font-semibold`}>{mod.nome}</td>
                  <td className={`${td} max-w-[420px] text-slate-500`}>{mod.modulos.join(', ') || '—'}</td>
                  <td className={`${td} text-right font-semibold`}>
                    {mod.sponsored ? (
                      <span className="flex flex-col items-end leading-tight">
                        <span className="text-slate-300 line-through">{currency(mod.price)}</span>
                        <span className="text-[9px] font-black uppercase text-red-600">Pago pelo patrocinador</span>
                      </span>
                    ) : (
                      <span className={mod.active ? 'text-slate-700' : 'text-slate-300 line-through'}>{currency(mod.price)}</span>
                    )}
                  </td>
                  <td className={td}>
                    {mod.blockedByOverage ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700"><AlertTriangle size={11} /> Bloqueado (excedente)</span>
                    ) : mod.active ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600"><CheckCircle2 size={12} /> Ativo</span>
                    ) : (
                      <span className="text-[10px] font-black uppercase text-slate-400">Desligado</span>
                    )}
                  </td>
                  <td className={`${td} text-center`}>
                    {mod.locked ? (
                      <span title="O plano base não pode ser desligado" className="inline-flex text-slate-300"><Lock size={14} /></span>
                    ) : busyModule === mod.id ? (
                      <Loader2 size={16} className="mx-auto animate-spin text-[#3b597b]" />
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={mod.active}
                        aria-label={`${mod.active ? 'Desligar' : 'Ligar'} ${mod.nome}`}
                        disabled={disabled}
                        onClick={() => setConfirmModule(mod)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${mod.active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${mod.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-5 py-2 text-[10px] text-slate-400">
          Desligar um combo tira todos os módulos e menus dele do cliente e retira o valor da assinatura.
          {pricing.extras > 0 && ` Usuários/dispositivos extras: ${currency(pricing.extras)}.`}
          {pricing.discountPercent > 0 && ` Desconto do ciclo: ${pricing.discountPercent}%.`}
        </p>
      </Section>

      {/* Faturas em aberto */}
      <Section title={`Faturas a vencer e vencidas (${groups.open.length})`} icon={<Receipt size={16} />}>
        {groups.open.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">Nenhuma fatura em aberto.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Vencimento</th>
                <th className={th}>Referência</th>
                <th className={th}>Tipo</th>
                <th className={th}>Descrição</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={th}>Situação</th>
                <th className={`${th} text-center`}>Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.open.map((inv) => (
                <tr key={inv.id} className={inv.situation === 'overdue' ? 'bg-red-50/30' : ''}>
                  <td className={td}>{dateBr(inv.dueDate)}</td>
                  <td className={`${td} font-mono text-[11px]`}>{inv.reference}</td>
                  <td className={td}>{inv.type}</td>
                  <td className={`${td} max-w-[320px] truncate`} title={inv.description}>{inv.description}</td>
                  <td className={`${td} text-right font-semibold`}>{currency(inv.value)}</td>
                  <td className={td}><SituationBadge invoice={inv} /></td>
                  <td className={`${td} text-center`}>
                    <div className="inline-flex items-center gap-1.5">
                      {invoiceLinks(inv)}
                      {permissions.invoices && inv.settleable && inv.recordId && (
                        <button onClick={() => setSettleInvoice(inv)} title="Recebido por fora" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase text-slate-700 hover:bg-slate-100">Dar baixa</button>
                      )}
                      {permissions.invoices && inv.cancellable && (
                        <button onClick={() => { setCancelNote(''); setCancelInvoice(inv); }} title="Cancelar fatura" className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase text-red-700 hover:bg-red-100"><Ban size={11} /> Cancelar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Faturas pagas */}
      <Section
        title={`Faturas pagas (${groups.paid.length})`}
        icon={<CheckCircle2 size={16} />}
        right={<span className="text-[10px] font-black uppercase text-slate-400">Total {currency(paidTotal)}</span>}
      >
        {groups.paid.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">Nenhuma fatura paga.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Data</th>
                <th className={th}>Referência</th>
                <th className={th}>Tipo</th>
                <th className={th}>Descrição</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={`${th} text-center`}>Documentos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.paid.map((inv) => (
                <tr key={inv.id}>
                  <td className={td}>{dateBr(inv.createdAt)}</td>
                  <td className={`${td} font-mono text-[11px]`}>{inv.reference}</td>
                  <td className={td}>{inv.type}</td>
                  <td className={`${td} max-w-[360px] truncate`} title={inv.description}>{inv.description}</td>
                  <td className={`${td} text-right font-semibold`}>{currency(inv.value)}</td>
                  <td className={`${td} text-center`}>{invoiceLinks(inv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {groups.cancelled.length > 0 && (
        <Section
          title={`Canceladas / abonadas (${groups.cancelled.length})`}
          icon={<Ban size={16} />}
          right={<button onClick={() => setShowCancelled((v) => !v)} className="text-[10px] font-black uppercase text-[#3b597b]">{showCancelled ? 'Ocultar' : 'Mostrar'}</button>}
        >
          {showCancelled && (
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Data</th>
                  <th className={th}>Referência</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Descrição</th>
                  <th className={th}>Situação</th>
                  <th className={`${th} text-right`}>Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.cancelled.map((inv) => (
                  <tr key={inv.id} className="text-slate-400">
                    <td className={td}>{dateBr(inv.dueDate || inv.createdAt)}</td>
                    <td className={`${td} font-mono text-[11px]`}>{inv.reference}</td>
                    <td className={td}>{inv.type}</td>
                    <td className={`${td} max-w-[360px] truncate`} title={inv.description}>{inv.description}</td>
                    <td className={td}>{inv.type === 'Excedente' ? 'Abonada' : 'Cancelada'}</td>
                    <td className={`${td} text-right line-through`}>{currency(inv.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {/* Confirmação de módulo */}
      {confirmModule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-sm font-black uppercase text-slate-800">{confirmModule.active ? 'Desligar' : 'Ligar'} {confirmModule.nome}?</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {confirmModule.active
                ? `O cliente deixa de ver ${confirmModule.modulos.join(', ')} e todos os menus deles.`
                : `O cliente passa a ter ${confirmModule.modulos.join(', ')} com todos os menus.`}
              {` A assinatura ${confirmModule.active ? 'diminui' : 'aumenta'} ${currency(confirmModule.price)}/mês e as próximas mensalidades no Asaas são ajustadas.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmModule(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-[10px] font-black uppercase text-slate-600">Voltar</button>
              <button onClick={() => toggleModule(confirmModule)} className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase text-white ${confirmModule.active ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {confirmModule.active ? 'Desligar' : 'Ligar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancelamento de fatura */}
      {cancelInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-sm font-black uppercase text-slate-800">Cancelar fatura {cancelInvoice.reference}?</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {cancelInvoice.type} de {currency(cancelInvoice.value)}{cancelInvoice.dueDate ? `, vencimento ${dateBr(cancelInvoice.dueDate)}` : ''}.
              O boleto é removido no Asaas e a fatura fica no histórico como cancelada.
              {cancelInvoice.type === 'Excedente' && ' O bloqueio de WhatsApp/ConsultFlex desta cobrança é liberado.'}
            </p>
            <textarea
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              placeholder="Motivo (opcional)"
              rows={2}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#3b597b]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCancelInvoice(null)} disabled={cancelling} className="rounded-lg border border-slate-200 px-4 py-2 text-[10px] font-black uppercase text-slate-600">Voltar</button>
              <button onClick={confirmCancel} disabled={cancelling} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-[10px] font-black uppercase text-white hover:bg-red-700 disabled:opacity-60">
                {cancelling && <Loader2 size={12} className="animate-spin" />} Cancelar fatura
              </button>
            </div>
          </div>
        </div>
      )}

      {settleInvoice?.recordId && (
        <OverageSettleModal
          recordId={settleInvoice.recordId}
          titulo={settleInvoice.reference}
          tenantName={tenant.nome_fantasia || tenant.nome}
          valor={settleInvoice.value}
          onClose={() => setSettleInvoice(null)}
          onDone={(warnings) => {
            setSettleInvoice(null);
            setNotice({ kind: warnings.length ? 'warn' : 'ok', text: ['Baixa registrada.', ...warnings].join(' ') });
            load();
          }}
        />
      )}
    </div>
  );
}
