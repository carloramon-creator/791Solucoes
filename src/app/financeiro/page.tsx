"use client";

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
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
interface FinanceRecord {
  id: string;
  type: 'revenue' | 'expense';
  value: number;
  description: string;
  metadata?: any;
  tenant_name?: string | null;
  payment_method: string;
  category: string;
  status: 'paid' | 'pending';
  bank_account_id?: string;
  created_at: string;
  is_recurring: boolean;
  recurring_period?: string;
  payment_link?: string;
}

type DifferenceHandling = 'adjust' | 'keep_open';
type OpenViewKind = 'payable' | 'receivable';
type PeriodFilter = 'dia' | 'semana' | 'quinzena' | 'mes' | 'trimestre' | 'semestre' | 'ano';

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
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);
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
  const [filter, setFilter] = useState<'all' | 'revenue' | 'expense' | 'payable'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSection, setActiveSection] = useState<'lancamentos' | 'abertos'>('lancamentos');
  const [openViewKind, setOpenViewKind] = useState<OpenViewKind>('payable');
  const [openPeriod, setOpenPeriod] = useState<PeriodFilter>('dia');
  const [openDateStart, setOpenDateStart] = useState(new Date().toISOString().split('T')[0]);
  const [openDateEnd, setOpenDateEnd] = useState(new Date().toISOString().split('T')[0]);
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [settleRecord, setSettleRecord] = useState<FinanceRecord | null>(null);
  const [settleForm, setSettleForm] = useState({
    paidAmount: '',
    bankAccountId: '',
    paymentMethod: 'Pix',
    differenceHandling: 'adjust' as DifferenceHandling,
  });

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

  const periodOptions: PeriodFilter[] = ['dia', 'semana', 'quinzena', 'mes', 'trimestre', 'semestre', 'ano'];

  const getPeriodLabel = (period: PeriodFilter) => {
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
  };

  const getDateRangeByPeriod = (period: PeriodFilter) => {
    const now = new Date();
    const start = new Date(now);

    switch (period) {
      case 'dia':
        break;
      case 'semana':
        start.setDate(now.getDate() - 6);
        break;
      case 'quinzena':
        start.setDate(now.getDate() - 14);
        break;
      case 'mes':
        start.setDate(now.getDate() - 29);
        break;
      case 'trimestre':
        start.setDate(now.getDate() - 89);
        break;
      case 'semestre':
        start.setDate(now.getDate() - 179);
        break;
      case 'ano':
        start.setDate(now.getDate() - 364);
        break;
    }

    return {
      start: start.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
    };
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const range = getDateRangeByPeriod(openPeriod);
    setOpenDateStart(range.start);
    setOpenDateEnd(range.end);
  }, [openPeriod]);

  useEffect(() => {
    const settleId = searchParams.get('settleId');
    if (!settleId || records.length === 0) return;

    const target = records.find((row) => row.id === settleId);
    if (target && target.status !== 'paid') {
      setActiveSection('abertos');
      setOpenViewKind(target.type === 'expense' ? 'payable' : 'receivable');
      openSettleModal(target);
    }
  }, [searchParams, records]);

  async function fetchData() {
    setLoading(true);
    try {
      const [recordsRes, accountsRes] = await Promise.all([
        fetch('/api/system/finance-records', { cache: 'no-store' }),
        fetch('/api/system/bank-accounts', { cache: 'no-store' })
      ]);

      const recordsJson = await recordsRes.json();
      const accountsJson = await accountsRes.json();

      if (recordsJson.success) {
        setRecords(recordsJson.records || []);
        updateStats(recordsJson.records || []);
      }
      if (accountsJson.success) setBankAccounts(accountsJson.accounts || []);

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

  const categoryByName = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((cat) => {
      map.set(cat.name, cat);
    });
    return map;
  }, [categories]);

  const getClassAndSubclass = (record: FinanceRecord) => {
    const metadataClass = record.metadata?.classe || record.metadata?.class || null;
    const metadataSubclass = record.metadata?.subclasse || record.metadata?.subclass || null;
    if (metadataClass || metadataSubclass) {
      return {
        classe: metadataClass || record.category || 'Geral',
        subclasse: metadataSubclass || '-',
      };
    }

    const category = categoryByName.get(record.category);
    if (!category) {
      return { classe: record.category || 'Geral', subclasse: '-' };
    }

    if (!category.parent_id) {
      return { classe: category.name, subclasse: '-' };
    }

    const parent = categories.find((row) => row.id === category.parent_id);
    return {
      classe: parent?.name || category.name,
      subclasse: category.name,
    };
  };

  const formatDateShort = (value?: string) => {
    if (!value) return '--';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '--';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const getDueDate = (record: FinanceRecord) => {
    return record.metadata?.due_date || record.metadata?.vencimento || record.created_at;
  };

  const openSettleModal = (record: FinanceRecord) => {
    setSettleRecord(record);
    setSettleForm({
      paidAmount: String(Number(record.value || 0).toFixed(2)),
      bankAccountId: record.bank_account_id || '',
      paymentMethod: record.payment_method || 'Pix',
      differenceHandling: 'adjust',
    });
    setIsSettleModalOpen(true);
  };

  const handleSettleRecord = async () => {
    if (!settleRecord) return;

    const paidAmount = Number(settleForm.paidAmount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      alert('Informe um valor de baixa válido.');
      return;
    }

    const originalValue = Number(settleRecord.value || 0);
    const difference = Number((originalValue - paidAmount).toFixed(2));
    if (settleForm.differenceHandling === 'keep_open' && difference <= 0) {
      alert('Para manter diferença em aberto, o valor pago deve ser menor que o valor lançado.');
      return;
    }

    setSettling(true);
    try {
      const response = await fetch('/api/system/finance-records/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: settleRecord.id,
          paidAmount,
          bankAccountId: settleForm.bankAccountId || null,
          paymentMethod: settleForm.paymentMethod,
          differenceHandling: settleForm.differenceHandling,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Falha ao baixar lançamento.');
      }

      setIsSettleModalOpen(false);
      setSettleRecord(null);
      await fetchData();
    } catch (err: any) {
      alert(`Erro ao baixar: ${err?.message || 'Falha inesperada.'}`);
    } finally {
      setSettling(false);
    }
  };

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
      const createRes = await fetch('/api/system/finance-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        })
      });

      const createJson = await createRes.json();
      if (!createJson.success) throw new Error(createJson.error || 'Erro ao salvar lançamento');
      const data = createJson.record ? [createJson.record] : [];

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
              const updateRes = await fetch('/api/system/finance-records', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: record.id, payment_link: asaasData.invoiceUrl })
              });
              const updateJson = await updateRes.json();

              if (!updateJson.success) {
                alert(`Lançamento salvo, mas erro ao guardar o link: ${updateJson.error}`);
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
      const res = await fetch(`/api/system/finance-records?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao excluir');
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

  const getDisplayDescription = (record: FinanceRecord) => {
    const tenantSuffixRegex = /\s*-\s*Tenant:\s*[0-9a-f-]+/i;
    const tenantName = record.tenant_name || record.metadata?.tenant_name;

    if (tenantSuffixRegex.test(record.description)) {
      if (tenantName) {
        return record.description.replace(tenantSuffixRegex, ` - ${tenantName}`);
      }
      return record.description.replace(tenantSuffixRegex, '').trim();
    }

    return record.description;
  };

  const filteredRecords = records.filter(r => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'revenue' && r.type === 'revenue') ||
      (filter === 'expense' && r.type === 'expense') ||
      (filter === 'payable' && r.type === 'expense' && r.status !== 'paid');
    const description = getDisplayDescription(r);
    const matchesSearch = description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         r.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const openRecordsFiltered = records
    .filter((record) => record.status !== 'paid')
    .filter((record) => (openViewKind === 'payable' ? record.type === 'expense' : record.type === 'revenue'))
    .filter((record) => {
      const due = new Date(getDueDate(record));
      if (!Number.isFinite(due.getTime())) return false;

      const start = new Date(`${openDateStart}T00:00:00`);
      const end = new Date(`${openDateEnd}T23:59:59.999`);
      return due.getTime() >= start.getTime() && due.getTime() <= end.getTime();
    })
    .sort((a, b) => new Date(getDueDate(a)).getTime() - new Date(getDueDate(b)).getTime());

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

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/30 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveSection('lancamentos')}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === 'lancamentos' ? 'bg-[#3b597b] text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Lançamentos
            </button>
            <button
              onClick={() => {
                setActiveSection('abertos');
                setOpenViewKind('payable');
              }}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === 'abertos' && openViewKind === 'payable' ? 'bg-red-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Contas a pagar em aberto
            </button>
            <button
              onClick={() => {
                setActiveSection('abertos');
                setOpenViewKind('receivable');
              }}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === 'abertos' && openViewKind === 'receivable' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Contas a receber em aberto
            </button>
          </div>

          {activeSection === 'lancamentos' ? (
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
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
                <button 
                  onClick={() => setFilter('payable')}
                  className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'payable' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                >Contas a Pagar</button>
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
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {periodOptions.map((period) => (
                  <button
                    key={period}
                    onClick={() => setOpenPeriod(period)}
                    className={`text-[10px] px-3 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${openPeriod === period ? 'bg-[#3b597b] text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    {getPeriodLabel(period)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Início</label>
                <input
                  type="date"
                  value={openDateStart}
                  onChange={(event) => setOpenDateStart(event.target.value)}
                  className="h-[34px] rounded-lg border border-slate-200 px-2 text-xs"
                />
                <label className="text-[10px] text-slate-500 uppercase font-bold tracking-widest ml-2">Fim</label>
                <input
                  type="date"
                  value={openDateEnd}
                  onChange={(event) => setOpenDateEnd(event.target.value)}
                  className="h-[34px] rounded-lg border border-slate-200 px-2 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        {activeSection === 'lancamentos' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-50 bg-slate-50/50">
                  <th className="px-8 py-3">Data / Status</th>
                  <th className="px-8 py-3">Descrição / Categoria</th>
                  <th className="px-8 py-3 text-center">Método</th>
                  <th className="px-8 py-3 text-right pr-12">Valor</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center text-slate-400">
                      <Loader2 className="animate-spin mx-auto mb-3" size={28} />
                      <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Sincronizando fluxo de caixa...</span>
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                      Nenhum lançamento encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50/80 transition-all group">
                      <td className="px-8 py-2.5">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-slate-700">{new Date(record.created_at).toLocaleDateString('pt-BR')}</span>
                          <span className={`text-[9px] uppercase font-black tracking-tighter flex items-center gap-1 mt-0.5 ${record.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${record.status === 'paid' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                            {record.status === 'paid' ? 'Efetivado' : 'Pendente'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-2.5">
                        <div className="flex flex-col">
                          <span className="text-[12px] text-slate-800 font-bold uppercase tracking-tight">{getDisplayDescription(record)}</span>
                          <div className="flex items-center gap-2 mt-0.5">
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
                      <td className="px-8 py-2.5 text-center">
                        <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-3 py-1 rounded-full">
                          <CreditCard size={10} className="text-slate-400" />
                          <span className="text-[10px] text-slate-600 font-bold uppercase tracking-tighter">
                            {record.payment_method}
                          </span>
                        </div>
                      </td>
                      <td className={`px-8 py-2.5 text-right font-black text-sm ${record.type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {record.type === 'revenue' ? '+' : '-'} {formatCurrency(record.value)}
                      </td>
                      <td className="px-6 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {record.status !== 'paid' && (
                            <button
                              onClick={() => openSettleModal(record)}
                              className="text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider"
                              title="Baixar lançamento"
                            >
                              Baixar
                            </button>
                          )}
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-50 bg-slate-50/50">
                  <th className="px-4 py-2">Classe</th>
                  <th className="px-4 py-2">Subclasse</th>
                  <th className="px-4 py-2">Lançamento</th>
                  <th className="px-4 py-2">Venc.</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                  <th className="px-4 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-8 py-10 text-center text-slate-400">
                      <Loader2 className="animate-spin mx-auto mb-3" size={24} />
                      <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Carregando contas em aberto...</span>
                    </td>
                  </tr>
                ) : openRecordsFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-8 py-10 text-center text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                      Nenhuma conta em aberto para o filtro informado.
                    </td>
                  </tr>
                ) : (
                  openRecordsFiltered.map((record) => {
                    const classInfo = getClassAndSubclass(record);
                    const dueDate = getDueDate(record);
                    return (
                      <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 text-[11px] text-slate-700">{classInfo.classe}</td>
                        <td className="px-4 py-2 text-[11px] text-slate-500">{classInfo.subclasse}</td>
                        <td className="px-4 py-2 text-[12px] font-semibold text-slate-800">{getDisplayDescription(record)}</td>
                        <td className="px-4 py-2 text-[11px] text-slate-600">{formatDateShort(dueDate)}</td>
                        <td className={`px-4 py-2 text-right text-[12px] font-bold ${record.type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {record.type === 'revenue' ? '+' : '-'} {formatCurrency(record.value)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => openSettleModal(record)}
                            className="text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider"
                          >
                            Baixar
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
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

      {isSettleModalOpen && settleRecord && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-[105] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-slate-200">
            <div className="p-6 border-b border-slate-100 bg-slate-50/40">
              <h2 className="text-lg font-black uppercase tracking-tight text-[#3b597b]">Baixar Lançamento</h2>
              <p className="text-xs text-slate-500 mt-1">
                {getDisplayDescription(settleRecord)} | Valor original: {formatCurrency(settleRecord.value)}
              </p>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">Valor pago</label>
                  <input
                    type="number"
                    step="0.01"
                    value={settleForm.paidAmount}
                    onChange={(event) => setSettleForm((prev) => ({ ...prev, paidAmount: event.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 h-[40px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">Método</label>
                  <select
                    value={settleForm.paymentMethod}
                    onChange={(event) => setSettleForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 h-[40px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20"
                  >
                    {paymentMethods.map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">Conta bancária</label>
                  <select
                    value={settleForm.bankAccountId}
                    onChange={(event) => setSettleForm((prev) => ({ ...prev, bankAccountId: event.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 h-[40px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20"
                  >
                    <option value="">Sem conta bancária</option>
                    {bankAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">Se houver diferença</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name="differenceHandling"
                      checked={settleForm.differenceHandling === 'adjust'}
                      onChange={() => setSettleForm((prev) => ({ ...prev, differenceHandling: 'adjust' }))}
                    />
                    <span>Fechar lançamento com o valor pago (juros/desconto).</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name="differenceHandling"
                      checked={settleForm.differenceHandling === 'keep_open'}
                      onChange={() => setSettleForm((prev) => ({ ...prev, differenceHandling: 'keep_open' }))}
                    />
                    <span>Manter diferença em aberto em um novo lançamento pendente.</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (settling) return;
                  setIsSettleModalOpen(false);
                  setSettleRecord(null);
                }}
                className="h-[38px] px-4 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider hover:bg-white"
              >
                Cancelar
              </button>
              <button
                onClick={handleSettleRecord}
                disabled={settling}
                className="h-[38px] px-5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {settling ? 'Baixando...' : 'Confirmar baixa'}
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
