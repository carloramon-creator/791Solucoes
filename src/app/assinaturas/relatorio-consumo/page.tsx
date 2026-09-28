'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowUp, Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type TenantUsage = {
  vidracariaId: string;
  nome: string;
  slug: string;
  ativa: boolean;
  usage: {
    registeredUsers: number;
    activeUsers: number;
    whatsappUsers: number;
    sectors: number;
    messagesSent: number;
    whatsappReceived: number;
    consultflexBasicSuccess: number;
    consultflexCompleteSuccess: number;
    consultflexSuccessTotal: number;
    consultflexFailed: number;
    consultflexUnknown: number;
  };
  activity: {
    budgetsCreated: number;
    budgetsApproved: number;
    budgetsApprovedValue: number;
    clientsCreated: number;
    projectsCreated: number;
    sacadasCreated: number;
    workOrdersCreated: number;
    auditedDeletes: number;
  };
  limits: { users: number; whatsappUsers: number; messages: number };
  overage: {
    extraUsers: number;
    extraWhatsappUsers: number;
    extraMessages: number;
    values: { total: number; consultflexTotal: number };
  };
};

type ReportPayload = {
  generatedAt: string;
  messagesPeriodStart: string;
  rangeEnd: string;
  totals: {
    tenants: number;
    registeredUsers: number;
    activeUsers: number;
    whatsappUsers: number;
    sectors: number;
    messagesSent: number;
    whatsappReceived: number;
    consultflexBasicSuccess: number;
    consultflexCompleteSuccess: number;
    consultflexSuccess: number;
    budgetsCreated: number;
    budgetsApproved: number;
    budgetsApprovedValue: number;
    clientsCreated: number;
    projectsCreated: number;
    sacadasCreated: number;
    workOrdersCreated: number;
    auditedDeletes: number;
  };
  tenants: TenantUsage[];
};

type SortKey = 'nome' | 'budgetsCreated' | 'budgetsApproved' | 'budgetsApprovedValue' | 'clientsCreated' | 'projectsCreated' | 'sacadasCreated' | 'workOrdersCreated' | 'auditedDeletes' | 'whatsappReceived' | 'whatsappSent' | 'registeredUsers' | 'activeUsers' | 'whatsappUsers' | 'messagesSent' | 'consultflexBasicSuccess' | 'consultflexCompleteSuccess' | 'extraUsers' | 'extraWhatsappUsers' | 'extraMessages' | 'overageTotal';
type SortDirection = 'asc' | 'desc';

const numberFormat = new Intl.NumberFormat('pt-BR');
const currencyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toIsoDate(value: string, endOfDay = false) {
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`).toISOString();
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export default function TenantConsumptionReportPage() {
  const [startDate, setStartDate] = useState(() => dateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [endDate, setEndDate] = useState(() => dateInputValue(new Date()));
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('messagesSent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const authClient = useMemo(() => createSupabaseBrowser(), []);

  const generateReport = async () => {
    if (!startDate || !endDate || startDate > endDate) {
      setError('Informe um intervalo de datas válido.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await authClient.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');

      const params = new URLSearchParams({
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(endDate, true),
      });
      const response = await fetch(`/api/admin/subscription-usage?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível gerar o relatório.');
      setReport(payload as ReportPayload);
    } catch (caught) {
      setReport(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível gerar o relatório.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void generateReport(); }, []);

  const getSortValue = (tenant: TenantUsage, key: SortKey): number | string => {
    if (key === 'nome') return tenant.nome || tenant.slug || '';
    if (key === 'whatsappSent') return tenant.usage.messagesSent;
    switch (key) {
      case 'budgetsCreated': return tenant.activity.budgetsCreated;
      case 'budgetsApproved': return tenant.activity.budgetsApproved;
      case 'budgetsApprovedValue': return tenant.activity.budgetsApprovedValue;
      case 'clientsCreated': return tenant.activity.clientsCreated;
      case 'projectsCreated': return tenant.activity.projectsCreated;
      case 'sacadasCreated': return tenant.activity.sacadasCreated;
      case 'workOrdersCreated': return tenant.activity.workOrdersCreated;
      case 'auditedDeletes': return tenant.activity.auditedDeletes;
      case 'whatsappReceived': return tenant.usage.whatsappReceived;
      case 'registeredUsers': return tenant.usage.registeredUsers;
      case 'activeUsers': return tenant.usage.activeUsers;
      case 'whatsappUsers': return tenant.usage.whatsappUsers;
      case 'messagesSent': return tenant.usage.messagesSent;
      case 'consultflexBasicSuccess': return tenant.usage.consultflexBasicSuccess;
      case 'consultflexCompleteSuccess': return tenant.usage.consultflexCompleteSuccess;
      case 'extraUsers': return tenant.overage.extraUsers;
      case 'extraWhatsappUsers': return tenant.overage.extraWhatsappUsers;
      case 'extraMessages': return tenant.overage.extraMessages;
      case 'overageTotal': return tenant.overage.values.total;
    }
  };

  const sortedTenants = useMemo(() => {
    const rows = [...(report?.tenants || [])];
    return rows.sort((left, right) => {
      const a = getSortValue(left, sortKey);
      const b = getSortValue(right, sortKey);
      const compare = typeof a === 'string' && typeof b === 'string'
        ? a.localeCompare(b, 'pt-BR')
        : Number(a) - Number(b);
      return sortDirection === 'asc' ? compare : -compare;
    });
  }, [report, sortKey, sortDirection]);

  const totals = useMemo(() => {
    const rows = report?.tenants || [];
    return rows.reduce((sum, tenant) => ({
      budgetsCreated: sum.budgetsCreated + tenant.activity.budgetsCreated,
      budgetsApproved: sum.budgetsApproved + tenant.activity.budgetsApproved,
      budgetsApprovedValue: sum.budgetsApprovedValue + tenant.activity.budgetsApprovedValue,
      clientsCreated: sum.clientsCreated + tenant.activity.clientsCreated,
      projectsCreated: sum.projectsCreated + tenant.activity.projectsCreated,
      sacadasCreated: sum.sacadasCreated + tenant.activity.sacadasCreated,
      workOrdersCreated: sum.workOrdersCreated + tenant.activity.workOrdersCreated,
      auditedDeletes: sum.auditedDeletes + tenant.activity.auditedDeletes,
      whatsappReceived: sum.whatsappReceived + tenant.usage.whatsappReceived,
      registeredUsers: sum.registeredUsers + tenant.usage.registeredUsers,
      activeUsers: sum.activeUsers + tenant.usage.activeUsers,
      whatsappUsers: sum.whatsappUsers + tenant.usage.whatsappUsers,
      messagesSent: sum.messagesSent + tenant.usage.messagesSent,
      consultflexBasicSuccess: sum.consultflexBasicSuccess + tenant.usage.consultflexBasicSuccess,
      consultflexCompleteSuccess: sum.consultflexCompleteSuccess + tenant.usage.consultflexCompleteSuccess,
      extraUsers: sum.extraUsers + tenant.overage.extraUsers,
      extraWhatsappUsers: sum.extraWhatsappUsers + tenant.overage.extraWhatsappUsers,
      extraMessages: sum.extraMessages + tenant.overage.extraMessages,
      overageTotal: sum.overageTotal + tenant.overage.values.total,
    }), {
      budgetsCreated: 0, budgetsApproved: 0, budgetsApprovedValue: 0,
      clientsCreated: 0, projectsCreated: 0, sacadasCreated: 0,
      workOrdersCreated: 0, auditedDeletes: 0, whatsappReceived: 0,
      registeredUsers: 0, activeUsers: 0, whatsappUsers: 0, messagesSent: 0,
      consultflexBasicSuccess: 0, consultflexCompleteSuccess: 0,
      extraUsers: 0, extraWhatsappUsers: 0, extraMessages: 0, overageTotal: 0,
    });
  }, [report]);

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDirection(key === 'nome' ? 'asc' : 'desc');
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const headings = ['Cliente', 'Slug', 'Situação', 'Orçamentos criados', 'Orçamentos aprovados', 'Valor orçamentos aprovados', 'Clientes criados', 'Projetos criados', 'Sacadas criadas', 'OS criadas', 'Exclusões auditadas', 'WhatsApp recebidas', 'WhatsApp enviadas', 'Usuários cadastrados', 'Usuários ativos', 'Limite usuários', 'Usuários WhatsApp', 'Limite WhatsApp', 'Mensagens enviadas', 'Limite mensagens', 'ConsultFlex básica', 'ConsultFlex completa', 'Excedente usuários', 'Excedente WhatsApp', 'Excedente mensagens', 'Excedente estimado'];
    const rows = sortedTenants.map((tenant) => [
      tenant.nome, tenant.slug, tenant.ativa ? 'Ativo' : 'Inativo',
      tenant.activity.budgetsCreated, tenant.activity.budgetsApproved,
      tenant.activity.budgetsApprovedValue.toFixed(2).replace('.', ','),
      tenant.activity.clientsCreated, tenant.activity.projectsCreated,
      tenant.activity.sacadasCreated, tenant.activity.workOrdersCreated,
      tenant.activity.auditedDeletes, tenant.usage.whatsappReceived,
      tenant.usage.messagesSent,
      tenant.usage.registeredUsers, tenant.usage.activeUsers, tenant.limits.users,
      tenant.usage.whatsappUsers, tenant.limits.whatsappUsers,
      tenant.usage.messagesSent, tenant.limits.messages,
      tenant.usage.consultflexBasicSuccess, tenant.usage.consultflexCompleteSuccess,
      tenant.overage.extraUsers, tenant.overage.extraWhatsappUsers, tenant.overage.extraMessages,
      tenant.overage.values.total.toFixed(2).replace('.', ','),
    ]);
    rows.push([
      'TOTAL', '', '', totals.budgetsCreated, totals.budgetsApproved,
      totals.budgetsApprovedValue.toFixed(2).replace('.', ','), totals.clientsCreated,
      totals.projectsCreated, totals.sacadasCreated, totals.workOrdersCreated,
      totals.auditedDeletes, totals.whatsappReceived, totals.messagesSent,
      totals.registeredUsers, totals.activeUsers, '', totals.whatsappUsers, '',
      totals.messagesSent, '', totals.consultflexBasicSuccess, totals.consultflexCompleteSuccess,
      totals.extraUsers, totals.extraWhatsappUsers, totals.extraMessages, totals.overageTotal.toFixed(2).replace('.', ','),
    ]);
    const csv = `\uFEFF${[headings, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `consumo-tenants-${startDate}-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const SortButton = ({ label, field, align = 'left' }: { label: string; field: SortKey; align?: 'left' | 'right' }) => (
    <button type="button" onClick={() => sortBy(field)} className={`inline-flex items-center gap-1.5 whitespace-nowrap font-bold text-slate-600 hover:text-emerald-700 ${align === 'right' ? 'justify-end' : ''}`}>
      {label}{sortKey === field ? sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowDown size={13} className="opacity-25" />}
    </button>
  );

  return <main className="mx-auto max-w-[1600px] space-y-5 pb-12">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link href="/assinaturas" aria-label="Voltar às assinaturas" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ArrowLeft size={17} /></Link>
        <div><h1 className="text-xl font-black uppercase text-slate-800">Relatório de Consumo</h1><p className="text-xs text-slate-500">Consolidado de todos os clientes do 791Glass</p></div>
      </div>
      <button type="button" onClick={exportCsv} disabled={!report} className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-xs font-black uppercase text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"><Download size={15} /> Exportar Excel</button>
    </div>

    <section className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Data inicial<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700" /></label>
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Data final<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 block h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700" /></label>
      <button type="button" onClick={() => void generateReport()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-black uppercase text-white hover:bg-emerald-700 disabled:opacity-50">{loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Gerar relatório</button>
      {report && <span className="text-xs text-slate-500">{report.tenants.length} clientes · Atualizado {new Date(report.generatedAt).toLocaleString('pt-BR')}</span>}
    </section>

    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[2200px] border-collapse text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left"><SortButton label="Cliente" field="nome" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Orçamentos" field="budgetsCreated" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Aprovados" field="budgetsApproved" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Valor aprovado" field="budgetsApprovedValue" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Clientes" field="clientsCreated" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Projetos" field="projectsCreated" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Sacadas" field="sacadasCreated" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="OS" field="workOrdersCreated" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Exclusões" field="auditedDeletes" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="WPP recebidas" field="whatsappReceived" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="WPP enviadas" field="whatsappSent" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Usuários" field="registeredUsers" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Ativos" field="activeUsers" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="WhatsApp" field="whatsappUsers" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Mensagens" field="messagesSent" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="CF básica" field="consultflexBasicSuccess" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="CF completa" field="consultflexCompleteSuccess" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Excesso SIS" field="extraUsers" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Excesso WPP" field="extraWhatsappUsers" align="right" /></th>
              <th className="px-3 py-3 text-right"><SortButton label="Excesso MSG" field="extraMessages" align="right" /></th>
              <th className="px-4 py-3 text-right"><SortButton label="Excesso estimado" field="overageTotal" align="right" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedTenants.map((tenant) => <tr key={tenant.vidracariaId} className="hover:bg-slate-50/70">
              <td className="px-4 py-3"><p className="font-bold text-slate-800">{tenant.nome}</p><p className="text-[10px] text-slate-400">{tenant.slug}</p></td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.budgetsCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.budgetsApproved)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{currencyFormat.format(tenant.activity.budgetsApprovedValue)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.clientsCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.projectsCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.sacadasCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.workOrdersCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.activity.auditedDeletes)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.whatsappReceived)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.messagesSent)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.registeredUsers)} <span className="text-slate-400">/ {numberFormat.format(tenant.limits.users)}</span></td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.activeUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.whatsappUsers)} <span className="text-slate-400">/ {numberFormat.format(tenant.limits.whatsappUsers)}</span></td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.messagesSent)} <span className="text-slate-400">/ {numberFormat.format(tenant.limits.messages)}</span></td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.consultflexBasicSuccess)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.usage.consultflexCompleteSuccess)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.overage.extraUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.overage.extraWhatsappUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(tenant.overage.extraMessages)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{currencyFormat.format(tenant.overage.values.total)}</td>
            </tr>)}
            {report && <tr className="bg-emerald-50 font-black text-slate-800">
              <td className="px-4 py-3">TOTAL ({sortedTenants.length} clientes)</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.budgetsCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.budgetsApproved)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{currencyFormat.format(totals.budgetsApprovedValue)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.clientsCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.projectsCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.sacadasCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.workOrdersCreated)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.auditedDeletes)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.whatsappReceived)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.messagesSent)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.registeredUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.activeUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.whatsappUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.messagesSent)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.consultflexBasicSuccess)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.consultflexCompleteSuccess)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.extraUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.extraWhatsappUsers)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{numberFormat.format(totals.extraMessages)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{currencyFormat.format(totals.overageTotal)}</td>
            </tr>}
            {!loading && report?.tenants.length === 0 && <tr><td colSpan={21} className="px-4 py-12 text-center text-sm text-slate-400">Nenhum cliente encontrado no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}