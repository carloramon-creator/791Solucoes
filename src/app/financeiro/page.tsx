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
  CreditCard
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
    generateAsaas: false
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
      const { error } = await supabase
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
          // Busca as chaves do Asaas no banco
          const { data: configData } = await supabase.from('system_configs').select('*').single();
          
          if (configData?.asaas_api_key) {
            const asaasRes = await fetch('/api/payments/asaas/create-charge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                asaasApiKey: configData.asaas_api_key,
                asaasEnv: configData.asaas_env,
                value: record.value,
                description: record.description,
                dueDate: record.created_at.split('T')[0],
                customerName: 'Cliente Holding', // TODO: Permitir escolher cliente
                customerEmail: 'financeiro@791solucoes.com.br',
                externalReference: `holding|${record.id}`
              })
            });

            if (asaasRes.ok) {
              const asaasData = await asaasRes.json();
              alert(`Cobrança Asaas gerada! Link: ${asaasData.invoiceUrl}`);
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
        recurring_period: 'monthly'
      });
      fetchData();
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
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
                    <td className={`px-8 py-5 text-right pr-12 font-black text-sm ${record.type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {record.type === 'revenue' ? '+' : '-'} {formatCurrency(record.value)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Novo Lançamento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${newRecord.type === 'revenue' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  <Receipt size={20} />
                </div>
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Novo Lançamento Financeiro</h2>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {/* Seletor de Tipo */}
              <div className="flex p-1 bg-slate-100 rounded-2xl gap-1">
                <button 
                  onClick={() => setNewRecord({...newRecord, type: 'revenue'})}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${newRecord.type === 'revenue' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                >Receita</button>
                <button 
                  onClick={() => setNewRecord({...newRecord, type: 'expense'})}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${newRecord.type === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}
                >Despesa</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Descrição do Lançamento</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3.5 text-slate-300"><Tag size={16} /></span>
                    <input 
                      type="text" 
                      placeholder="Ex: Aluguel da Sede, Taxa AWS, Mensalidade SaaS..."
                      value={newRecord.description}
                      onChange={(e) => setNewRecord({...newRecord, description: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 h-[48px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Valor (R$)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3.5 text-slate-300 font-bold">R$</span>
                    <input 
                      type="number" 
                      placeholder="0,00"
                      value={newRecord.value}
                      onChange={(e) => setNewRecord({...newRecord, value: e.target.value})}
                      className={`w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 h-[48px] text-sm focus:outline-none font-bold ${newRecord.type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Data</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3.5 text-slate-300"><Calendar size={16} /></span>
                    <input 
                      type="date" 
                      value={newRecord.date}
                      onChange={(e) => setNewRecord({...newRecord, date: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 h-[48px] text-sm focus:outline-none"
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2 ml-1">
                    <label className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Categoria / Subcategoria</label>
                    <button 
                      onClick={() => setIsAddingCategory(true)}
                      className="text-[9px] text-[#3b597b] font-bold uppercase tracking-widest hover:underline"
                    >
                      + Nova Categoria
                    </button>
                  </div>

                  <select 
                    value={newRecord.category}
                    onChange={(e) => setNewRecord({...newRecord, category: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[48px] text-sm focus:outline-none"
                  >
                    <option value="">Selecione uma categoria...</option>
                    {/* Agrupamento por Categoria Pai */}
                    {categories.filter(c => !c.parent_id && c.type === newRecord.type).map(parent => (
                      <optgroup key={parent.id} label={parent.name.toUpperCase()}>
                        <option value={parent.name}>{parent.name}</option>
                        {categories.filter(c => c.parent_id === parent.id).map(sub => (
                          <option key={sub.id} value={sub.name}>&nbsp;&nbsp;— {sub.name}</option>
                        ))}
                      </optgroup>
                    ))}
                    {/* Categorias sem pai que não foram listadas acima */}
                    {categories.filter(c => !c.parent_id && c.type === newRecord.type && !categories.some(sub => sub.parent_id === c.id)).map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Conta Bancária</label>
                  <select 
                    value={newRecord.bank_account_id}
                    onChange={(e) => setNewRecord({...newRecord, bank_account_id: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[48px] text-sm focus:outline-none"
                  >
                    <option value="">Selecione uma conta...</option>
                    {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.bank_name})</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Método de Pagto</label>
                  <select 
                    value={newRecord.payment_method}
                    onChange={(e) => setNewRecord({...newRecord, payment_method: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[48px] text-sm focus:outline-none"
                  >
                    {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100 h-[48px] mt-auto">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest ml-2">Já foi pago?</span>
                  <label className="relative inline-flex items-center cursor-pointer mr-2">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={newRecord.status === 'paid'}
                      onChange={(e) => setNewRecord({...newRecord, status: e.target.checked ? 'paid' : 'pending'})}
                    />
                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                {/* Bloco de Recorrência */}
                <div className="md:col-span-2 p-4 bg-slate-100/50 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest ml-1">É um lançamento recorrente?</span>
                    <label className="relative inline-flex items-center cursor-pointer mr-1">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={newRecord.is_recurring}
                        onChange={(e) => setNewRecord({...newRecord, is_recurring: e.target.checked})}
                      />
                      <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#3b597b]"></div>
                    </label>
                  </div>
                  
                  {newRecord.is_recurring && (
                    <div className="pt-2 border-t border-slate-200 animate-in slide-in-from-top-2 duration-300">
                      <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2 ml-1">Período de Recorrência</label>
                      <select 
                        value={newRecord.recurring_period}
                        onChange={(e) => setNewRecord({...newRecord, recurring_period: e.target.value as any})}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 h-[48px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10"
                      >
                        <option value="daily">Diário</option>
                        <option value="weekly">Semanal</option>
                        <option value="biweekly">Quinzenal</option>
                        <option value="monthly">Mensal</option>
                        <option value="yearly">Anual</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Opção ASAAS (Apenas para Receita) */}
                {newRecord.type === 'revenue' && (
                  <div className="md:col-span-2 p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-blue-800 uppercase font-black tracking-widest ml-1">Gerar Link de Pagamento no Asaas?</span>
                      <span className="text-[9px] text-blue-500 uppercase font-bold tracking-tight ml-1">Cria cobrança Pix/Boleto automaticamente</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer mr-1">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={newRecord.generateAsaas}
                        onChange={(e) => setNewRecord({...newRecord, generateAsaas: e.target.checked})}
                      />
                      <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                )}

              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/30 flex gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-600 transition-all"
              >Cancelar</button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="flex-[2] bg-[#3b597b] text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-blue-900/10 flex items-center justify-center gap-2 hover:bg-[#2e4763] transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? 'Gravando...' : 'Confirmar Lançamento'}
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
