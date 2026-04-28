import { useEffect, useState } from 'react';
import { 
  Users, 
  Plus, 
  Key, 
  Calendar, 
  BarChart3, 
  Search, 
  ChevronRight, 
  ShieldCheck, 
  Zap, 
  TrendingUp, 
  MoreHorizontal,
  X,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface Patrocinador {
  id: string;
  nome: string;
  slug: string;
  status: string;
  total_licencas: number;
  valor_mensal: number;
  data_expiracao: string | null;
  created_at: string;
  licencas_usadas?: number;
  vouchers?: { codigo: string }[];
}

export default function PatrocinadoresPage() {
  const supabase = createSupabaseBrowser();
  const [patrocinadores, setPatrocinadores] = useState<Patrocinador[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Estados do formulário
  const [formData, setFormData] = useState({
    nome: '',
    total_licencas: 20,
    valor_mensal: ''
  });

  useEffect(() => {
    fetchPatrocinadores();
  }, []);

  async function fetchPatrocinadores() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('patrocinadores')
        .select(`
          *,
          vouchers (codigo, usado_por_vidracaria_id)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const processed = data?.map(p => ({
        ...p,
        licencas_usadas: p.vouchers?.filter((v: any) => v.usado_por_vidracaria_id).length || 0
      }));

      setPatrocinadores(processed || []);
    } catch (err) {
      console.error('Erro ao buscar patrocinadores:', err);
    } finally {
      setLoading(false);
    }
  }

  const generateVoucherCode = (nome: string) => {
    const prefix = nome.substring(0, 4).toUpperCase().replace(/\s/g, '');
    const random = Math.floor(1000 + Math.random() * 9000);
    const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
    return `791-${prefix}-${random}-${suffix}`;
  };

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const slug = formData.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
      
      // 1. Criar o patrocinador
      const { data: sponsor, error: sError } = await supabase
        .from('patrocinadores')
        .insert([{
          nome: formData.nome,
          slug,
          total_licencas: formData.total_licencas,
          valor_mensal: parseFloat(formData.valor_mensal) || 0,
          status: 'ativo'
        }])
        .select()
        .single();

      if (sError) throw sError;

      // 2. Gerar o primeiro voucher automático
      const voucherCode = generateVoucherCode(formData.nome);
      const { error: vError } = await supabase
        .from('vouchers')
        .insert([{
          codigo: voucherCode,
          patrocinador_id: sponsor.id
        }]);

      if (vError) throw vError;

      alert(`✅ Patrocinador criado com sucesso!\nToken Gerado: ${voucherCode}`);
      setIsModalOpen(false);
      setFormData({ nome: '', total_licencas: 20, valor_mensal: '' });
      fetchPatrocinadores();
    } catch (err) {
      console.error('Erro ao salvar:', err);
      alert('Erro ao salvar patrocinador. Verifique se o nome já existe.');
    } finally {
      setSaving(false);
    }
  }

  const filteredPatrocinadores = patrocinadores.filter(p => 
    p.nome.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-blue-200"
          >
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
              {patrocinadores.reduce((acc, p) => acc + (p.licencas_usadas || 0), 0)}
              <span className="text-slate-300 text-lg ml-2 font-medium">
                / {patrocinadores.reduce((acc, p) => acc + p.total_licencas, 0)}
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
                patrocinadores.reduce((acc, p) => acc + p.valor_mensal, 0)
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
            <button 
              onClick={fetchPatrocinadores}
              className="p-3 hover:bg-white rounded-lg text-slate-400 transition-all"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <BarChart3 size={20} />}
            </button>
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
                {filteredPatrocinadores.map((p) => (
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
                            {p.vouchers?.[0]?.codigo || 'Nenhum Voucher'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="w-full max-w-[140px]">
                        <div className="flex justify-between text-[10px] font-black text-slate-500 mb-2">
                          <span>{p.licencas_usadas || 0} USADAS</span>
                          <span>{p.total_licencas} TOTAL</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-1000 ${
                              ((p.licencas_usadas || 0) / p.total_licencas) > 0.9 ? 'bg-amber-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${((p.licencas_usadas || 0) / p.total_licencas) * 100}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="font-black text-slate-700">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valor_mensal)}
                      </div>
                      <div className="text-xs text-slate-400 font-bold flex items-center gap-1 mt-1 uppercase">
                        <Calendar size={12} />
                        {p.data_expiracao || 'Indeterminado'}
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
        </div>
      </div>

      {/* Modal de Cadastro */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="bg-[#1e293b] p-6 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black flex items-center gap-2">
                  <ShieldCheck className="text-blue-400" />
                  Novo Patrocinador
                </h3>
                <p className="text-slate-400 text-xs font-medium">Cadastre um parceiro e gere vouchers em lote.</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Nome da Empresa</label>
                <input 
                  required
                  type="text" 
                  placeholder="Ex: All Kit Sacadas"
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  value={formData.nome}
                  onChange={(e) => setFormData({...formData, nome: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Qtd Licenças</label>
                  <input 
                    required
                    type="number" 
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    value={formData.total_licencas}
                    onChange={(e) => setFormData({...formData, total_licencas: parseInt(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Valor Mensal</label>
                  <input 
                    required
                    type="number" 
                    placeholder="R$ 5.000,00"
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    value={formData.valor_mensal}
                    onChange={(e) => setFormData({...formData, valor_mensal: e.target.value})}
                  />
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-2xl flex gap-3 items-start border border-blue-100">
                <CheckCircle2 className="text-blue-600 shrink-0" size={20} />
                <p className="text-[11px] text-blue-800 font-medium leading-relaxed">
                  Ao salvar, o sistema irá gerar automaticamente o primeiro voucher de ativação para este patrocinador.
                </p>
              </div>

              <button 
                type="submit"
                disabled={saving}
                className="w-full bg-[#1e293b] hover:bg-slate-800 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
              >
                {saving ? <Loader2 className="animate-spin" /> : <Plus size={18} />}
                {saving ? 'Salvando...' : 'Salvar e Gerar Voucher'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
