"use client";

import { useEffect, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { 
  Ticket, 
  Plus, 
  Calendar, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Tag, 
  Percent, 
  DollarSign,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface Coupon {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  saas_target: string;
  expires_at: string | null;
  active: boolean;
  once_per_client: boolean;
  max_uses: number | null;
  used_count: number;
  created_at: string;
}

export default function CuponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const supabase = createSupabaseBrowser();

  // Estado do formulário de novo cupom
  const [newCoupon, setNewCoupon] = useState({
    code: '',
    type: 'percentage' as 'percentage' | 'fixed',
    value: '',
    saas_target: 'all',
    expires_at: '',
    max_uses: '',
    once_per_client: true
  });

  const fetchCoupons = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCoupons(data || []);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const handleAddCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.from('coupons').insert([{
        code: newCoupon.code.toUpperCase(),
        type: newCoupon.type,
        value: Number(newCoupon.value),
        saas_target: newCoupon.saas_target,
        expires_at: newCoupon.expires_at || null,
        max_uses: newCoupon.max_uses ? Number(newCoupon.max_uses) : null,
        once_per_client: newCoupon.once_per_client
      }]);

      if (error) throw error;
      
      setShowAddModal(false);
      setNewCoupon({
        code: '',
        type: 'percentage',
        value: '',
        saas_target: 'all',
        expires_at: '',
        max_uses: '',
        once_per_client: true
      });
      fetchCoupons();
    } catch (err: any) {
      alert(`Erro ao criar cupom: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleCouponStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('coupons')
        .update({ active: !currentStatus })
        .eq('id', id);

      if (error) throw error;
      fetchCoupons();
    } catch (err: any) {
      alert(`Erro ao atualizar cupom: ${err.message}`);
    }
  };

  const deleteCoupon = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este cupom?')) return;
    try {
      const { error } = await supabase
        .from('coupons')
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchCoupons();
    } catch (err: any) {
      alert(`Erro ao excluir cupom: ${err.message}`);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 animate-in fade-in duration-500 pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Ticket className="text-[#3b597b]" size={24} />
            Gestão de Cupons
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Crie e gerencie códigos de desconto para o 791glass e 791barber.
          </p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-[#3b597b] hover:bg-[#2e4763] text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus size={18} /> CRIAR NOVO CUPOM
        </button>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{errorMsg}</p>
        </div>
      )}

      {/* Grid de Cupons */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <Loader2 size={40} className="animate-spin text-[#3b597b]" />
          <p className="font-medium">Buscando cupons ativos...</p>
        </div>
      ) : coupons.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
            <Ticket size={32} />
          </div>
          <h3 className="text-lg font-bold text-slate-800">Nenhum cupom encontrado</h3>
          <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">
            Comece criando o seu primeiro código de desconto para atrair novos assinantes.
          </p>
          <button 
            onClick={() => setShowAddModal(true)}
            className="mt-6 text-[#3b597b] font-bold text-sm hover:underline"
          >
            Criar cupom agora →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {coupons.map((coupon) => (
            <div 
              key={coupon.id} 
              className={`bg-white rounded-2xl border-2 transition-all overflow-hidden ${coupon.active ? 'border-slate-100 shadow-sm hover:border-[#3b597b]/30' : 'border-slate-50 opacity-75 grayscale-[0.5]'}`}
            >
              {/* Topo do Card */}
              <div className="p-5 border-b border-slate-50">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2 px-2 py-1 bg-slate-100 rounded text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <Tag size={10} /> {coupon.saas_target === 'all' ? 'Holding' : coupon.saas_target}
                  </div>
                  <button 
                    onClick={() => toggleCouponStatus(coupon.id, coupon.active)}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 transition-colors ${coupon.active ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  >
                    {coupon.active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                    {coupon.active ? 'ATIVO' : 'PAUSADO'}
                  </button>
                </div>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xl font-black text-slate-900 tracking-tighter">{coupon.code}</h3>
                  <span className="text-xs font-bold text-[#3b597b] bg-[#3b597b]/5 px-2 py-0.5 rounded">
                    {coupon.type === 'percentage' ? `${coupon.value}% OFF` : `R$ ${coupon.value} OFF`}
                  </span>
                </div>
                {coupon.once_per_client && (
                  <div className="mt-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> USO ÚNICO POR CLIENTE
                  </div>
                )}
              </div>

              {/* Detalhes */}
              <div className="p-5 space-y-4 bg-slate-50/30">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Usos</span>
                    <p className="text-sm font-bold text-slate-700">
                      {coupon.used_count} / {coupon.max_uses || '∞'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Expira em</span>
                    <p className="text-sm font-bold text-slate-700 flex items-center gap-1">
                      <Clock size={12} className="text-slate-400" />
                      {coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString('pt-BR') : 'Sem expiração'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-medium text-slate-400">Criado em {new Date(coupon.created_at).toLocaleDateString('pt-BR')}</span>
                  <button 
                    onClick={() => deleteCoupon(coupon.id)}
                    className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Adicionar Cupom */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Plus className="text-[#3b597b]" size={20} />
                NOVO CUPOM DE DESCONTO
              </h3>
            </div>
            
            <form onSubmit={handleAddCoupon} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Código do Cupom</label>
                <input 
                  type="text" 
                  required
                  placeholder="EX: VIDRO2026"
                  value={newCoupon.code}
                  onChange={(e) => setNewCoupon({...newCoupon, code: e.target.value.toUpperCase()})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm font-black tracking-widest focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Tipo</label>
                  <select 
                    value={newCoupon.type}
                    onChange={(e) => setNewCoupon({...newCoupon, type: e.target.value as any})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                  >
                    <option value="percentage">Porcentagem (%)</option>
                    <option value="fixed">Valor Fixo (R$)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Valor</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3.5 text-slate-400">
                      {newCoupon.type === 'percentage' ? <Percent size={14} /> : <DollarSign size={14} />}
                    </span>
                    <input 
                      type="number" 
                      required
                      placeholder="0"
                      value={newCoupon.value}
                      onChange={(e) => setNewCoupon({...newCoupon, value: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 h-[44px] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Target (SaaS)</label>
                  <select 
                    value={newCoupon.saas_target}
                    onChange={(e) => setNewCoupon({...newCoupon, saas_target: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                  >
                    <option value="all">Todos</option>
                    <option value="791glass">791glass</option>
                    <option value="791barber">791barber</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Limite de Usos</label>
                  <input 
                    type="number" 
                    placeholder="∞"
                    value={newCoupon.max_uses}
                    onChange={(e) => setNewCoupon({...newCoupon, max_uses: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Data de Expiração</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <Calendar size={14} />
                  </span>
                  <input 
                    type="date" 
                    value={newCoupon.expires_at}
                    onChange={(e) => setNewCoupon({...newCoupon, expires_at: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 h-[44px] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="once_per_client"
                  checked={newCoupon.once_per_client}
                  onChange={(e) => setNewCoupon({...newCoupon, once_per_client: e.target.checked})}
                  className="w-4 h-4 text-[#3b597b] border-slate-300 rounded focus:ring-[#3b597b]"
                />
                <label htmlFor="once_per_client" className="text-xs font-bold text-slate-600 uppercase tracking-wide cursor-pointer">Uso único por cliente (Vidraçaria)</label>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-[48px] border border-slate-200 rounded-lg text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  CANCELAR
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="flex-[2] h-[48px] bg-[#3b597b] hover:bg-[#2e4763] text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : 'GERAR CUPOM'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
