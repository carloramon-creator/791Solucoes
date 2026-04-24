import { Users, Building2, DollarSign, Calendar, LayoutTemplate, AlertTriangle, Settings, Scissors } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 animate-in fade-in duration-500">
      
      {/* Header Section */}
      <div className="mb-8">
        <p className="text-[13px] text-[#3b597b] font-medium">Bem-vindo, Administrador Global</p>
        <div className="flex items-center gap-3 mt-2">
          <div className="p-2.5 bg-white rounded-md shadow-sm border border-slate-200">
            <Building2 size={24} className="text-[#3b597b]" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase">
            791 SOLUÇÕES - HOLDING
          </h1>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#3b597b] text-white tracking-wider">CNPJ 00.000.000/0001-00</span>
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#6899c4] text-white tracking-wider">SAAS MANAGER</span>
          <span className="px-2.5 py-1 rounded text-[10px] font-bold bg-slate-200 text-slate-700 tracking-wider">ATIVO</span>
        </div>
      </div>

      {/* Top 3 Large Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Card 1 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <LayoutTemplate size={18} />
            <span>Sistemas</span>
          </div>
          <div className="mt-4">
            <h3 className="text-[15px] font-bold text-slate-800 uppercase tracking-wide">791 GLASS & 791 BARBER</h3>
            <p className="text-xs font-medium text-[#6899c4] uppercase mt-1.5 tracking-wider">STATUS OPERACIONAL</p>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <Calendar size={18} />
            <span>Próximo Fechamento</span>
          </div>
          <div className="mt-4">
            <h3 className="text-[17px] font-bold text-slate-800">30 de abril</h3>
            <p className="text-xs font-medium text-[#6899c4] mt-1.5">Ciclo de Faturamento 04/2026</p>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
            <DollarSign size={18} />
            <span>Receita Recorrente (MRR)</span>
          </div>
          <div className="mt-4 flex items-baseline gap-1.5">
            <h3 className="text-3xl font-bold text-[#3b597b]">45.230</h3>
            <p className="text-xs font-medium text-slate-500">neste mês</p>
          </div>
        </div>
      </div>

      {/* 4 Colored Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
        <div className="relative overflow-hidden rounded-xl bg-[#2e5e89] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">1.234</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Lojas Ativas</div>
          </div>
          <Users size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#528ebf] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">12k</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Faturamento Hoje</div>
          </div>
          <DollarSign size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#68a0c9] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">45</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Assinaturas no Ano</div>
          </div>
          <Calendar size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#cc3939] p-6 text-white shadow-sm flex flex-col justify-center min-h-[130px] hover:-translate-y-1 transition-transform cursor-pointer">
          <div className="relative z-10">
            <div className="text-4xl font-bold tracking-tight">12</div>
            <div className="text-xs text-white/80 font-medium mt-1.5 uppercase tracking-wider">Necessita Revisão</div>
          </div>
          <AlertTriangle size={90} className="absolute -right-4 -bottom-4 text-white opacity-20" />
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mt-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <Settings size={18} />
            <h2>Ações Rápidas</h2>
          </div>
          <div className="flex items-start gap-4 p-3 -mx-3 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors">
            <div className="p-2.5 bg-slate-100 rounded-md text-slate-600">
              <Settings size={20} />
            </div>
            <div className="pt-0.5">
              <p className="text-[13px] font-semibold text-slate-800">Ajustes</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Acesse as configurações do sistema</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <LayoutTemplate size={18} />
            <h2>Processos Recentes</h2>
          </div>
          <div className="flex flex-1 items-center justify-center text-[13px] text-[#6899c4]">
            Nenhum processo recente
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col min-h-[220px]">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px] mb-6">
            <AlertTriangle size={18} className="text-red-500" />
            <h2>Inadimplência</h2>
          </div>
          <div className="flex flex-1 items-center justify-center text-[13px] text-[#6899c4]">
            Nenhuma situação inadimplente
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-0 overflow-hidden flex flex-col min-h-[220px]">
          <div className="p-5 pb-4 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-2 text-slate-800 font-semibold text-[15px]">
              <Users size={18} />
              <h2>Novos Clientes</h2>
            </div>
            <button className="text-[11px] font-semibold px-3 py-1.5 bg-slate-100 rounded-md text-slate-600 flex items-center gap-1.5 hover:bg-slate-200 transition-colors">
              <Calendar size={14} /> Abril <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
          </div>
          <div className="flex border-b border-slate-100 bg-slate-50/50">
            <div className="flex-1 py-3 text-center text-[13px] font-semibold border-b-2 border-[#3b597b] text-[#3b597b] flex items-center justify-center gap-2">
              <Building2 size={16} /> 791glass
            </div>
            <div className="flex-1 py-3 text-center text-[13px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer flex items-center justify-center gap-2 transition-colors">
              <Scissors size={16} /> 791barber
              <span className="bg-[#6899c4] text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none h-4 flex items-center">9</span>
            </div>
          </div>
          <div className="flex-1 p-6 flex items-center justify-center text-[13px] text-[#6899c4]">
            Lista de assinantes recentes
          </div>
        </div>
      </div>

    </div>
  );
}
