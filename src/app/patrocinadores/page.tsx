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
  ciclo: string;
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
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [currentVidracarias, setCurrentVidracarias] = useState<any[]>([]);
  const [currentTemplates, setCurrentTemplates] = useState<any[]>([]);

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
    valor_mensal: '',
    ciclo: 'MONTHLY'
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
      
      // Limpa o valor monetário (ex: "5.000,00" -> 5000.00)
      const cleanValor = typeof formData.valor_mensal === 'string' 
        ? parseFloat(formData.valor_mensal.replace(/\./g, '').replace(',', '.')) 
        : formData.valor_mensal;

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
        valor_mensal: cleanValor || 0,
        // ciclo: formData.ciclo // Comentado até a coluna ser criada no DB
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

        // Gerar o primeiro voucher automático
        const voucherCode = generateVoucherCode(formData.nome);
        await supabase
          .from('vouchers')
          .insert([{
            codigo: voucherCode,
            patrocinador_id: sponsor.id
          }]);

        // 🚀 DISPARAR COBRANÇA ASAAS AUTOMATICAMENTE
        try {
          const chargeRes = await fetch('/api/payments/asaas/create-sponsor-charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patrocinadorId: sponsor.id,
              nome: formData.nome,
              email: formData.email,
              cpfCnpj: formData.cpf_cnpj.replace(/\D/g, ''),
              telefone: formData.telefone.replace(/\D/g, ''),
              valor: payload.valor_mensal,
              description: `Adesão Patrocínio 791glass - ${formData.nome}`,
              ciclo: formData.ciclo,
              address: formData.endereco,
              addressNumber: formData.numero,
              province: formData.bairro,
              postalCode: formData.cep.replace(/\D/g, ''),
              city: formData.cidade,
              state: formData.estado
            })
          });
          const chargeData = await chargeRes.json();
          
          if (chargeData.success) {
            alert(`✅ Patrocinador criado!\n\nToken: ${voucherCode}\n\nLink de Pagamento Gerado: ${chargeData.invoiceUrl}`);
            window.open(chargeData.invoiceUrl, '_blank');
          } else {
            alert(`✅ Patrocinador criado, mas houve um erro no Asaas: ${chargeData.error}`);
          }
        } catch (asaasErr) {
          console.error('Erro Asaas:', asaasErr);
          alert('✅ Patrocinador criado, mas falhou ao gerar link no Asaas.');
        }
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
        valor_mensal: '',
        ciclo: 'MONTHLY'
      });
      fetchPatrocinadores();
    } catch (err: any) {
      console.error('Erro ao salvar:', err);
      const errorMsg = err.message || 'Erro desconhecido';
      alert(`❌ Erro ao salvar patrocinador: ${errorMsg}\n\nVerifique se o nome já existe ou se há campos inválidos.`);
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateVoucher(sponsorId: string, nome: string) {
    if (!confirm(`Deseja gerar um novo Voucher para ${nome}?`)) return;
    
    try {
      const voucherCode = generateVoucherCode(nome);
      const { error } = await supabase
        .from('vouchers')
        .insert([{
          codigo: voucherCode,
          patrocinador_id: sponsorId
        }]);

      if (error) throw error;
      alert(`✅ Voucher ${voucherCode} gerado com sucesso!`);
      fetchPatrocinadores();
    } catch (err: any) {
      alert(`Erro ao gerar voucher: ${err.message}`);
    }
  }

  // Funções de Máscara
  const maskCpfCnpj = (v: string) => {
    v = v.replace(/\D/g, "");
    if (v.length <= 11) {
      v = v.replace(/(\d{3})(\d)/, "$1.$2");
      v = v.replace(/(\d{3})(\d)/, "$1.$2");
      v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    } else {
      v = v.replace(/^(\d{2})(\d)/, "$1.$2");
      v = v.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
      v = v.replace(/\.(\d{3})(\d)/, ".$1/$2");
      v = v.replace(/(\d{4})(\d)/, "$1-$2");
    }
    return v.substring(0, 18);
  };

  const maskPhone = (v: string) => {
    v = v.replace(/\D/g, "");
    v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
    v = v.replace(/(\d)(\d{4})$/, "$1-$2");
    return v.substring(0, 15);
  };

  const maskCep = (v: string) => {
    v = v.replace(/\D/g, "");
    v = v.replace(/^(\d{5})(\d)/, "$1-$2");
    return v.substring(0, 9);
  };

  const maskCurrency = (v: string) => {
    v = v.replace(/\D/g, "");
    v = (Number(v) / 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
    });
    return v;
  };

  // Busca de CEP
  const handleCepBlur = async (cep: string) => {
    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length === 8) {
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await response.json();
        if (!data.erro) {
          setFormData(prev => ({
            ...prev,
            endereco: data.logradouro,
            bairro: data.bairro,
            cidade: data.localidade,
            estado: data.uf
          }));
        }
      } catch (error) {
        console.error("Erro ao buscar CEP:", error);
      }
    }
  };

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
      valor_mensal: maskCurrency(p.valor_mensal.toFixed(2).replace('.', '')),
      ciclo: p.ciclo || 'MONTHLY'
    });
    setIsModalOpen(true);
    fetchExtraDetails(p.id);
  }

  async function fetchExtraDetails(id: string) {
    setLoadingDetails(true);
    setCurrentVidracarias([]);
    setCurrentTemplates([]);
    try {
      const res = await fetch(`/api/sponsors/${id}/details`);
      const data = await res.json();
      if (data.success) {
        setCurrentVidracarias(data.vidracarias);
        setCurrentTemplates(data.templates);
      }
    } catch (err) {
      console.error('Erro detalhes extras:', err);
    } finally {
      setLoadingDetails(false);
    }
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
          ciclo: p.ciclo,
          parcelas: 12,
          address: p.endereco,
          addressNumber: p.numero,
          province: p.bairro,
          postalCode: p.cep,
          city: p.cidade,
          state: p.estado
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
                        <button 
                          onClick={() => handleGenerateVoucher(p.id, p.nome)}
                          className="p-3 hover:bg-blue-50 hover:text-blue-600 rounded-xl text-slate-400 transition-all" 
                          title="Gerar Novo Voucher"
                        >
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

      {/* Modal 360º Compact Dashboard */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => { setIsModalOpen(false); setEditingSponsor(null); }} />
          <div className="relative bg-[#f8fafc] w-full max-w-7xl h-full max-h-[92vh] rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 flex flex-col border border-slate-200">
            
            {/* Header Compacto */}
            <div className="bg-[#1e293b] px-6 py-4 text-white flex items-center justify-between shrink-0 z-20">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center border border-blue-400/20">
                  <ShieldCheck className="text-blue-400" size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-black tracking-tight">
                    {editingSponsor ? 'Configurações do Patrocinador' : 'Novo Parceiro'}
                  </h3>
                  <p className="text-slate-400 text-[10px] font-medium">
                    {editingSponsor ? `Monitorando ${editingSponsor.nome}` : 'Defina cotas e licenciamento.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {editingSponsor && (
                  <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-[9px] font-black uppercase tracking-widest">Ativo</span>
                )}
                <button onClick={() => { setIsModalOpen(false); setEditingSponsor(null); }} className="p-2 hover:bg-white/10 rounded-lg transition-all text-slate-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Conteúdo em Grid */}
            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
              
              {/* COLUNA 1: Formulário Compacto */}
              <div className="flex-[1.2] overflow-y-auto p-6 border-r border-slate-200 bg-white">
                <form onSubmit={handleSave} className="space-y-6">
                  <section>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <div className="w-4 h-0.5 bg-blue-500" /> Identificação
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Nome Fantasia</label>
                        <input 
                          required
                          type="text" 
                          className="w-full px-4 py-2 rounded-xl border border-slate-100 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all font-bold text-slate-700 text-sm outline-none"
                          value={formData.nome}
                          onChange={(e) => setFormData({...formData, nome: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Razão Social</label>
                        <input 
                          required
                          type="text" 
                          className="w-full px-4 py-2 rounded-xl border border-slate-100 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all font-bold text-slate-700 text-sm outline-none"
                          value={formData.razao_social}
                          onChange={(e) => setFormData({...formData, razao_social: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Responsável</label>
                        <input 
                          required
                          type="text" 
                          className="w-full px-4 py-2 rounded-xl border border-slate-100 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all font-bold text-slate-700 text-sm outline-none"
                          value={formData.nome_responsavel}
                          onChange={(e) => setFormData({...formData, nome_responsavel: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">CNPJ / CPF</label>
                        <input 
                          required
                          type="text" 
                          className="w-full px-4 py-2 rounded-xl border border-slate-100 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all font-bold text-slate-700 text-sm outline-none"
                          value={formData.cpf_cnpj}
                          onChange={(e) => setFormData({...formData, cpf_cnpj: maskCpfCnpj(e.target.value)})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Telefone</label>
                        <input 
                          required
                          type="text" 
                          className="w-full px-4 py-2 rounded-xl border border-slate-100 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all font-bold text-slate-700 text-sm outline-none"
                          value={formData.telefone}
                          onChange={(e) => setFormData({...formData, telefone: maskPhone(e.target.value)})}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Localização & Cobrança</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">CEP</label>
                        <input 
                          type="text" 
                          placeholder="00000-000"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/10 outline-none text-xs font-bold text-blue-600"
                          value={formData.cep}
                          onChange={(e) => setFormData({...formData, cep: maskCep(e.target.value)})}
                          onBlur={(e) => handleCepBlur(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-3 space-y-1">
                        <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">RUA / LOGRADOURO</label>
                        <input 
                          type="text" 
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/10 outline-none text-xs font-medium"
                          value={formData.endereco}
                          onChange={(e) => setFormData({...formData, endereco: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">Nº</label>
                        <input 
                          type="text" 
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/10 outline-none text-xs font-medium"
                          value={formData.numero}
                          onChange={(e) => setFormData({...formData, numero: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">BAIRRO</label>
                        <input 
                          type="text" 
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/10 outline-none text-xs font-medium"
                          value={formData.bairro}
                          onChange={(e) => setFormData({...formData, bairro: e.target.value})}
                        />
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">CIDADE / UF</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/10 outline-none text-xs font-medium"
                            value={formData.cidade}
                            onChange={(e) => setFormData({...formData, cidade: e.target.value})}
                          />
                          <input 
                            type="text" 
                            maxLength={2}
                            className="w-10 px-1 py-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/10 outline-none font-bold text-center text-xs"
                            value={formData.estado}
                            onChange={(e) => setFormData({...formData, estado: e.target.value.toUpperCase()})}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-200">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-blue-600 ml-1 uppercase">Cota de Licenças</label>
                        <div className="relative">
                          <input 
                            required
                            type="number" 
                            className="w-full px-4 py-2.5 rounded-xl border-2 border-blue-50 bg-white focus:border-blue-500 transition-all font-black text-blue-700 outline-none text-sm"
                            value={formData.total_licencas}
                            onChange={(e) => setFormData({...formData, total_licencas: parseInt(e.target.value)})}
                          />
                          <Users className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-200" size={16} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-emerald-600 ml-1 uppercase">Valor do Ciclo (R$)</label>
                        <div className="relative">
                          <input 
                            required
                            type="text" 
                            className="w-full px-4 py-2.5 rounded-xl border-2 border-emerald-50 bg-white focus:border-emerald-500 transition-all font-black text-emerald-700 outline-none text-sm"
                            placeholder="0,00"
                            value={formData.valor_mensal}
                            onChange={(e) => setFormData({...formData, valor_mensal: maskCurrency(e.target.value)})}
                          />
                          <DollarSign className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-200" size={16} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-600 ml-1 uppercase">Ciclo de Cobrança</label>
                        <div className="relative">
                          <select 
                            className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-50 bg-white focus:border-blue-500 transition-all font-black text-slate-700 outline-none text-sm appearance-none"
                            value={formData.ciclo}
                            onChange={(e) => setFormData({...formData, ciclo: e.target.value})}
                          >
                            <option value="MONTHLY">MENSAL</option>
                            <option value="QUARTERLY">TRIMESTRAL</option>
                            <option value="SEMI_ANNUAL">SEMESTRAL</option>
                            <option value="YEARLY">ANUAL</option>
                          </select>
                          <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-200 pointer-events-none" size={16} />
                        </div>
                      </div>
                    </div>
                  </section>

                  <button 
                    type="submit"
                    disabled={saving}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-100 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="animate-spin" size={18} /> : (editingSponsor ? <Pencil size={18} /> : <Plus size={18} />)}
                    {saving ? 'SALVANDO...' : (editingSponsor ? 'Confirmar Alterações' : 'Salvar e Iniciar Parceria')}
                  </button>
                </form>
              </div>

              {/* COLUNA 2: Inteligência Compacta (Sidebar) */}
              {editingSponsor ? (
                <div className="flex-1 bg-slate-50 p-6 overflow-y-auto space-y-8">
                  
                  {/* Vidraçarias - Estilo Excel */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-slate-800">
                        <Users size={14} className="text-blue-500" />
                        <h5 className="font-black text-xs uppercase tracking-tight">Vidraçarias Parceiras</h5>
                      </div>
                      <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                        {loadingDetails ? '...' : currentVidracarias.length}
                      </span>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Loja / Unidade</th>
                            <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Faturamento</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {loadingDetails ? (
                            <tr>
                              <td colSpan={2} className="p-8 text-center"><Loader2 className="animate-spin mx-auto text-blue-400" size={20} /></td>
                            </tr>
                          ) : currentVidracarias.length > 0 ? (
                            currentVidracarias.map((v: any) => (
                              <tr key={v.id} className="hover:bg-blue-50/30 transition-colors group">
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    <span className="text-[11px] font-bold text-slate-700">{v.nome}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  <span className="text-[11px] font-black text-slate-600">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v.valor_plano || 0)}
                                  </span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className="p-4 text-center text-[10px] text-slate-400 italic">Nenhuma loja vinculada.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Templates - Estilo Excel */}
                  <div className="pt-6 border-t border-slate-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-slate-800">
                        <BarChart3 size={14} className="text-amber-500" />
                        <h5 className="font-black text-xs uppercase tracking-tight">Templates de Projeto</h5>
                      </div>
                      <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                        {loadingDetails ? '...' : currentTemplates.length}
                      </span>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <div className="max-h-[200px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <tbody className="divide-y divide-slate-100">
                            {loadingDetails ? (
                              <tr><td className="p-4"><Loader2 className="animate-spin mx-auto text-amber-400" size={16} /></td></tr>
                            ) : currentTemplates.length > 0 ? (
                              currentTemplates.map((t: any) => (
                                <tr key={t.id} className="hover:bg-amber-50/30 transition-colors group">
                                  <td className="px-3 py-1.5 flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-600">{t.nome}</span>
                                    <ChevronRight size={12} className="text-slate-300 group-hover:text-amber-500 transition-colors" />
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr><td className="p-4 text-center text-[10px] text-slate-400 italic">Nenhum modelo.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center p-10 text-center">
                  <Zap size={32} className="text-slate-200 mb-4" />
                  <p className="text-slate-400 text-xs font-bold">Selecione um patrocinador para ver detalhes.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
