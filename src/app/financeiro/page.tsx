"use client";

import { useState, useEffect } from 'react';
import { 
  Receipt, 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Plus, 
  Download, 
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Loader2,
  X,
  Save,
  CheckCircle2,
  AlertCircle,
  Tag,
  Building,
  Calendar,
  CreditCard,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface FinanceRecord {
  id: string;
  type: 'revenue' | 'expense';
  value: number;
  description: string;
  payment_method: string;
  category: string;
  status: 'paid' | 'pending';
  bank_account_id?: string;
  created_at: string;
  is_recurring: boolean;
  recurring_period?: string;
  payment_link?: string;
}

interface BankAccount {
  id: string;
  name: string;
  bank_name: string;
}

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  type: 'revenue' | 'expense';
}

export default function FinanceiroPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [stats, setStats] = useState({
    revenue: 0,
    expenses: 0,
    balance: 0
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedParentCategory, setSelectedParentCategory] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'revenue' | 'expense'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [newRecord, setNewRecord] = useState({
    type: 'expense' as 'revenue' | 'expense',
    description: '',
    value: '',
    category: 'Geral',
    payment_method: 'Pix',
    bank_account_id: '',
    status: 'paid' as 'paid' | 'pending',
    date: new Date().toISOString().split('T')[0],
    is_recurring: false,
    recurring_period: 'monthly' as 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly',
    generateAsaas: false,
    customerCpfCnpj: ''
  });

  const paymentMethods = [
    'Pix', 'Cartão Crédito', 'Cartão Débito', 'Boleto', 'Dinheiro', 'Transferência'
  ];

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [recordsRes, accountsRes] = await Promise.all([
        supabase.from('system_finance_records').select('*').order('created_at', { ascending: false }),
        supabase.from('system_bank_accounts').select('id, name, bank_name')
      ]);

      if (recordsRes.data) {
        setRecords(recordsRes.data);
        updateStats(recordsRes.data);
      }
      if (accountsRes.data) setBankAccounts(accountsRes.data);

      const catRes = await fetch('/api/system/categories');
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData || []);
      }

    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }

  function updateStats(data: FinanceRecord[]) {
    const rev = data.filter(r => r.type === 'revenue' && r.status === 'paid').reduce((acc, curr) => acc + Number(curr.value), 0);
    const exp = data.filter(r => r.type === 'expense' && r.status === 'paid').reduce((acc, curr) => acc + Number(curr.value), 0);
    setStats({
      revenue: rev,
      expenses: exp,
      balance: rev - exp
    });
  }

  const handleAddCategory = async () => {
    if (!newCategoryName) return;
    try {
      const res = await fetch('/api/system/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCategoryName,
          type: newRecord.type,
          parent_id: selectedParentCategory || null
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro ao criar categoria');
      }

      const data = await res.json();
      setCategories([...categories, data]);
      setNewRecord({ ...newRecord, category: data.name });
      setNewCategoryName('');
      setIsAddingCategory(false);
      setSelectedParentCategory('');
    } catch (err: any) {
      alert('Erro ao criar categoria: ' + err.message);
    }
  };

  const handleSave = async () => {
    if (!newRecord.description || !newRecord.value) return alert('Preencha os campos obrigatórios!');
    
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('system_finance_records')
        .insert([{
          type: newRecord.type,
          description: newRecord.description,
          value: parseFloat(newRecord.value),
          category: newRecord.category,
          payment_method: newRecord.payment_method,
          status: newRecord.status,
          bank_account_id: newRecord.bank_account_id || null,
          created_at: new Date(newRecord.date).toISOString(),
          is_recurring: newRecord.is_recurring,
          recurring_period: newRecord.is_recurring ? newRecord.recurring_period : null
        }]).select();

      if (error) throw error;

      // Se for receita e pediu Asaas, gera a cobrança
      if (newRecord.type === 'revenue' && newRecord.generateAsaas && data?.[0]) {
        const record = data[0];
        try {
          // Busca as chaves do Asaas na API de configuração
          const configRes = await fetch('/api/system/finance-config');
          const configData = await configRes.json();
          
          if (configData?.asaasApiKey) {
            const asaasRes = await fetch('/api/payments/asaas/create-charge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                asaasApiKey: configData.asaasApiKey,
                asaasEnv: configData.asaasEnv,
                value: record.value,
                description: record.description,
                dueDate: record.created_at.split('T')[0],
                customerName: 'Cliente Holding',
                customerEmail: 'financeiro@791solucoes.com.br',
                customerCpfCnpj: newRecord.customerCpfCnpj,
                externalReference: `holding|${record.id}`
              })
            });

            if (asaasRes.ok) {
              const asaasData = await asaasRes.json();
              
              // Atualiza o registro com o link
              const { error: updateError } = await supabase
                .from('system_finance_records')
                .update({ payment_link: asaasData.invoiceUrl })
                .eq('id', record.id);

              if (updateError) {
                alert(`Lançamento salvo, mas erro ao guardar o link: ${updateError.message}`);
              } else {
                alert(`Sucesso! Link Asaas gerado.`);
                fetchData();
              }
            } else {
              const errData = await asaasRes.json();
              alert(`Erro na API do Asaas: ${errData.error}`);
            }
          }
        } catch (e) {
          console.error('Erro ao gerar Asaas:', e);
        }
      }
      
      setIsModalOpen(false);
      setNewRecord({
        type: 'expense',
        description: '',
        value: '',
        category: 'Geral',
        payment_method: 'Pix',
        bank_account_id: '',
        status: 'paid',
        date: new Date().toISOString().split('T')[0],
        is_recurring: false,
        recurring_period: 'monthly',
        generateAsaas: false,
        customerCpfCnpj: ''
      });
      fetchData();
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este lançamento?')) return;
    
    try {
      const { error } = await supabase
        .from('system_finance_records')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setRecords(records.filter(r => r.id !== id));
      updateStats(records.filter(r => r.id !== id));
    } catch (err: any) {
      alert('Erro ao excluir: ' + err.message);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const filteredRecords = records.filter(r => {
    const matchesFilter = filter === 'all' || r.type === filter;
    const matchesSearch = r.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         r.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Receipt className="text-[#3b597b]" size={24} />
            Controle Financeiro Blindado
          </h1>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
            Gestão consolidada de todas as receitas das unidades 791.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="bg-white border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-slate-50 transition-all uppercase tracking-widest shadow-sm">
            <Download size={14} /> Exportar
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-[#3b597b] text-white px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-[#2e4763] transition-all uppercase tracking-widest shadow-lg shadow-blue-900/10"
          >
            <Plus size={14} /> Novo Lançamento
          </button>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-5 group hover:border-emerald-200 transition-all">
          <div className="h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <TrendingUp size={28} />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Receita (Pagos)</p>
            <h3 className="text-2xl font-bold text-slate-800 tracking-tight">{formatCurrency(stats.revenue)}</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-5 group hover:border-red-200 transition-all">
          <div className="h-14 w-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <TrendingDown size={28} />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Despesas (Pagos)</p>
            <h3 className="text-2xl font-bold text-slate-800 tracking-tight">{formatCurrency(stats.expenses)}</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-5 group hover:border-blue-200 transition-all">
          <div className="h-14 w-14 rounded-2xl bg-blue-50 text-[#3b597b] flex items-center justify-center group-hover:scale-110 transition-transform">
            <Wallet size={28} />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Saldo Disponível</p>
            <h3 className="text-2xl font-bold text-slate-800 tracking-tight">{formatCurrency(stats.balance)}</h3>
          </div>
        </div>
      </div>

      {/* Tabela de Lançamentos */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/30">
          <div className="flex items-center gap-2">
             <button 
                onClick={() => setFilter('all')}
                className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'all' ? 'bg-[#3b597b] text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
             >Tudo</button>
             <button 
                onClick={() => setFilter('revenue')}
                className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'revenue' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
             >Receitas</button>
             <button 
                onClick={() => setFilter('expense')}
                className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'expense' ? 'bg-red-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
             >Despesas</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Pesquisar descrição ou categoria..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl pl-9 pr-4 h-[38px] text-xs focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 w-full md:w-64 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-50 bg-slate-50/50">
                <th className="px-8 py-4">Data / Status</th>
                <th className="px-8 py-4">Descrição / Categoria</th>
                <th className="px-8 py-4 text-center">Método</th>
                <th className="px-8 py-4 text-right pr-12">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-8 py-20 text-center text-slate-400">
                    <Loader2 className="animate-spin mx-auto mb-3" size={28} />
                    <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Sincronizando fluxo de caixa...</span>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-8 py-20 text-center text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                    Nenhum lançamento encontrado.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/80 transition-all group">
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-[12px] font-bold text-slate-700">{new Date(record.created_at).toLocaleDateString('pt-BR')}</span>
                        <span className={`text-[9px] uppercase font-black tracking-tighter flex items-center gap-1 mt-0.5 ${record.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${record.status === 'paid' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                          {record.status === 'paid' ? 'Efetivado' : 'Pendente'}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-[13px] text-slate-800 font-bold uppercase tracking-tight">{record.description}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md font-black uppercase tracking-widest">
                            {record.category}
                          </span>
                          {record.bank_account_id && (
                            <span className="text-[9px] text-slate-400 flex items-center gap-1 uppercase font-bold">
                              <Building size={10} /> {bankAccounts.find(a => a.id === record.bank_account_id)?.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-3 py-1 rounded-full">
                        <CreditCard size={10} className="text-slate-400" />
                        <span className="text-[10px] text-slate-600 font-bold uppercase tracking-tighter">
                          {record.payment_method}
                        </span>
                      </div>
                    </td>
                    <td className={`px-8 py-5 text-right font-black text-sm ${record.type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {record.type === 'revenue' ? '+' : '-'} {formatCurrency(record.value)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleDelete(record.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-lg"
                          title="Excluir Lançamento"
                        >
                          <Trash2 size={16} />
                        </button>
                        {record.payment_link && (
                          <a 
                            href={record.payment_link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-600 transition-colors p-2 hover:bg-blue-50 rounded-lg"
                            title="Abrir Link de Pagamento"
                          >
                            <ExternalLink size={16} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${newRecord.type === 'revenue' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  <Receipt size={18} />
                </div>
                <h2 className="text-base font-bold text-slate-800 uppercase tracking-tight">Novo Lançamento Financeiro</h2>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5 flex-1 overflow-visible">
              {/* Seletor de Tipo */}
              <div className="flex p-1 bg-slate-100 rounded-xl gap-1 w-full max-w-xs mx-auto shrink-0">
                <button 
                  onClick={() => setNewRecord({...newRecord, type: 'revenue'})}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${newRecord.type === 'revenue' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                >Receita</button>
                <button 
                  onClick={() => setNewRecord({...newRecord, type: 'expense'})}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${newRecord.type === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}
                >Despesa</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 ml-1">Descrição</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-slate-300"><Tag size={14} /></span>
                    <input 
                      type="text" 
                      value={newRecord.description}
                      onChange={(e) => setNewRecord({...newRecord, description: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 h-[42px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 ml-1">Valor (R$)</label>
                  <input 
                    type="number" 
                    value={newRecord.value}
                    onChange={(e) => setNewRecord({...newRecord, value: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[42px] text-sm focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 ml-1">Data</label>
                  <input 
                    type="date" 
                    value={newRecord.date}
                    onChange={(e) => setNewRecord({...newRecord, date: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[42px] text-sm focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 ml-1">Categoria</label>
                  <select 
                    value={newRecord.category}
                    onChange={(e) => setNewRecord({...newRecord, category: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[42px] text-sm focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {categories.filter(c => !c.parent_id && c.type === newRecord.type).map(parent => (
                      <optgroup key={parent.id} label={parent.name.toUpperCase()}>
                        <option value={parent.name}>{parent.name}</option>
                        {categories.filter(c => c.parent_id === parent.id).map(sub => (
                          <option key={sub.id} value={sub.name}>— {sub.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 ml-1">Conta / Método</label>
                  <div className="flex gap-2">
                    <select 
                      value={newRecord.bank_account_id}
                      onChange={(e) => setNewRecord({...newRecord, bank_account_id: e.target.value})}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 h-[42px] text-xs focus:outline-none"
                    >
                      <option value="">Conta...</option>
                      {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <select 
                      value={newRecord.payment_method}
                      onChange={(e) => setNewRecord({...newRecord, payment_method: e.target.value})}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 h-[42px] text-xs focus:outline-none"
                    >
                      {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-100 h-[42px]">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest ml-2">Já foi pago?</span>
                  <label className="relative inline-flex items-center cursor-pointer mr-2">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={newRecord.status === 'paid'}
                      onChange={(e) => setNewRecord({...newRecord, status: e.target.checked ? 'paid' : 'pending'})}
                    />
                    <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                {/* Bloco de Recorrência */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex flex-col justify-center">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Recorrente?</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={newRecord.is_recurring}
                        onChange={(e) => setNewRecord({...newRecord, is_recurring: e.target.checked})}
                      />
                      <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#3b597b]"></div>
                    </label>
                  </div>
                  {newRecord.is_recurring && (
                    <select 
                      value={newRecord.recurring_period}
                      onChange={(e) => setNewRecord({...newRecord, recurring_period: e.target.value as any})}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2 h-[28px] text-[10px] focus:outline-none mt-2"
                    >
                      <option value="monthly">Mensal</option>
                      <option value="weekly">Semanal</option>
                      <option value="yearly">Anual</option>
                    </select>
                  )}
                </div>

                {/* Opção ASAAS */}
                <div className={`p-3 rounded-xl border flex flex-col justify-center transition-all ${newRecord.type === 'revenue' ? 'bg-blue-50 border-blue-100 opacity-100' : 'bg-slate-50 border-slate-100 opacity-50 pointer-events-none'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-blue-800 uppercase font-black tracking-widest">Asaas?</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={newRecord.generateAsaas}
                        onChange={(e) => setNewRecord({...newRecord, generateAsaas: e.target.checked})}
                        disabled={newRecord.type !== 'revenue'}
                      />
                      <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>

                {newRecord.generateAsaas && (
                  <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 animate-in fade-in duration-300 flex flex-col justify-center">
                    <label className="block text-[9px] text-blue-800 uppercase font-black tracking-widest mb-1">CPF/CNPJ Pagador</label>
                    <input 
                      type="text" 
                      placeholder="000.000..."
                      value={newRecord.customerCpfCnpj}
                      onChange={(e) => setNewRecord({...newRecord, customerCpfCnpj: e.target.value})}
                      className="w-full bg-white border border-blue-200 rounded-lg px-2 h-[28px] text-[10px] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex gap-4 shrink-0">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              >Cancelar</button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="flex-[2] bg-[#3b597b] hover:bg-[#2d445d] text-white py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg"
              >
                {saving ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  'Confirmar Lançamento'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Adicionar Categoria */}
      {isAddingCategory && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">Nova Categoria ({newRecord.type === 'revenue' ? 'Receita' : 'Despesa'})</h2>
              <button onClick={() => setIsAddingCategory(false)} className="text-slate-400">✕</button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Pertence a (Pai)</label>
                <select 
                  value={selectedParentCategory}
                  onChange={(e) => setSelectedParentCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[44px] text-xs focus:outline-none"
                >
                  <option value="">Nenhuma (Categoria Raiz)</option>
                  {categories.filter(c => !c.parent_id && c.type === newRecord.type).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Nome da Categoria</label>
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Ex: Aluguel, AWS..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 font-bold"
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/30 flex gap-3">
              <button 
                onClick={() => setIsAddingCategory(false)}
                className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Cancelar</button>
              <button 
                onClick={handleAddCategory}
                className="flex-[2] bg-[#3b597b] text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/10 flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
