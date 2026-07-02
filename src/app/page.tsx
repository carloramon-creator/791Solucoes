'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Building2, Calendar, CheckCircle2, Layers, ShieldCheck, Users, Zap } from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type UsageSummaryResponse = {
  generatedAt?: string;
  messagesPeriodStart?: string;
  totals?: {
    tenants: number;
    registeredUsers: number;
    activeUsers: number;
    whatsappUsers: number;
    sectors: number;
    messagesSent: number;
    overageMonthly: number;
    usersExceeded: number;
    whatsappUsersExceeded: number;
    messagesExceeded: number;
  };
  tenants?: Array<{
    id?: string;
    nome?: string;
    nome_fantasia?: string | null;
    slug?: string | null;
    usage?: {
      registeredUsers: number;
      activeUsers: number;
      whatsappUsers: number;
      sectors: number;
      messagesSent: number;
    };
  }>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDate(value?: string) {
  if (!value) return 'Agora';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function Dashboard() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<UsageSummaryResponse | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          throw new Error('Sessao expirada. Faça login novamente.');
        }

        const response = await fetch('/api/admin/subscription-usage', {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || 'Falha ao carregar o painel.');
        }

        if (alive) {
          setData(payload);
        }
      } catch (err: any) {
        if (alive) {
          setError(err?.message || 'Falha ao carregar o painel.');
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const totals = data?.totals;
  const tenants = data?.tenants || [];
  const latestTenants = tenants.slice(0, 4);
  const healthCount = (totals?.usersExceeded || 0) + (totals?.whatsappUsersExceeded || 0) + (totals?.messagesExceeded || 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 animate-in fade-in duration-500">
      <div className="mb-8">
        <p className="text-[13px] text-[#3b597b] font-medium">Bem-vindo, Administrador Global</p>
        <div className="flex items-center gap-3 mt-2">
          <div className="p-2.5 bg-white rounded-md shadow-sm border border-slate-200">
            <Building2 size={24} className="text-[#3b597b]" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase">791 SOLUÇÕES - HOLDING</h1>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#3b597b] text-white tracking-wider">{totals?.tenants || 0} LOJAS</span>
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#6899c4] text-white tracking-wider">DADOS AO VIVO</span>
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700 tracking-wider">{formatDate(data?.generatedAt)}</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <Layers size={18} />
            <span>Consumo consolidado</span>
          </div>
          <div className="mt-4">
            <h3 className="text-[15px] font-bold text-slate-800 uppercase tracking-wide">{loading ? 'Carregando...' : 'Subscription usage'}</h3>
            <p className="text-xs font-medium text-[#6899c4] uppercase mt-1.5 tracking-wider">Painel dinâmico da holding</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <Calendar size={18} />
            <span>Período analisado</span>
          </div>
          <div className="mt-4">
            <h3 className="text-[17px] font-bold text-slate-800">{formatDate(data?.messagesPeriodStart)}</h3>
            <p className="text-xs font-medium text-[#6899c4] mt-1.5">Mensagens e limites consolidados no período</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <BarChart3 size={18} />
            <span>Excedentes</span>
          </div>
          <div className="mt-4 flex items-baseline gap-1.5">
            <h3 className="text-3xl font-bold text-[#3b597b]">{formatCurrency(totals?.overageMonthly || 0)}</h3>
            <p className="text-xs font-medium text-slate-500">mensal</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
        <div className="relative overflow-hidden rounded-xl bg-[#2e5e89] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">{totals?.tenants || 0}</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Lojas ativas</div>
          </div>
          <Building2 size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#528ebf] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">{totals?.registeredUsers || 0}</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Usuários cadastrados</div>
          </div>
          <Users size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#68a0c9] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">{totals?.messagesSent || 0}</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Mensagens do período</div>
          </div>
          <Zap size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#cc3939] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">{healthCount}</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Necessita revisão</div>
          </div>
          <AlertTriangle size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <ShieldCheck size={18} />
            <h2>Resumo operacional</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Usuários ativos</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{totals?.activeUsers || 0}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Usuários WhatsApp</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{totals?.whatsappUsers || 0}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Setores</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{totals?.sectors || 0}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Excedente mensal</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{formatCurrency(totals?.overageMonthly || 0)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <h2>Lojas monitoradas</h2>
          </div>
          <div className="space-y-3">
            {latestTenants.length ? latestTenants.map((tenant) => (
              <div key={tenant.id || tenant.slug || tenant.nome} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{tenant.nome_fantasia || tenant.nome || 'Sem nome'}</p>
                  <p className="text-[11px] text-slate-500">{tenant.slug || 'sem-slug'}</p>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  <p>{tenant.usage?.registeredUsers || 0} usuários</p>
                  <p>{tenant.usage?.messagesSent || 0} mensagens</p>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {loading ? 'Carregando lojas...' : 'Nenhuma loja encontrada.'}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <AlertTriangle size={18} className="text-red-500" />
            <h2>Revisões pendentes</h2>
          </div>
          <div className="flex flex-1 items-center justify-center text-[13px] text-[#6899c4] text-center">
            {healthCount ? `${healthCount} pontos de atenção na base consolidada` : 'Nenhuma situação inadimplente'}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-0 overflow-hidden flex flex-col min-h-[220px]">
          <div className="p-5 pb-4 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px]">
              <ArrowRight size={18} />
              <h2>Ações rápidas</h2>
            </div>
          </div>
          <div className="p-5 space-y-3 text-sm text-slate-600">
            <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-4 py-3">
              <Building2 size={18} className="mt-0.5 text-[#3b597b]" />
              <div>
                <p className="font-semibold text-slate-800">Expandir visão por loja</p>
                <p className="text-[12px] text-slate-500">Os cartões abaixo refletem a consolidação real por vidraçaria.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-slate-50 px-4 py-3">
              <BarChart3 size={18} className="mt-0.5 text-[#3b597b]" />
              <div>
                <p className="font-semibold text-slate-800">Monitorar picos de uso</p>
                <p className="text-[12px] text-slate-500">A página agora depende dos dados do backend, não de valores estáticos.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}