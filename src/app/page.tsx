'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  ShieldCheck,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type PeriodFilter = 'dia' | 'semana' | 'quinzena' | 'mes' | 'trimestre' | 'semestre' | 'ano';

type UsageSummaryResponse = {
  generatedAt?: string;
  messagesPeriodStart?: string;
  faturamentoMesAtual?: number;
  faturamentoAcumulado?: number;
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

type UserProfile = {
  id: string;
  email: string;
  user_metadata?: {
    avatar_url?: string;
  };
};

type ModalData = {
  type: 'tickets' | 'financeiro' | null;
  subtype?: string;
  data?: any[];
};

type TicketTotals = {
  total: number;
  emDia: number;
  atrasados: number;
  resolvidos: number;
};

type DateRange = {
  start: string;
  end: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDate(value?: string) {
  if (!value) return 'Agora';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function getPeriodLabel(period: PeriodFilter): string {
  const labels: Record<PeriodFilter, string> = {
    dia: 'Hoje',
    semana: 'Semana',
    quinzena: 'Quinzena',
    mes: 'Mês',
    trimestre: 'Trimestre',
    semestre: 'Semestre',
    ano: 'Ano',
  };
  return labels[period];
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function toInputDateValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function getPeriodRange(period: PeriodFilter): DateRange {
  const now = new Date();
  const startDate = new Date(now);

  switch (period) {
    case 'dia':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'semana':
      startDate.setDate(now.getDate() - now.getDay());
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'quinzena':
      startDate.setDate(now.getDate() > 15 ? 16 : 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'mes':
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'trimestre':
      startDate.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'semestre':
      startDate.setMonth(now.getMonth() >= 6 ? 6 : 0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'ano':
      startDate.setMonth(0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
  }

  return {
    start: toInputDateValue(startDate),
    end: toInputDateValue(now),
  };
}

function toIsoStartOfDay(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function toIsoEndOfDay(value: string) {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

export default function Dashboard() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<UsageSummaryResponse | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('mes');
  const [dateRange, setDateRange] = useState<DateRange>(() => getPeriodRange('mes'));
  const [modal, setModal] = useState<ModalData>({ type: null });
  const [financialTotals, setFinancialTotals] = useState({ saldoAtual: 0, contasReceber: 0, contasPagar: 0 });
  const [ticketTotals, setTicketTotals] = useState<TicketTotals>({ total: 0, emDia: 0, atrasados: 0, resolvidos: 0 });

  const rangeStartIso = toIsoStartOfDay(dateRange.start);
  const rangeEndIso = toIsoEndOfDay(dateRange.end);

  const periods: PeriodFilter[] = ['dia', 'semana', 'quinzena', 'mes', 'trimestre', 'semestre', 'ano'];

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const user = sessionData.session?.user;

        if (!token) {
          throw new Error('Sessao expirada. Faça login novamente.');
        }

        if (user && alive) {
          setUserProfile({
            id: user.id,
            email: user.email || '',
            user_metadata: user.user_metadata,
          });
        }

        const response = await fetch(`/api/admin/subscription-usage?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}`, {
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
  }, [supabase, selectedPeriod, dateRange.start, dateRange.end]);

  useEffect(() => {
    setDateRange(getPeriodRange(selectedPeriod));
  }, [selectedPeriod]);

  // Carregar totais financeiros quando o período muda
  useEffect(() => {
    let alive = true;

    const loadFinancialTotals = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;

        const [saldoRes, receberRes, pagarRes] = await Promise.all([
          fetch(`/api/admin/financial-summary?section=saldo-atual`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(`/api/admin/financial-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&section=contas-receber`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(`/api/admin/financial-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&section=contas-pagar`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ]);

        const saldoData = await saldoRes.json().catch(() => []);
        const receberData = await receberRes.json().catch(() => []);
        const pagarData = await pagarRes.json().catch(() => []);

        if (alive) {
          setFinancialTotals({
            saldoAtual: Array.isArray(saldoData) ? saldoData.reduce((sum, item) => sum + (Number(item?.valor) || 0), 0) : 0,
            contasReceber: (Array.isArray(receberData) ? receberData.reduce((sum, item) => sum + (Number(item?.valor) || 0), 0) : 0),
            contasPagar: (Array.isArray(pagarData) ? pagarData.reduce((sum, item) => sum + (Number(item?.valor) || 0), 0) : 0),
          });
        }
      } catch (err) {
        console.error('Erro ao carregar totais financeiros:', err);
      }
    };

    loadFinancialTotals();
    return () => {
      alive = false;
    };
  }, [supabase, selectedPeriod, dateRange.start, dateRange.end]);

  useEffect(() => {
    let alive = true;

    const loadTicketTotals = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;

        const [totalRes, emDiaRes, atrasadosRes, resolvidosRes] = await Promise.all([
          fetch(`/api/admin/tickets-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&status=total`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(`/api/admin/tickets-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&status=em-dia`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(`/api/admin/tickets-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&status=atrasados`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(`/api/admin/tickets-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&status=resolvidos`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ]);

        const totalData = await totalRes.json().catch(() => []);
        const emDiaData = await emDiaRes.json().catch(() => []);
        const atrasadosData = await atrasadosRes.json().catch(() => []);
        const resolvidosData = await resolvidosRes.json().catch(() => []);

        if (alive) {
          setTicketTotals({
            total: Array.isArray(totalData) ? totalData.length : 0,
            emDia: Array.isArray(emDiaData) ? emDiaData.length : 0,
            atrasados: Array.isArray(atrasadosData) ? atrasadosData.length : 0,
            resolvidos: Array.isArray(resolvidosData) ? resolvidosData.length : 0,
          });
        }
      } catch (err) {
        console.error('Erro ao carregar totais de tickets:', err);
      }
    };

    loadTicketTotals();
    return () => {
      alive = false;
    };
  }, [supabase, selectedPeriod, dateRange.start, dateRange.end]);

  const totals = data?.totals;
  const tenants = data?.tenants || [];
  const latestTenants = tenants.slice(0, 4);
  const healthCount = (totals?.usersExceeded || 0) + (totals?.whatsappUsersExceeded || 0) + (totals?.messagesExceeded || 0);

  const handleCardClick = async (type: 'tickets' | 'financeiro', subtype: string) => {
    setModal({ type, subtype, data: [] });
    
    // Carregar dados reais baseado no tipo
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      let apiUrl = '';
      if (type === 'financeiro') {
        apiUrl = subtype === 'saldo-atual'
          ? `/api/admin/financial-summary?section=${subtype}`
          : `/api/admin/financial-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&section=${subtype}`;
      } else if (type === 'tickets') {
        apiUrl = `/api/admin/tickets-summary?period=${selectedPeriod}&startDate=${rangeStartIso}&endDate=${rangeEndIso}&status=${subtype}`;
      }

      if (apiUrl) {
        const response = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => []);
        setModal({ type, subtype, data: Array.isArray(payload) ? payload : payload.data || [] });
      }
    } catch (err) {
      console.error('Erro ao carregar dados do modal:', err);
    }
  };

  const closeModal = () => {
    setModal({ type: null });
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 animate-in fade-in duration-500">
      {/* Header com foto do usuário */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-[#3b597b] font-medium">Bem-vindo, {userProfile?.email?.split('@')[0]?.toUpperCase() || 'ADMINISTRADOR'}</p>
            <div className="flex items-center gap-3 mt-2">
              <div className="p-2.5 bg-white rounded-md shadow-sm border border-slate-200">
                <Building2 size={24} className="text-[#3b597b]" />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase">791 SOLUÇÕES - HOLDING</h1>
            </div>
          </div>
          {/* Avatar do usuário no topo direito */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-800">{userProfile?.email?.split('@')[0] || 'Admin'}</p>
              <p className="text-[11px] text-slate-500">{userProfile?.email || 'carregando...'}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#3b597b] to-[#6899c4] flex items-center justify-center text-white font-bold">
              {userProfile?.user_metadata?.avatar_url ? (
                <img
                  src={userProfile.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User size={24} />
              )}
            </div>
          </div>
        </div>

        {/* Filtros de período em botões */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {periods.map((period) => (
            <button
              key={period}
              onClick={() => {
                setSelectedPeriod(period);
                setDateRange(getPeriodRange(period));
              }}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-all ${
                selectedPeriod === period
                  ? 'bg-[#3b597b] text-white shadow-md'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {getPeriodLabel(period)}
            </button>
          ))}
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#6899c4] text-white tracking-wider ml-2">
            {totals?.tenants || 0} LOJAS | DADOS AO VIVO | {formatDate(data?.generatedAt)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-slate-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Intervalo aplicado</span>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
            <span>Data inicial</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(event) => setDateRange((current) => ({ ...current, start: event.target.value }))}
              className="bg-transparent text-slate-700 outline-none"
            />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
            <span>Data fim</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(event) => setDateRange((current) => ({ ...current, end: event.target.value }))}
              className="bg-transparent text-slate-700 outline-none"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            O período do painel considera tudo entre as duas datas, de trás para frente até hoje, a menos que você altere o fim.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      {/* Faturamento (MRR) - 2 cards: período e acumulado */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[140px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <BarChart3 size={18} />
            <span>Faturamento - Período ({getPeriodLabel(selectedPeriod)})</span>
          </div>
          <div className="mt-4 flex items-baseline gap-1.5">
            <h3 className="text-4xl font-bold text-[#3b597b]">{formatCurrency(data?.faturamentoMesAtual || 0)}</h3>
            <p className="text-xs font-medium text-slate-500">neste período</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[140px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <BarChart3 size={18} />
            <span>Faturamento - Acumulado Total</span>
          </div>
          <div className="mt-4 flex items-baseline gap-1.5">
            <h3 className="text-4xl font-bold text-[#3b597b]">{formatCurrency(data?.faturamentoAcumulado || 0)}</h3>
            <p className="text-xs font-medium text-slate-500">desde o início</p>
          </div>
        </div>
      </div>

      {/* Linha 1: Stats principais */}
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
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Mensagens WhatsApp</div>
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

      {/* Linha 2: Resumo operacional e financeiro */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
        {/* Resumo Operacional */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[280px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <ShieldCheck size={18} />
            <h2>Resumo operacional</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
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
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Mensagens WhatsApp</p>
              <p className="mt-1 text-lg font-bold text-slate-800">{totals?.messagesSent || 0}</p>
            </div>
          </div>
          <div className="flex-1 flex items-end">
            <p className="text-[12px] text-slate-500">Consumo baseado no período: <strong>{getPeriodLabel(selectedPeriod)}</strong></p>
          </div>
        </div>

        {/* Resumo Financeiro (Clicável) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[280px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <BarChart3 size={18} />
            <h2>Resumo financeiro</h2>
          </div>
          <div className="space-y-3 flex-1">
            <button
              onClick={() => handleCardClick('financeiro', 'saldo-atual')}
              className="w-full rounded-lg bg-slate-50 p-3 hover:bg-blue-50 transition-colors text-left border border-transparent hover:border-blue-200"
            >
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Saldo atual (todas as contas)</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-lg font-bold text-slate-800">{formatCurrency(financialTotals.saldoAtual)}</p>
                <ChevronRight size={16} className="text-slate-400" />
              </div>
            </button>

            <button
              onClick={() => handleCardClick('financeiro', 'contas-receber')}
              className="w-full rounded-lg bg-emerald-50 p-3 hover:bg-emerald-100 transition-colors text-left border border-transparent hover:border-emerald-200"
            >
              <p className="text-[11px] uppercase tracking-wider text-emerald-600">Contas a receber (em aberto)</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-lg font-bold text-emerald-700">{formatCurrency(financialTotals.contasReceber)}</p>
                <ChevronRight size={16} className="text-emerald-400" />
              </div>
            </button>

            <button
              onClick={() => handleCardClick('financeiro', 'contas-pagar')}
              className="w-full rounded-lg bg-red-50 p-3 hover:bg-red-100 transition-colors text-left border border-transparent hover:border-red-200"
            >
              <p className="text-[11px] uppercase tracking-wider text-red-600">Contas a pagar (em aberto)</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-lg font-bold text-red-700">{formatCurrency(financialTotals.contasPagar)}</p>
                <ChevronRight size={16} className="text-red-400" />
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Linha 3: Cards de Tickets (Clicáveis) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[280px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <Clock size={18} />
            <h2>Tickets do período</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 flex-1">
            <button
              onClick={() => handleCardClick('tickets', 'total')}
              className="rounded-lg bg-blue-50 p-4 hover:bg-blue-100 transition-colors text-left border border-transparent hover:border-blue-200 cursor-pointer"
            >
              <p className="text-[11px] uppercase tracking-wider text-blue-600">Total</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-2xl font-bold text-blue-700">{ticketTotals.total}</p>
                <ChevronRight size={18} className="text-blue-400" />
              </div>
            </button>

            <button
              onClick={() => handleCardClick('tickets', 'em-dia')}
              className="rounded-lg bg-emerald-50 p-4 hover:bg-emerald-100 transition-colors text-left border border-transparent hover:border-emerald-200 cursor-pointer"
            >
              <p className="text-[11px] uppercase tracking-wider text-emerald-600">Em dia</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-2xl font-bold text-emerald-700">{ticketTotals.emDia}</p>
                <ChevronRight size={18} className="text-emerald-400" />
              </div>
            </button>

            <button
              onClick={() => handleCardClick('tickets', 'atrasados')}
              className="rounded-lg bg-orange-50 p-4 hover:bg-orange-100 transition-colors text-left border border-transparent hover:border-orange-200 cursor-pointer"
            >
              <p className="text-[11px] uppercase tracking-wider text-orange-600">Atrasados</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-2xl font-bold text-orange-700">{ticketTotals.atrasados}</p>
                <ChevronRight size={18} className="text-orange-400" />
              </div>
            </button>

            <button
              onClick={() => handleCardClick('tickets', 'resolvidos')}
              className="rounded-lg bg-slate-50 p-4 hover:bg-slate-100 transition-colors text-left border border-transparent hover:border-slate-200 cursor-pointer"
            >
              <p className="text-[11px] uppercase tracking-wider text-slate-600">Resolvidos</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-2xl font-bold text-slate-700">{ticketTotals.resolvidos}</p>
                <ChevronRight size={18} className="text-slate-400" />
              </div>
            </button>
          </div>
        </div>

        {/* Lojas monitoradas */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[280px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <h2>Lojas monitoradas</h2>
          </div>
          <div className="space-y-3 flex-1">
            {latestTenants.length ? (
              latestTenants.map((tenant) => (
                <div key={tenant.id || tenant.slug || tenant.nome} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{tenant.nome_fantasia || tenant.nome || 'Sem nome'}</p>
                    <p className="text-[11px] text-slate-500">{tenant.slug || 'sem-slug'}</p>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <p>{tenant.usage?.registeredUsers || 0} usuários</p>
                    <p>{tenant.usage?.messagesSent || 0} msgs</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {loading ? 'Carregando lojas...' : 'Nenhuma loja encontrada.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal para exibir detalhes */}
      {modal.type && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                {modal.type === 'tickets' 
                  ? `Tickets - ${modal.subtype === 'total' ? 'Total' : modal.subtype === 'em-dia' ? 'Em dia' : modal.subtype === 'atrasados' ? 'Atrasados' : modal.subtype === 'resolvidos' ? 'Resolvidos' : modal.subtype}`
                  : `Financeiro - ${modal.subtype === 'saldo-atual' ? 'Saldo atual' : modal.subtype === 'contas-receber' ? 'Contas a receber' : 'Contas a pagar'}`
                }
              </h3>
              <button onClick={closeModal} className="p-1 hover:bg-slate-100 rounded-md transition-colors">
                <X size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="p-6">
              {modal.data && modal.data.length > 0 ? (
                <div className="space-y-3">
                  {modal.type === 'financeiro' && modal.subtype === 'saldo-atual' ? (
                    // Renderização especial para Saldo Atual (dados de contas bancárias)
                    modal.data.map((item, idx) => (
                      <div key={idx} className="border border-blue-200 rounded-lg p-4 bg-blue-50 hover:bg-blue-100 transition-colors">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="font-bold text-slate-800">{item.descricao || 'Conta Bancária'}</p>
                            {item.detalhes && (
                              <p className="text-sm text-slate-600 mt-1">{item.detalhes}</p>
                            )}
                            {item.data_vencimento && (
                              <p className="text-xs text-slate-500 mt-2">Atualizado em: {formatDate(item.data_vencimento)}</p>
                            )}
                          </div>
                          {item.valor !== undefined && (
                            <div className="text-right ml-4">
                              <p className="text-2xl font-bold text-blue-700">{formatCurrency(item.valor)}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    // Renderização padrão para outros tipos (Contas a Receber/Pagar, Tickets)
                    modal.data.map((item, idx) => (
                      <div key={idx} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-bold text-slate-800">{item.titulo || item.descricao || item.nome || 'Item'}</p>
                            <p className="text-sm text-slate-600 mt-1">{item.detalhes || item.descricao_completa || ''}</p>
                          </div>
                          {item.valor && (
                            <p className="text-right font-bold text-slate-800">{formatCurrency(item.valor)}</p>
                          )}
                        </div>
                        {item.data_vencimento && (
                          <p className="text-xs text-slate-500 mt-2">Vencimento: {formatDate(item.data_vencimento)}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-slate-600 text-center">
                    Carregando dados do período: <strong>{getPeriodLabel(selectedPeriod)}</strong>
                  </p>
                  <p className="text-slate-400 text-sm mt-2">Os dados reais aparecerão aqui quando disponíveis</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}