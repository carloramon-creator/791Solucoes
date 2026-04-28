'use client';

import React, { useState } from 'react';
import { 
  Users, 
  Plus, 
  Key, 
  Calendar, 
  BarChart3, 
  Search, 
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Zap,
  TrendingUp,
  MoreHorizontal
} from 'lucide-react';

interface Patrocinador {
  id: string;
  nome: string;
  status: 'ativo' | 'inativo';
  totalLicencas: number;
  licencasUsadas: number;
  valorMensal: number;
  dataExpiracao: string | 'indeterminado';
  vouchers: string[];
}

export default function PatrocinadoresPage() {
  const [searchTerm, setSearchTerm] = useState('');
  
  // Mock de dados para visualização inicial
  const [patrocinadores] = useState<Patrocinador[]>([
    {
      id: '1',
      nome: 'All Kit Sacadas',
      status: 'ativo',
      totalLicencas: 20,
      licencasUsadas: 12,
      valorMensal: 5000,
      dataExpiracao: 'indeterminado',
      vouchers: ['791-AKIT-8829-X', '791-AKIT-1120-P']
    },
    {
      id: '2',
      nome: 'Solução Sacadas',
      status: 'ativo',
      totalLicencas: 40,
      licencasUsadas: 38,
      valorMensal: 9500,
      dataExpiracao: '2026-12-31',
      vouchers: ['791-SOLU-9901-K']
    }
  ]);

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 lg:p-10">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-[#1e293b] flex items-center gap-3">
              <ShieldCheck className="text-blue-600" size={32} />
              Gestão de Patrocinadores
            </h1>
            <p className="text-slate-500 mt-2 font-medium">Gerencie parceiros, vouchers e licenciamento em lote.</p>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-blue-200">
            <Plus size={20} />
            Novo Patrocinador
          </button>
        </div>
      </div>

      {/* Estatísticas Rápidas */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className="bg-blue-50 p-4 rounded-xl text-blue-600">
            <Users size={24} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Total de Parceiros</p>
            <h3 className="text-2xl font-black text-slate-800">{patrocinadores.length}</h3>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className="bg-emerald-50 p-4 rounded-xl text-emerald-600">
            <Zap size={24} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Licenças Ativas</p>
            <h3 className="text-2xl font-black text-slate-800">
              {patrocinadores.reduce((acc, p) => acc + p.licencasUsadas, 0)}
              <span className="text-slate-300 text-lg ml-2 font-medium">
                / {patrocinadores.reduce((acc, p) => acc + p.totalLicencas, 0)}
              </span>
            </h3>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className="bg-amber-50 p-4 rounded-xl text-amber-600">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Receita Recorrente (MRR)</p>
            <h3 className="text-2xl font-black text-slate-800">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                patrocinadores.reduce((acc, p) => acc + p.valorMensal, 0)
              )}
            </h3>
          </div>
        </div>
      </div>

      {/* Lista de Patrocinadores */}
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Buscar patrocinador..." 
                className="w-full pl-12 pr-4 py-3 rounded-xl border-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500 transition-all font-medium text-slate-600"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button className="p-3 hover:bg-white rounded-lg text-slate-400 transition-all">
                <BarChart3 size={20} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-slate-50">
                  <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Patrocinador</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Licenciamento</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Faturamento</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {patrocinadores.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-all group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xl group-hover:scale-110 transition-transform">
                          {p.nome.charAt(0)}
                        </div>
                        <div>
                          <div className="font-black text-slate-700">{p.nome}</div>
                          <div className="text-xs text-slate-400 font-bold flex items-center gap-1 mt-1">
                            <Key size={12} />
                            {p.vouchers[0]}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="w-full max-w-[140px]">
                        <div className="flex justify-between text-[10px] font-black text-slate-500 mb-2">
                          <span>{p.licencasUsadas} USADAS</span>
                          <span>{p.totalLicencas} TOTAL</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-1000 ${
                              (p.licencasUsadas / p.totalLicencas) > 0.9 ? 'bg-amber-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${(p.licencasUsadas / p.totalLicencas) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="font-black text-slate-700">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valorMensal)}
                      </div>
                      <div className="text-xs text-slate-400 font-bold flex items-center gap-1 mt-1 uppercase">
                        <Calendar size={12} />
                        {p.dataExpiracao}
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase border border-emerald-100">
                        {p.status}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-3 hover:bg-blue-50 hover:text-blue-600 rounded-xl text-slate-400 transition-all" title="Gerenciar Vouchers">
                          <Key size={18} />
                        </button>
                        <button className="p-3 hover:bg-slate-100 rounded-xl text-slate-400 transition-all">
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="p-6 bg-slate-50/30 border-t border-slate-50 flex justify-center items-center">
            <button className="text-slate-400 hover:text-blue-600 font-black text-[11px] uppercase tracking-widest flex items-center gap-2 transition-all">
              Ver Todos os Parceiros
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
