'use client';

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
  CheckCircle2,
  CreditCard,
  DollarSign,
  Pencil,
  Trash2
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
  email: string;
  cpf_cnpj: string;
  telefone: string;
  nome_responsavel: string;
  razao_social: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  licencas_usadas?: number;
  vouchers?: { codigo: string }[];
  vidracarias?: any[];
  projeto_templates?: any[];
}

export default function PatrocinadoresPage() {
  const supabase = createSupabaseBrowser();
  const [patrocinadores, setPatrocinadores] = useState<Patrocinador[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chargingId, setChargingId] = useState<string | null>(null);

  // Estados do formulário
  const [formData, setFormData] = useState({
    nome: '',
    razao_social: '',
    email: '',
    cpf_cnpj: '',
    telefone: '',
    nome_responsavel: '',
    endereco: '',
    numero: '',
    bairro: '',
    cidade: '',
    estado: '',
    cep: '',
    total_licencas: 20,
    valor_mensal: ''
  });
  const [editingSponsor, setEditingSponsor] = useState<Patrocinador | null>(null);

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
          vouchers (codigo, usado_por_vidracaria_id),
          vidracarias (*),
          projeto_templates (id, nome)
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
      
      const payload = {
        nome: formData.nome,
        razao_social: formData.razao_social,
        email: formData.email,
        cpf_cnpj: formData.cpf_cnpj.replace(/\D/g, ''),
        telefone: formData.telefone.replace(/\D/g, ''),
        nome_responsavel: formData.nome_responsavel,
        endereco: formData.endereco,
        numero: formData.numero,
        bairro: formData.bairro,
        cidade: formData.cidade,
        estado: formData.estado,
        cep: formData.cep.replace(/\D/g, ''),
        total_licencas: formData.total_licencas,
        valor_mensal: parseFloat(formData.valor_mensal) || 0,
      };

      if (editingSponsor) {
        // ATUALIZAR PATROCINADOR EXISTENTE
        const { error: uError } = await supabase
          .from('patrocinadores')
          .update(payload)
          .eq('id', editingSponsor.id);

        if (uError) throw uError;
        alert('✅ Patrocinador atualizado com sucesso!');
      } else {
        // CRIAR NOVO PATROCINADOR
        const { data: sponsor, error: sError } = await supabase
          .from('patrocinadores')
          .insert([{ ...payload, slug, status: 'ativo' }])
          .select()
          .single();

        if (sError) throw sError;

        // Gerar o primeiro voucher automático apenas para novos
        const voucherCode = generateVoucherCode(formData.nome);
        const { error: vError } = await supabase
          .from('vouchers')
          .insert([{
            codigo: voucherCode,
            patrocinador_id: sponsor.id
          }]);

        if (vError) throw vError;
        alert(`✅ Patrocinador criado com sucesso!\nToken Gerado: ${voucherCode}`);
      }

      setIsModalOpen(false);
      setEditingSponsor(null);
      setFormData({ 
        nome: '', 
        razao_social: '',
        email: '', 
        cpf_cnpj: '', 
        telefone: '', 
        nome_responsavel: '',
        endereco: '',
        numero: '',
        bairro: '',
        cidade: '',
        estado: '',
        cep: '',
        total_licencas: 20, 
        valor_mensal: '' 
      });
      fetchPatrocinadores();
    } catch (err) {
      console.error('Erro ao salvar:', err);
      alert('Erro ao salvar patrocinador. Verifique os campos e se o nome já existe.');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(p: Patrocinador) {
    setEditingSponsor(p);
    setFormData({
      nome: p.nome,
      razao_social: p.razao_social || '',
      email: p.email || '',
      cpf_cnpj: p.cpf_cnpj || '',
      telefone: p.telefone || '',
      nome_responsavel: p.nome_responsavel || '',
      endereco: p.endereco || '',
      numero: p.numero || '',
      bairro: p.bairro || '',
      cidade: p.cidade || '',
      estado: p.estado || '',
      cep: p.cep || '',
      total_licencas: p.total_licencas,
      valor_mensal: p.valor_mensal.toString()
    });
    setIsModalOpen(true);
  }

  async function handleCreateCharge(p: Patrocinador) {
    if (!p.valor_mensal || p.valor_mensal <= 0) {
      alert('Defina um valor mensal para este patrocinador antes de gerar a cobrança.');
      return;
    }

    setChargingId(p.id);
    try {
      const response = await fetch('/api/payments/asaas/create-sponsor-charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patrocinadorId: p.id,
          nome: p.nome,
          email: p.email,
          cpfCnpj: p.cpf_cnpj,
          telefone: p.telefone,
          valor: p.valor_mensal,
          description: `Patrocínio 791glass - ${p.nome}`,
          parcelas: 12
        })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      // Abre o link em uma nova aba
      window.open(data.invoiceUrl, '_blank');
    } catch (err: any) {
      console.error('Erro ao gerar cobrança:', err);
      alert('Erro ao gerar cobrança: ' + err.message);
    } finally {
      setChargingId(null);
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
                        <button 
                          onClick={() => handleCreateCharge(p)}
                          disabled={chargingId === p.id}
                          className="p-3 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl text-slate-400 transition-all" 
                          title="Gerar Cobrança Asaas"
                        >
                          {chargingId === p.id ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                        </button>
                        <button 
                          onClick={() => handleEdit(p)}
                          className="p-3 hover:bg-blue-50 hover:text-blue-600 rounded-xl text-slate-400 transition-all" 
                          title="Editar Patrocinador"
                        >
                          <Pencil size={18} />
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

      {/* Modal 360º */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setIsModalOpen(false); setEditingSponsor(null); }} />
          <div className="relative bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 flex flex-col md:flex-row max-h-[95vh]">
            
            {/* Esquerda: Formulário */}
            <div className="flex-1 overflow-y-auto">
              <div className="bg-[#1e293b] p-6 text-white flex items-center justify-between sticky top-0 z-10">
                <div>
                  <h3 className="text-xl font-black flex items-center gap-2">
                    <ShieldCheck className="text-blue-400" />
                    {editingSponsor ? 'Editar Patrocinador' : 'Novo Patrocinador'}
                  </h3>
                  <p className="text-slate-400 text-xs font-medium">
                    {editingSponsor ? `Editando ${editingSponsor.nome}` : 'Cadastre um parceiro e gere licenciamento.'}
                  </p>
                </div>
                <button onClick={() => { setIsModalOpen(false); setEditingSponsor(null); }} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-8 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Patrocinador (Fantasia)</label>
                    <input 
                      required
                      type="text" 
                      placeholder="Ex: All Kit Sacadas"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.nome}
                      onChange={(e) => setFormData({...formData, nome: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Razão Social</label>
                    <input 
                      required
                      type="text" 
                      placeholder="Ex: Industria de Vidros LTDA"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.razao_social}
                      onChange={(e) => setFormData({...formData, razao_social: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Nome do Responsável</label>
                    <input 
                      required
                      type="text" 
                      placeholder="Ex: João da Silva"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.nome_responsavel}
                      onChange={(e) => setFormData({...formData, nome_responsavel: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">CPF ou CNPJ</label>
                    <input 
                      required
                      type="text" 
                      placeholder="00.000.000/0000-00"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.cpf_cnpj}
                      onChange={(e) => setFormData({...formData, cpf_cnpj: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">E-mail Financeiro</label>
                    <input 
                      required
                      type="email" 
                      placeholder="financeiro@empresa.com"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Telefone de Contato</label>
                    <input 
                      required
                      type="text" 
                      placeholder="(11) 99999-9999"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.telefone}
                      onChange={(e) => setFormData({...formData, telefone: e.target.value})}
                    />
                  </div>
                </div>

                <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Calendar size={14} /> Endereço de Cobrança
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="md:col-span-2">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Rua / Logradouro</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                        value={formData.endereco}
                        onChange={(e) => setFormData({...formData, endereco: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Número</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                        value={formData.numero}
                        onChange={(e) => setFormData({...formData, numero: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Bairro</label>
                      <input 
                        type="text" 
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                        value={formData.bairro}
                        onChange={(e) => setFormData({...formData, bairro: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Cidade / UF</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="Cidade"
                          className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                          value={formData.cidade}
                          onChange={(e) => setFormData({...formData, cidade: e.target.value})}
                        />
                        <input 
                          type="text" 
                          placeholder="UF"
                          maxLength={2}
                          className="w-12 px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-blue-500 transition-all text-sm uppercase text-center font-bold"
                          value={formData.estado}
                          onChange={(e) => setFormData({...formData, estado: e.target.value.toUpperCase()})}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">CEP</label>
                      <input 
                        type="text" 
                        placeholder="00000-000"
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                        value={formData.cep}
                        onChange={(e) => setFormData({...formData, cep: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Qtd Licenças do Pacote</label>
                    <input 
                      required
                      type="number" 
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                      value={formData.total_licencas}
                      onChange={(e) => setFormData({...formData, total_licencas: parseInt(e.target.value)})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Valor Mensal (Cota)</label>
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

                <button 
                  type="submit"
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-xl shadow-blue-100 mb-8"
                >
                  {saving ? <Loader2 className="animate-spin" /> : (editingSponsor ? <Pencil size={20} /> : <Plus size={20} />)}
                  {saving ? 'Salvando...' : (editingSponsor ? 'Confirmar Alterações' : 'Salvar e Gerar Primeiro Voucher')}
                </button>
              </form>
            </div>

            {/* Direita: Visão de Negócio (Sidebar) */}
            {editingSponsor && (
              <div className="w-full md:w-[400px] bg-slate-50 border-l border-slate-100 p-8 flex flex-col overflow-y-auto max-h-[95vh]">
                <div className="mb-10">
                  <div className="flex items-center justify-between mb-6">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Users size={14} className="text-blue-500" /> Vidraçarias Patrocinadas
                    </p>
                    <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded-md">
                      {editingSponsor.vidracarias?.length || 0}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {editingSponsor.vidracarias && editingSponsor.vidracarias.length > 0 ? (
                      editingSponsor.vidracarias.map((v: any) => (
                        <div key={v.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-200 transition-all">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-bold text-slate-700 text-sm">{v.nome}</p>
                              <p className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">Módulos Extra</p>
                            </div>
                            <span className="text-sm font-black text-emerald-600">
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v.valor_plano || 0)}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="bg-slate-100/50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center">
                        <p className="text-xs text-slate-400 font-medium italic">Nenhuma vidraçaria vinculada.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-6">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <ShieldCheck size={14} className="text-blue-500" /> Modelos Oficiais (Templates)
                    </p>
                    <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-md">
                      {editingSponsor.projeto_templates?.length || 0}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {editingSponsor.projeto_templates && editingSponsor.projeto_templates.length > 0 ? (
                      editingSponsor.projeto_templates.map((t: any) => (
                        <div key={t.id} className="bg-white px-4 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 flex items-center gap-3 hover:bg-slate-50 transition-all">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          {t.nome}
                        </div>
                      ))
                    ) : (
                      <div className="bg-slate-100/50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center">
                        <p className="text-xs text-slate-400 font-medium italic">Nenhum modelo configurado.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
