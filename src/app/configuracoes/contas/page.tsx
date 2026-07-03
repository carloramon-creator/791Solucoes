"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  Plus, 
  CreditCard, 
  Building2, 
  MoreVertical,
  ChevronRight,
  ShieldCheck,
  Loader2,
  Trash2,
  Check,
  Calendar,
  Layers,
  Pencil
} from 'lucide-react';
import { ConfigTabs } from '@/components/ConfigTabs';

interface BankCard {
  id: string;
  account_id: string;
  name: string;
  last_digits: string;
  brand: string;
  card_type: string;
  credit_limit: number;
  closing_day: number;
  due_day: number;
  current_balance?: number;
  statement_subcategory_id?: string | null;
}

interface Category {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
}

interface FinanceRecord {
  id: string;
  type: 'revenue' | 'expense';
  value: number;
  description: string;
  status: string;
  created_at: string;
  category?: string | null;
  metadata?: Record<string, any> | null;
}

interface BankAccount {
  id: string;
  name: string;
  type: string;
  bank_name: string;
  agency: string;
  account_number: string;
  balance: number;
  credit_limit: number;
  overdraft_limit: number;
  status: string;
  current_balance?: number;
  cards?: BankCard[];
}

export default function ContasBancariasPage() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [financeRecords, setFinanceRecords] = useState<FinanceRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    bank_name: '',
    type: 'corrente',
    agency: '',
    account_number: '',
    balance: 0,
    credit_limit: 0,
    overdraft_limit: 0
  });

  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<BankCard | null>(null);
  const [closingCardId, setClosingCardId] = useState<string | null>(null);
  const [statementCard, setStatementCard] = useState<(BankCard & { accountName?: string }) | null>(null);
  const [selectedStatementRecordIds, setSelectedStatementRecordIds] = useState<string[]>([]);
  const [totals, setTotals] = useState({ limit: 0, spent: 0, available: 0 });
  
  // Ações
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [detailModalAccount, setDetailModalAccount] = useState<BankAccount | null>(null);

  // Card Form State
  const [cardFormData, setCardFormData] = useState({
    name: '',
    last_digits: '',
    brand: 'Visa',
    card_type: 'credit',
    credit_limit: 0,
    closing_day: 1,
    due_day: 10,
    statement_subcategory_id: ''
  });

  const getCardSpentAmount = (card?: BankCard | null, records: FinanceRecord[] = financeRecords) => {
    if (!card) return 0;

    return records.reduce((sum, record: any) => {
      const recordCardId = String(record?.metadata?.card_id || '');
      if (recordCardId !== card.id) return sum;
      if (record.type !== 'expense') return sum;

      const cardStatementReference = String(record?.metadata?.card_statement_reference || '');
      const cardStatementGenerated = Boolean(record?.metadata?.card_statement_generated);

      if (record.status === 'paid' && !cardStatementReference) {
        return sum + Number(record.value || 0);
      }

      if (record.status === 'pending' && cardStatementGenerated) {
        return sum + Number(record.value || 0);
      }

      return sum;
    }, 0);
  };

  const isCreditCard = (card?: BankCard | null) => String(card?.card_type || '').toLowerCase().includes('credit') || Number(card?.credit_limit || 0) > 0;
  const isCurrentAccount = (account?: BankAccount | null) => String(account?.type || '').toLowerCase().includes('corrente');

  const getOverdraftRemaining = (account?: BankAccount | null) => {
    if (!account || !isCurrentAccount(account)) return 0;

    const currentBalance = Number(account.current_balance ?? account.balance ?? 0);
    const overdraftLimit = Number(account.overdraft_limit || 0);

    if (overdraftLimit <= 0) return 0;
    if (currentBalance >= 0) return overdraftLimit;

    return Math.max(overdraftLimit - Math.abs(currentBalance), 0);
  };

  const loadAccounts = async () => {
    const [accRes, financeRes, categoriesRes] = await Promise.all([
      fetch('/api/system/bank-accounts', { cache: 'no-store' }),
      fetch('/api/system/finance-records', { cache: 'no-store' }),
      fetch('/api/system/categories', { cache: 'no-store' }),
    ]);

    const accJson = await accRes.json();
    const financeJson = await financeRes.json();
    const categoriesJson = await categoriesRes.json();

    const accData: BankAccount[] = accJson.success ? accJson.accounts : [];
    const nextFinanceRecords = financeJson.success ? financeJson.records : [];
    setFinanceRecords(nextFinanceRecords);
    setCategories(Array.isArray(categoriesJson) ? categoriesJson : []);

    if (accData) {

      const accountAdjustments = new Map<string, number>();
      const cardAdjustments = new Map<string, number>();

      nextFinanceRecords.forEach((record: any) => {
        if (record.status !== 'paid') return;

        const signedValue = record.type === 'revenue' ? Number(record.value || 0) : -Number(record.value || 0);
        const recordAccountId = record.bank_account_id ? String(record.bank_account_id) : '';
        const recordCardId = record.metadata?.card_id ? String(record.metadata.card_id) : '';

        if (recordCardId) {
          cardAdjustments.set(recordCardId, (cardAdjustments.get(recordCardId) || 0) + signedValue);
          return;
        }

        if (recordAccountId) {
          accountAdjustments.set(recordAccountId, (accountAdjustments.get(recordAccountId) || 0) + signedValue);
        }
      });

      const normalizedAccounts = accData.map((account) => ({
          ...account,
          current_balance: Number(account.balance || 0) + (accountAdjustments.get(account.id) || 0),
          cards: (account.cards || []).map((card: any) => ({
            ...card,
            current_balance: Number(card.current_balance || 0) + (cardAdjustments.get(card.id) || 0),
          })),
        }));

      setAccounts(normalizedAccounts);

      if (detailModalAccount?.id) {
        setDetailModalAccount(normalizedAccounts.find((account) => account.id === detailModalAccount.id) || null);
      }

      const allCards = normalizedAccounts.flatMap((account) => account.cards || []);
      const creditCards = allCards.filter((card) => isCreditCard(card));
      const totalLimit = creditCards.reduce((sum, card) => sum + Number(card.credit_limit || 0), 0);
      const totalSpent = creditCards.reduce((sum, card) => sum + getCardSpentAmount(card, nextFinanceRecords), 0);

      setTotals({ limit: totalLimit, spent: totalSpent, available: totalLimit - totalSpent });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingAccount) {
        const res = await fetch('/api/system/bank-accounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingAccount.id, ...formData })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Erro ao atualizar conta');
        if (json.account) loadAccounts();
      } else {
        const res = await fetch('/api/system/bank-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Erro ao criar conta');
        if (json.account) loadAccounts();
      }

      setIsModalOpen(false);
      setEditingAccount(null);
      setFormData({
        name: '',
        bank_name: '',
        type: 'corrente',
        agency: '',
        account_number: '',
        balance: 0,
        credit_limit: 0,
        overdraft_limit: 0
      });
    } catch (err: any) {
      alert('Erro ao salvar conta: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) return;
    setSaving(true);
    try {
      const payload = editingCard
        ? { id: editingCard.id, ...cardFormData, statement_subcategory_id: cardFormData.statement_subcategory_id || null, account_id: selectedAccountId }
        : { ...cardFormData, statement_subcategory_id: cardFormData.statement_subcategory_id || null, account_id: selectedAccountId };

      const res = await fetch('/api/system/bank-cards', {
        method: editingCard ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao salvar cartão');
      if (json.card) {
        await loadAccounts();
      }
      setIsCardModalOpen(false);
      setEditingCard(null);
      setCardFormData({
        name: '',
        last_digits: '',
        brand: 'Visa',
        card_type: 'credit',
        credit_limit: 0,
        closing_day: 1,
        due_day: 10,
        statement_subcategory_id: ''
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Tem certeza que deseja excluir este cartão?')) return;

    try {
      const res = await fetch(`/api/system/bank-cards?id=${cardId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao excluir cartão');
      await loadAccounts();
    } catch (err: any) {
      alert('Erro ao excluir cartão: ' + err.message);
    }
  };

  const handleEditCard = (accountId: string, card: BankCard) => {
    setSelectedAccountId(accountId);
    setEditingCard(card);
    setCardFormData({
      name: card.name,
      last_digits: card.last_digits,
      brand: card.brand,
      card_type: card.card_type,
      credit_limit: Number(card.credit_limit || 0),
      closing_day: Number(card.closing_day || 1),
      due_day: Number(card.due_day || 10),
      statement_subcategory_id: String(card.statement_subcategory_id || ''),
    });
    setIsCardModalOpen(true);
  };

  const handleCloseCard = async (cardId: string) => {
    const selectedCard = accounts.flatMap((account) => (account.cards || []).map((card) => ({ ...card, accountName: account.name }))).find((card) => card.id === cardId) || null;
    if (!selectedCard) return;
    setStatementCard(selectedCard);
    setSelectedStatementRecordIds([]);
  };

  const eligibleStatementRecords = statementCard
    ? financeRecords
        .filter((record) => record.status === 'paid' && record.type === 'expense')
        .filter((record) => String(record.metadata?.card_id || '') === statementCard.id)
        .filter((record) => !record.metadata?.card_statement_reference)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : [];

  const selectedStatementTotal = eligibleStatementRecords
    .filter((record) => selectedStatementRecordIds.includes(record.id))
    .reduce((sum, record) => sum + Number(record.value || 0), 0);

  const toggleStatementRecord = (recordId: string) => {
    setSelectedStatementRecordIds((prev) => prev.includes(recordId) ? prev.filter((id) => id !== recordId) : [...prev, recordId]);
  };

  const handleConfirmStatement = async () => {
    if (!statementCard) return;
    if (selectedStatementRecordIds.length === 0) {
      alert('Selecione ao menos um lançamento para compor a fatura.');
      return;
    }

    setClosingCardId(statementCard.id);
    try {
      const res = await fetch('/api/system/bank-cards/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: statementCard.id, recordIds: selectedStatementRecordIds }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao fechar fatura');
      setStatementCard(null);
      setSelectedStatementRecordIds([]);
      await loadAccounts();
      alert('Fatura gerada com sucesso. O débito já está em contas a pagar.');
    } catch (err: any) {
      alert('Erro ao fechar fatura: ' + err.message);
    } finally {
      setClosingCardId(null);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return '--';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '--';
    return date.toLocaleDateString('pt-BR');
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta conta? Esta ação não pode ser desfeita.')) return;
    
    try {
      const res = await fetch(`/api/system/bank-accounts?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao excluir conta');
      setAccounts(prev => prev.filter(acc => acc.id !== id));
      setMenuOpenId(null);
    } catch (err: any) {
      alert('Erro ao excluir conta: ' + err.message);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const parseCurrency = (value: string) => {
    const cleanValue = value.replace(/\D/g, '');
    return Number(cleanValue) / 100;
  };

  const handleCurrencyInput = (value: string, field: string, isCard = false) => {
    const numericValue = parseCurrency(value);
    if (isCard) {
      setCardFormData({ ...cardFormData, [field]: numericValue });
    } else {
      setFormData({ ...formData, [field]: numericValue });
    }
  };

  const displayMask = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const statementSubcategories = categories.filter((category) => category.parent_id && category.type === 'expense');
  const cardSummary = useMemo(() => {
    const creditCards = accounts.flatMap((account) => account.cards || []).filter((card) => isCreditCard(card));
    const limit = creditCards.reduce((sum, card) => sum + Number(card.credit_limit || 0), 0);
    const spent = creditCards.reduce((sum, card) => sum + getCardSpentAmount(card), 0);

    return {
      limit,
      spent,
      available: limit - spent,
    };
  }, [accounts, financeRecords]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Wallet className="text-[#3b597b]" size={24} />
            Configurações do Sistema
          </h1>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
            Gerencie as preferências globais e integrações da Holding.
          </p>
        </div>
        <button 
          onClick={() => {
            setEditingAccount(null);
            setFormData({
              name: '',
              bank_name: '',
              type: 'corrente',
              agency: '',
              account_number: '',
              balance: 0,
              credit_limit: 0,
              overdraft_limit: 0
            });
            setIsModalOpen(true);
          }}
          className="bg-[#3b597b] text-white px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-[#2e4763] transition-all uppercase tracking-widest shadow-lg shadow-blue-900/10"
        >
          <Plus size={14} /> Nova Conta
        </button>
      </div>

      <ConfigTabs />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin mb-2" size={32} />
          <span className="text-sm uppercase tracking-widest">Carregando contas...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
          <div className="h-16 w-16 bg-slate-50 text-slate-300 flex items-center justify-center rounded-full mx-auto mb-4">
            <Building2 size={32} />
          </div>
          <h3 className="text-slate-600 uppercase tracking-widest text-sm">Nenhuma conta cadastrada</h3>
          <p className="text-slate-400 text-xs mt-2 uppercase tracking-tight">Cadastre sua primeira conta bancária para começar o controle.</p>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="mt-6 text-[#3b597b] text-xs uppercase tracking-widest hover:underline"
          >
            Adicionar agora
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center text-[#3b597b]">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-slate-800 uppercase tracking-tight">{account.name}</h3>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">{account.bank_name}</p>
                  </div>
                </div>
                <div className="relative">
                  <button 
                    onClick={() => setMenuOpenId(menuOpenId === account.id ? null : account.id)}
                    className="text-slate-300 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition-all"
                  >
                    <MoreVertical size={18} />
                  </button>
                  
                  {menuOpenId === account.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)}></div>
                      <div className="absolute right-0 mt-2 w-32 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-20 animate-in fade-in zoom-in-95 duration-150">
                        <button 
                          onClick={() => {
                            setEditingAccount(account);
                            setFormData({
                              name: account.name,
                              bank_name: account.bank_name,
                              type: account.type,
                              agency: account.agency,
                              account_number: account.account_number,
                              balance: account.balance,
                              credit_limit: account.credit_limit,
                              overdraft_limit: account.overdraft_limit
                            });
                            setIsModalOpen(true);
                            setMenuOpenId(null);
                          }}
                          className="w-full text-left px-4 py-2 text-[10px] text-slate-600 hover:bg-slate-50 uppercase tracking-widest"
                        >
                          Editar
                        </button>
                        <button 
                          onClick={() => handleDeleteAccount(account.id)}
                          className="w-full text-left px-4 py-2 text-[10px] text-red-500 hover:bg-red-50 uppercase tracking-widest"
                        >
                          Excluir
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-4 flex-1">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Saldo em Conta</p>
                  <h4 className={`text-2xl tracking-tight ${(account.current_balance ?? account.balance) >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                    {formatCurrency(account.current_balance ?? account.balance)}
                  </h4>
                          {isCurrentAccount(account) && Number(account.current_balance ?? account.balance ?? 0) < 0 && Number(account.overdraft_limit || 0) > 0 && (
                            <div className="mt-1">
                              <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Restante do cheque especial</p>
                              <p className="text-sm font-medium text-blue-600">{formatCurrency(getOverdraftRemaining(account))}</p>
                            </div>
                          )}
                </div>

                {/* Cartões Vinculados */}
                <div className="pt-4 border-t border-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Layers size={12} /> Cartões
                    </p>
                    <button 
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        setEditingCard(null);
                        setCardFormData({
                          name: '',
                          last_digits: '',
                          brand: 'Visa',
                          card_type: 'credit',
                          credit_limit: 0,
                          closing_day: 1,
                          due_day: 10,
                          statement_subcategory_id: ''
                        });
                        setIsCardModalOpen(true);
                      }}
                      className="text-[9px] text-[#3b597b] hover:underline uppercase tracking-widest"
                    >
                      + Add
                    </button>
                  </div>
                  
                  {account.cards && account.cards.length > 0 ? (
                    <div className="space-y-2">
                      {account.cards.map(card => (
                        <div key={card.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 group/card">
                          <div className="flex items-center gap-2">
                            <CreditCard size={14} className="text-slate-400" />
                            <div className="flex flex-col">
                              <span className="text-[11px] text-slate-700 uppercase tracking-tight">{card.name}</span>
                              <span className="text-[9px] text-slate-400 uppercase">•••• {card.last_digits}</span>
                            </div>
                          </div>
                          <div className="text-right">
                             <span className="block text-[10px] text-slate-600">Limite {formatCurrency(card.credit_limit)}</span>
                             <span className="block text-[10px] text-red-600">Gasto {formatCurrency(getCardSpentAmount(card))}</span>
                             {isCreditCard(card) && (
                               <button
                                 onClick={() => handleCloseCard(card.id)}
                                 className="mt-1 inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-700 hover:bg-amber-100"
                               >
                                 Fechar fatura
                               </button>
                             )}
                             <div className="mt-1 flex justify-end gap-1 opacity-0 group-hover/card:opacity-100 transition-all">
                               <button onClick={() => handleEditCard(account.id, card)} className="p-1 text-slate-400 hover:text-blue-600" title="Editar cartão"><Pencil size={12} /></button>
                               <button onClick={() => handleDeleteCard(card.id)} className="p-1 text-slate-400 hover:text-red-600" title="Excluir cartão"><Trash2 size={12} /></button>
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-300 italic">Nenhum cartão vinculado</p>
                  )}
                </div>
              </div>

              <div className="p-4 bg-slate-50/50 flex items-center justify-between">
                 <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-tighter">
                   <ShieldCheck size={12} className="text-emerald-500" /> Conta Ativa
                 </div>
                 <button 
                  onClick={() => setDetailModalAccount(account)}
                  className="text-[10px] text-[#3b597b] uppercase tracking-widest flex items-center gap-1 hover:underline"
                >
                   Ver Detalhes <ChevronRight size={12} />
                 </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Seção de Cartões Rápidos */}
      <div className="bg-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <h2 className="text-xl uppercase tracking-tight">Cartões da Empresa</h2>
            <p className="text-slate-400 text-sm tracking-wide">Visualize os limites de crédito e gastos consolidados da 791 Soluções.</p>
          </div>
           <div className="flex flex-wrap gap-4 justify-end">
             <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/10 w-48">
                <CreditCard size={20} className="text-blue-400 mb-3" />
                <p className="text-[9px] text-slate-400 uppercase tracking-widest">Gasto Atual</p>
                <p className="text-lg font-medium text-white tracking-tight">{formatCurrency(cardSummary.spent)}</p>
             </div>
             <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/10 w-48">
               <ShieldCheck size={20} className="text-slate-200 mb-3" />
               <p className="text-[9px] text-slate-400 uppercase tracking-widest">Limite Total</p>
               <p className="text-lg font-medium text-white tracking-tight">{formatCurrency(cardSummary.limit)}</p>
             </div>
             <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/10 w-48">
                <ShieldCheck size={20} className="text-emerald-400 mb-3" />
                <p className="text-[9px] text-slate-400 uppercase tracking-widest">Limite Disponível</p>
                 <p className="text-lg font-medium text-white tracking-tight">{formatCurrency(cardSummary.available)}</p>
             </div>
          </div>
        </div>
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 blur-3xl rounded-full -mr-20 -mt-20"></div>
      </div>

      {/* Modal de Nova Conta */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[500px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">
                {editingAccount ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
              </h2>
              <button onClick={() => { setIsModalOpen(false); setEditingAccount(null); }} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Apelido da Conta</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ex: Banco Inter Principal"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Banco</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ex: Inter"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={formData.bank_name}
                    onChange={(e) => setFormData({...formData, bank_name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Tipo</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value})}
                  >
                    <option value="corrente">Corrente</option>
                    <option value="poupanca">Poupança</option>
                    <option value="investimento">Investimento</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Agência</label>
                  <input 
                    type="text" 
                    placeholder="0001"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={formData.agency}
                    onChange={(e) => setFormData({...formData, agency: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Número da Conta</label>
                  <input 
                    type="text" 
                    placeholder="12345-6"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={formData.account_number}
                    onChange={(e) => setFormData({...formData, account_number: e.target.value})}
                  />
                </div>
                <div className="col-span-2 pt-2 border-t border-slate-100 mt-2">
                  <h4 className="text-[10px] text-slate-400 uppercase tracking-widest mb-3">Limites e Saldos Iniciais</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Saldo Inicial</label>
                      <div className="relative">
                        <span className="absolute left-3 top-3 text-slate-400 text-sm">R$</span>
                        <input 
                          type="text" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 h-[44px] text-sm focus:outline-none"
                          value={displayMask(formData.balance)}
                          onChange={(e) => handleCurrencyInput(e.target.value, 'balance')}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Cheque Especial</label>
                      <div className="relative">
                        <span className="absolute left-3 top-3 text-slate-400 text-sm">R$</span>
                        <input 
                          type="text" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 h-[44px] text-sm focus:outline-none"
                          value={displayMask(formData.overdraft_limit)}
                          onChange={(e) => handleCurrencyInput(e.target.value, 'overdraft_limit')}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 flex items-center justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)} 
                  className="px-6 py-2 text-xs text-slate-500 uppercase tracking-widest"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="bg-[#3b597b] text-white px-8 py-2 rounded-lg text-xs font-bold uppercase tracking-widest shadow-lg flex items-center gap-2"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Salvar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Novo Cartão */}
      {isCardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[500px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 text-slate-800">
              <h2 className="text-lg font-bold uppercase tracking-tight">{editingCard ? 'Editar Cartão' : 'Vincular Novo Cartão'}</h2>
              <button onClick={() => { setIsCardModalOpen(false); setEditingCard(null); }} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            <form onSubmit={handleSaveCard} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Nome no Cartão / Identificador</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ex: Cartão Marketing - Ramon"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={cardFormData.name}
                    onChange={(e) => setCardFormData({...cardFormData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Últimos 4 Dígitos</label>
                  <input 
                    type="text" 
                    maxLength={4}
                    placeholder="4455"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={cardFormData.last_digits}
                    onChange={(e) => setCardFormData({...cardFormData, last_digits: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Bandeira</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                    value={cardFormData.brand}
                    onChange={(e) => setCardFormData({...cardFormData, brand: e.target.value})}
                  >
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                    <option value="Elo">Elo</option>
                    <option value="Amex">American Express</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Limite de Crédito</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-slate-400 text-sm">R$</span>
                    <input 
                      type="text" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 h-[44px] text-sm focus:outline-none"
                      value={displayMask(cardFormData.credit_limit)}
                      onChange={(e) => handleCurrencyInput(e.target.value, 'credit_limit', true)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Fechamento</label>
                      <input 
                        type="text" 
                        inputMode="numeric"
                        placeholder="Dia"
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                        value={cardFormData.closing_day}
                        onChange={(e) => setCardFormData({...cardFormData, closing_day: Number(e.target.value)})}
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Vencimento</label>
                      <input 
                        type="text" 
                        inputMode="numeric"
                        placeholder="Dia"
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                        value={cardFormData.due_day}
                        onChange={(e) => setCardFormData({...cardFormData, due_day: Number(e.target.value)})}
                      />
                   </div>
                </div>

                {String(cardFormData.card_type || '').toLowerCase().includes('credit') && (
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Subcategoria padrão da fatura</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 h-[44px] text-sm focus:outline-none"
                      value={cardFormData.statement_subcategory_id}
                      onChange={(e) => setCardFormData({ ...cardFormData, statement_subcategory_id: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {statementSubcategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="pt-6 flex items-center justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setIsCardModalOpen(false)} 
                  className="px-6 py-2 text-xs text-slate-500 uppercase tracking-widest"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="bg-[#3b597b] text-white px-8 py-2 rounded-lg text-xs font-bold uppercase tracking-widest shadow-lg flex items-center gap-2"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {editingCard ? 'Salvar Cartão' : 'Vincular Cartão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal de Detalhes da Conta */}
      {detailModalAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[600px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3 text-slate-800">
                <div className="h-10 w-10 bg-white border border-slate-100 rounded-xl flex items-center justify-center text-[#3b597b]">
                  <Building2 size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold uppercase tracking-tight">{detailModalAccount.name}</h2>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest">{detailModalAccount.bank_name}</p>
                </div>
              </div>
              <button onClick={() => setDetailModalAccount(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            <div className="p-8 space-y-8">
              {/* Grid de Informações */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                 <div>
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Agência</p>
                    <p className="text-sm text-slate-700">{detailModalAccount.agency || '---'}</p>
                 </div>
                 <div>
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Conta</p>
                    <p className="text-sm text-slate-700">{detailModalAccount.account_number || '---'}</p>
                 </div>
                 <div>
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Tipo</p>
                    <p className="text-sm text-slate-700 uppercase">{detailModalAccount.type}</p>
                 </div>
                 <div>
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Status</p>
                    <span className="text-[10px] text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                      ● Ativa
                    </span>
                 </div>
              </div>

              {/* Seção de Saldos */}
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-2">Saldo Disponível</p>
                    <h3 className="text-3xl text-slate-800 tracking-tighter">{formatCurrency(detailModalAccount.current_balance ?? detailModalAccount.balance)}</h3>
                    {isCurrentAccount(detailModalAccount) && Number(detailModalAccount.current_balance ?? detailModalAccount.balance ?? 0) < 0 && Number(detailModalAccount.overdraft_limit || 0) > 0 && (
                      <div className="mt-2">
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Restante do cheque especial</p>
                        <p className="text-sm font-medium text-blue-600">{formatCurrency(getOverdraftRemaining(detailModalAccount))}</p>
                      </div>
                    )}
                 </div>
                 <div className="space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                       <span className="text-[10px] text-slate-500 uppercase tracking-widest">Cheque Especial</span>
                       <span className="text-sm text-slate-700">{formatCurrency(detailModalAccount.overdraft_limit)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-[10px] text-slate-500 uppercase tracking-widest">Total com Limite</span>
                       <span className="text-sm text-slate-800 font-bold">{formatCurrency((detailModalAccount.current_balance ?? detailModalAccount.balance) + detailModalAccount.overdraft_limit)}</span>
                    </div>
                 </div>
              </div>

              {/* Lista de Cartões Detalhada */}
              <div className="space-y-4">
                 <h4 className="text-[11px] text-slate-800 uppercase tracking-widest border-l-2 border-[#3b597b] pl-3">Cartões Vinculados</h4>
                 {detailModalAccount.cards && detailModalAccount.cards.length > 0 ? (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {detailModalAccount.cards.map(card => (
                        <div key={card.id} className="p-4 rounded-xl border border-slate-100 bg-white hover:border-[#3b597b]/30 transition-all flex flex-col gap-3">
                           <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                 <CreditCard size={18} className="text-slate-400" />
                                 <span className="text-xs text-slate-700 uppercase tracking-tight">{card.name}</span>
                              </div>
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{card.brand}</span>
                           </div>
                           <div className="flex justify-between items-end">
                              <div>
                                 <p className="text-[9px] text-slate-400 uppercase tracking-widest">Final {card.last_digits}</p>
                                 <p className="text-[9px] text-slate-400 uppercase tracking-widest">Fecha dia {card.closing_day}</p>
                                 <p className="text-[9px] text-slate-400 uppercase tracking-widest">Vence dia {card.due_day}</p>
                              </div>
                              <div className="text-right">
                                 <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Gasto atual</p>
                                 <p className="text-sm text-red-600 mb-2">{formatCurrency(getCardSpentAmount(card))}</p>
                                 <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Limite</p>
                                 <p className="text-sm text-slate-800">{formatCurrency(card.credit_limit)}</p>
                              </div>
                           </div>
                           <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                              {isCreditCard(card) && (
                                <button
                                  onClick={() => handleCloseCard(card.id)}
                                  disabled={closingCardId === card.id}
                                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                                >
                                  {closingCardId === card.id ? 'Fechando...' : 'Fechar fatura'}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteCard(card.id)}
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-700 hover:bg-red-100"
                              >
                                Excluir
                              </button>
                           </div>
                        </div>
                      ))}
                   </div>
                 ) : (
                   <div className="text-center py-6 bg-slate-50 rounded-xl text-slate-400 text-[10px] uppercase tracking-widest">Nenhum cartão cadastrado nesta conta.</div>
                 )}
              </div>
            </div>

            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3">
              <button 
                onClick={() => setDetailModalAccount(null)}
                className="bg-[#3b597b] text-white px-8 py-2 rounded-lg text-xs uppercase tracking-widest shadow-md hover:bg-[#2e4763] transition-all"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}

      {statementCard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Fechar Fatura</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">{statementCard.name} | {statementCard.accountName || 'Conta vinculada'}</p>
              </div>
              <button onClick={() => { setStatementCard(null); setSelectedStatementRecordIds([]); }} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Lançamentos elegíveis</p>
                  <p className="text-sm text-slate-600">Somente lançamentos pagos deste cartão que ainda não foram usados em outra fatura.</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Total selecionado</p>
                  <p className="text-xl font-bold text-red-600">{formatCurrency(selectedStatementTotal)}</p>
                </div>
              </div>

              <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
                {eligibleStatementRecords.length === 0 ? (
                  <div className="px-6 py-10 text-center text-slate-400 text-xs uppercase tracking-widest">Nenhum lançamento elegível para este cartão.</div>
                ) : (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-100 bg-slate-50/70">
                        <th className="px-4 py-3"></th>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Lançamento</th>
                        <th className="px-4 py-3">Categoria</th>
                        <th className="px-4 py-3 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {eligibleStatementRecords.map((record) => {
                        const checked = selectedStatementRecordIds.includes(record.id);
                        return (
                          <tr key={record.id} className={checked ? 'bg-amber-50/60' : 'hover:bg-slate-50'}>
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={checked} onChange={() => toggleStatementRecord(record.id)} />
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600">{formatDate(record.created_at)}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-800">{record.description}</td>
                            <td className="px-4 py-3 text-xs text-slate-500 uppercase tracking-widest">{record.category || 'Geral'}</td>
                            <td className="px-4 py-3 text-right text-sm font-black text-red-600">{formatCurrency(Number(record.value || 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => { setStatementCard(null); setSelectedStatementRecordIds([]); }}
                className="px-6 py-2 text-xs text-slate-500 uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmStatement}
                disabled={closingCardId === statementCard.id || selectedStatementRecordIds.length === 0}
                className="bg-[#3b597b] text-white px-8 py-2 rounded-lg text-xs uppercase tracking-widest shadow-md hover:bg-[#2e4763] transition-all disabled:opacity-60"
              >
                {closingCardId === statementCard.id ? 'Gerando fatura...' : 'Gerar fatura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
