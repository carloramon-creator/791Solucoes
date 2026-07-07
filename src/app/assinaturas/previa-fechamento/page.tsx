"use client";

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface ClosingPreviewTenant {
  tenantId: string;
  tenantName: string;
  status: 'with_charge' | 'without_charge' | 'error';
  reason?: string;
  consultflex?: {
    basic?: number;
    complete?: number;
    failed?: number;
    unknown?: number;
  };
  values?: {
    users?: number;
    whatsappUsers?: number;
    messages?: number;
    consultflexTotal?: number;
    total?: number;
  };
  error?: string;
}

interface ClosingPreviewReport {
  scanned: number;
  withCharge: number;
  withoutCharge: number;
  errors: number;
  projectedRevenueTotal: number;
  refMonth: string | null;
  dueDate: string | null;
  tenantBreakdown: ClosingPreviewTenant[];
}

export default function PreviaFechamentoPage() {
  const authClient = useMemo(() => createSupabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ClosingPreviewReport | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  };

  async function fetchPreview() {
    setLoading(true);
    setError('');

    try {
      let accessToken = '';

      const { data: sessionData } = await authClient.auth.getSession();
      accessToken = sessionData.session?.access_token || '';

      if (!accessToken) {
        const { data: refreshed } = await authClient.auth.refreshSession();
        accessToken = refreshed.session?.access_token || '';
      }

      if (!accessToken) {
        throw new Error('Sessao nao encontrada. Faca login novamente.');
      }

      const response = await fetch('/api/admin/closing-preview', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Falha ao gerar previa de fechamento.');
      }

      setReport(payload?.report || null);
    } catch (err: any) {
      setError(err?.message || 'Falha ao gerar previa de fechamento.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPreview();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Assinaturas</p>
          <h1 className="mt-1 text-2xl md:text-3xl font-black text-slate-900">Previa de Fechamento</h1>
          <p className="mt-2 text-sm text-slate-600">Simulacao mensal sem gerar cobrancas. Mostra o faturamento projetado da Holding.</p>
          {(report?.refMonth || report?.dueDate) && (
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Referencia: {report?.refMonth || '-'} | Vencimento: {report?.dueDate || '-'}
            </p>
          )}
        </div>

        <button
          onClick={() => fetchPreview()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Atualizar
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Tenants</p>
          <p className="mt-2 text-2xl font-black text-slate-800">{report?.scanned || 0}</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-600">Com cobranca</p>
          <p className="mt-2 text-2xl font-black text-emerald-700">{report?.withCharge || 0}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Sem cobranca</p>
          <p className="mt-2 text-2xl font-black text-slate-700">{report?.withoutCharge || 0}</p>
        </div>

        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-red-500">Erros</p>
          <p className="mt-2 text-2xl font-black text-red-700">{report?.errors || 0}</p>
        </div>

        <div className="rounded-xl border border-[#3b597b]/25 bg-[#3b597b]/5 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#3b597b] flex items-center gap-1">
            <TrendingUp size={12} /> Faturamento projetado
          </p>
          <p className="mt-2 text-2xl font-black text-[#2f4a66]">{formatCurrency(report?.projectedRevenueTotal || 0)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">CFX Bas</th>
                <th className="px-3 py-2 text-right">CFX Comp</th>
                <th className="px-3 py-2 text-right">CFX Erro</th>
                <th className="px-3 py-2 text-right">Extras</th>
                <th className="px-3 py-2 text-right">ConsultFlex</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(report?.tenantBreakdown || []).map((item) => {
                const extrasTotal =
                  Number(item.values?.users || 0)
                  + Number(item.values?.whatsappUsers || 0)
                  + Number(item.values?.messages || 0);

                return (
                  <tr key={item.tenantId} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2">
                      <p className="text-[12px] font-bold text-slate-800">{item.tenantName || item.tenantId}</p>
                      <p className="text-[10px] text-slate-500">{item.error || item.reason || '-'}</p>
                    </td>
                    <td className="px-3 py-2 text-[11px] font-bold uppercase">
                      {item.status === 'with_charge' ? 'Com cobranca' : item.status === 'without_charge' ? 'Sem cobranca' : 'Erro'}
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold">{Number(item.consultflex?.basic || 0)}</td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold">{Number(item.consultflex?.complete || 0)}</td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold">{Number(item.consultflex?.failed || 0)}</td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold">{formatCurrency(extrasTotal)}</td>
                    <td className="px-3 py-2 text-right text-[12px] font-semibold">{formatCurrency(Number(item.values?.consultflexTotal || 0))}</td>
                    <td className="px-3 py-2 text-right text-[12px] font-black text-[#2f4a66]">{formatCurrency(Number(item.values?.total || 0))}</td>
                  </tr>
                );
              })}

              {!loading && (!report?.tenantBreakdown || report.tenantBreakdown.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nenhum tenant encontrado para a simulacao.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
