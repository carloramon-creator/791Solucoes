"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  CreditCard,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

type FinanceType = "revenue" | "expense";
type FinanceStatus = "paid" | "pending";
type Section = "lancamentos" | "abertos" | "fluxo";
type OpenViewKind = "payable" | "receivable";
type DifferenceHandling = "adjust" | "keep_open";
type PeriodFilter = "dia" | "semana" | "quinzena" | "mes" | "trimestre" | "semestre" | "ano";

type SourceKind = "all" | "account" | "card" | "external";

interface FinanceRecord {
  id: string;
  type: FinanceType;
  value: number;
  description: string;
  tenant_name?: string | null;
  category: string;
  status: FinanceStatus;
  created_at: string;
  payment_method?: string;
  bank_account_id?: string | null;
  bank_id?: string | null;
  metadata?: Record<string, any> | null;
  recurring_period?: string | null;
  is_recurring?: boolean;
  payment_link?: string | null;
  source_id?: string;
  source_label?: string;
  source_kind?: SourceKind;
}

interface BankCard {
  id: string;
  account_id: string;
  name: string;
  brand?: string;
  card_type?: string;
  last_digits?: string;
  credit_limit?: number;
  current_balance?: number;
}

interface BankAccount {
  id: string;
  name: string;
  bank_name?: string;
  agency?: string;
  account_number?: string;
  balance?: number;
  cards?: BankCard[];
}

interface Category {
  id: string;
  name: string;
  type: FinanceType;
  parent_id?: string | null;
}

interface SourceOption {
  id: string;
  kind: SourceKind;
  label: string;
  details?: string;
  amount: number;
  accountId?: string;
  cardId?: string;
}

const periodOptions: PeriodFilter[] = ["dia", "semana", "quinzena", "mes", "trimestre", "semestre", "ano"];
const paymentMethods = ["Pix", "Boleto", "CartaoCredito", "CartaoDebito", "Asaas", "Dinheiro", "Transferencia"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleDateString("pt-BR");
}

function startOfDay(date: Date) {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(date: Date) {
  const out = new Date(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPeriodLabel(period: PeriodFilter) {
  const labels: Record<PeriodFilter, string> = {
    dia: "Hoje",
    semana: "Semana",
    quinzena: "Quinzena",
    mes: "Mes",
    trimestre: "Trimestre",
    semestre: "Semestre",
    ano: "Ano",
  };
  return labels[period];
}

function getRangeByPeriod(period: PeriodFilter) {
  const now = new Date();
  const start = new Date(now);

  if (period === "dia") start.setDate(now.getDate());
  if (period === "semana") start.setDate(now.getDate() - 6);
  if (period === "quinzena") start.setDate(now.getDate() - 14);
  if (period === "mes") start.setDate(now.getDate() - 29);
  if (period === "trimestre") start.setDate(now.getDate() - 89);
  if (period === "semestre") start.setDate(now.getDate() - 179);
  if (period === "ano") start.setDate(now.getDate() - 364);

  return {
    start: toDateInput(startOfDay(start)),
    end: toDateInput(endOfDay(now)),
  };
}

function signedValue(record: FinanceRecord) {
  return record.type === "revenue" ? Number(record.value || 0) : -Number(record.value || 0);
}

function getDisplayDescription(record: FinanceRecord) {
  const tenantName = record.tenant_name || (record.metadata && typeof record.metadata === "object" ? record.metadata?.tenant_name : null);
  if (!tenantName) return record.description;
  return String(record.description || "").replace(/Tenant:\s*[0-9a-f-]+/i, `Tenant: ${tenantName}`);
}

export default function FinancePage() {
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);

  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [activeSection, setActiveSection] = useState<Section>("lancamentos");
  const [openViewKind, setOpenViewKind] = useState<OpenViewKind>("payable");
  const [filter, setFilter] = useState<"all" | "revenue" | "expense" | "payable">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [flowPeriod, setFlowPeriod] = useState<PeriodFilter>("dia");
  const [flowDateStart, setFlowDateStart] = useState(() => toDateInput(startOfDay(new Date())));
  const [flowDateEnd, setFlowDateEnd] = useState(() => toDateInput(endOfDay(new Date())));

  const [openPeriod, setOpenPeriod] = useState<PeriodFilter>("mes");
  const [openDateStart, setOpenDateStart] = useState(() => getRangeByPeriod("mes").start);
  const [openDateEnd, setOpenDateEnd] = useState(() => getRangeByPeriod("mes").end);

  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(["all"]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FinanceRecord | null>(null);

  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [settleRecord, setSettleRecord] = useState<FinanceRecord | null>(null);

  const [form, setForm] = useState({
    type: "expense" as FinanceType,
    description: "",
    value: "",
    category: "",
    payment_method: "Pix",
    sourceId: "",
    status: "paid" as FinanceStatus,
    date: toDateInput(new Date()),
    is_recurring: false,
    recurring_period: "monthly",
  });

  const [settleForm, setSettleForm] = useState({
    paidAmount: "",
    bankAccountId: "",
    paymentMethod: "Pix",
    differenceHandling: "adjust" as DifferenceHandling,
  });

  const accountById = useMemo(() => {
    const map = new Map<string, BankAccount>();
    accounts.forEach((acc) => map.set(acc.id, acc));
    return map;
  }, [accounts]);

  const cardById = useMemo(() => {
    const map = new Map<string, BankCard & { account: BankAccount }>();
    accounts.forEach((acc) => {
      (acc.cards || []).forEach((card) => map.set(card.id, { ...card, account: acc }));
    });
    return map;
  }, [accounts]);

  const resolveSourceForRecord = (record: FinanceRecord): { id: string; label: string; kind: SourceKind } => {
    const metadata = (record.metadata && typeof record.metadata === "object") ? record.metadata : {};
    const cardId = metadata?.card_id ? String(metadata.card_id) : "";

    if (cardId && cardById.has(cardId)) {
      const card = cardById.get(cardId)!;
      return {
        id: `card:${cardId}`,
        label: `${card.account.bank_name || "Banco"} - ${card.name}`,
        kind: "card",
      };
    }

    const bankAccountId = record.bank_account_id ? String(record.bank_account_id) : "";
    if (bankAccountId && accountById.has(bankAccountId)) {
      const account = accountById.get(bankAccountId)!;
      return {
        id: `account:${bankAccountId}`,
        label: `${account.bank_name || "Banco"} - ${account.name}`,
        kind: "account",
      };
    }

    const external = record.bank_id || metadata?.bank_id || record.payment_method || "Sem conta";
    return {
      id: `external:${String(external)}`,
      label: String(external),
      kind: "external",
    };
  };

  const normalizedRecords = useMemo(() => {
    return records.map((record) => {
      const source = resolveSourceForRecord(record);
      return {
        ...record,
        source_id: source.id,
        source_label: source.label,
        source_kind: source.kind,
      };
    });
  }, [records, accountById, cardById]);

  const sourceOptions = useMemo<SourceOption[]>(() => {
    const accountAdjustments = new Map<string, number>();
    const cardAdjustments = new Map<string, number>();
    const externalAdjustments = new Map<string, number>();

    normalizedRecords
      .filter((record) => record.status === "paid")
      .forEach((record) => {
        const signed = signedValue(record);
        if (record.source_kind === "card" && record.source_id?.startsWith("card:")) {
          const cardId = record.source_id.replace("card:", "");
          cardAdjustments.set(cardId, Number(cardAdjustments.get(cardId) || 0) + signed);
          return;
        }

        if (record.source_kind === "account" && record.source_id?.startsWith("account:")) {
          const accountId = record.source_id.replace("account:", "");
          accountAdjustments.set(accountId, Number(accountAdjustments.get(accountId) || 0) + signed);
          return;
        }

        if (record.source_kind === "external" && record.source_id) {
          externalAdjustments.set(record.source_id, Number(externalAdjustments.get(record.source_id) || 0) + signed);
        }
      });

    const accountSources: SourceOption[] = accounts.map((acc) => ({
      id: `account:${acc.id}`,
      kind: "account",
      label: `${acc.bank_name || "Banco"} - ${acc.name}`,
      details: [acc.agency ? `Ag. ${acc.agency}` : null, acc.account_number ? `Conta ${acc.account_number}` : null].filter(Boolean).join(" | "),
      amount: Number(acc.balance || 0) + Number(accountAdjustments.get(acc.id) || 0),
      accountId: acc.id,
    }));

    const cardSources: SourceOption[] = accounts.flatMap((acc) => (acc.cards || []).map((card) => ({
      id: `card:${card.id}`,
      kind: "card" as const,
      label: `${acc.bank_name || "Banco"} - ${card.name}`,
      details: [card.card_type ? String(card.card_type).toUpperCase() : null, card.last_digits ? `•••• ${card.last_digits}` : null].filter(Boolean).join(" | "),
      amount: Number(card.current_balance || 0) + Number(cardAdjustments.get(card.id) || 0),
      accountId: acc.id,
      cardId: card.id,
    })));

    const externalSources: SourceOption[] = Array.from(externalAdjustments.entries()).map(([id, amount]) => ({
      id,
      kind: "external",
      label: id.replace("external:", ""),
      details: "Origem externa",
      amount,
    }));

    const allWithoutVirtual = [...accountSources, ...cardSources, ...externalSources];
    const allAmount = allWithoutVirtual.reduce((sum, item) => sum + item.amount, 0);

    return [{ id: "all", kind: "all", label: "Todas as contas e cartoes", amount: allAmount }, ...allWithoutVirtual];
  }, [accounts, normalizedRecords]);

  const sourceById = useMemo(() => {
    const map = new Map<string, SourceOption>();
    sourceOptions.forEach((source) => map.set(source.id, source));
    return map;
  }, [sourceOptions]);

  const activeFlowSourceIds = useMemo(() => {
    if (selectedSourceIds.includes("all") || selectedSourceIds.length === 0) {
      return new Set(sourceOptions.filter((s) => s.id !== "all").map((s) => s.id));
    }
    return new Set(selectedSourceIds);
  }, [selectedSourceIds, sourceOptions]);

  const flowCurrentBalance = useMemo(() => {
    if (selectedSourceIds.includes("all") || selectedSourceIds.length === 0) {
      return sourceOptions.reduce((sum, source) => source.id === "all" ? sum : sum + source.amount, 0);
    }
    return selectedSourceIds.reduce((sum, id) => sum + Number(sourceById.get(id)?.amount || 0), 0);
  }, [selectedSourceIds, sourceById, sourceOptions]);

  const stats = useMemo(() => {
    const paid = normalizedRecords.filter((record) => record.status === "paid");
    const revenue = paid.filter((record) => record.type === "revenue").reduce((sum, r) => sum + Number(r.value || 0), 0);
    const expenses = paid.filter((record) => record.type === "expense").reduce((sum, r) => sum + Number(r.value || 0), 0);
    return {
      revenue,
      expenses,
      balance: flowCurrentBalance,
    };
  }, [normalizedRecords, flowCurrentBalance]);

  const filteredRecords = useMemo(() => {
    return normalizedRecords.filter((record) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "revenue" && record.type === "revenue") ||
        (filter === "expense" && record.type === "expense") ||
        (filter === "payable" && record.type === "expense" && record.status !== "paid");
      const text = `${getDisplayDescription(record)} ${record.category} ${record.source_label || ""}`.toLowerCase();
      const matchesSearch = text.includes(searchTerm.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [normalizedRecords, filter, searchTerm]);

  const openRecords = useMemo(() => {
    const start = startOfDay(new Date(`${openDateStart}T00:00:00`));
    const end = endOfDay(new Date(`${openDateEnd}T00:00:00`));
    return normalizedRecords
      .filter((record) => record.status !== "paid")
      .filter((record) => openViewKind === "payable" ? record.type === "expense" : record.type === "revenue")
      .filter((record) => {
        const date = new Date(record.created_at);
        return date >= start && date <= end;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [normalizedRecords, openViewKind, openDateStart, openDateEnd]);

  const flowRecords = useMemo(() => {
    const start = startOfDay(new Date(`${flowDateStart}T00:00:00`));
    const end = endOfDay(new Date(`${flowDateEnd}T00:00:00`));

    return normalizedRecords
      .filter((record) => record.status === "paid")
      .filter((record) => {
        const date = new Date(record.created_at);
        if (date < start || date > end) return false;
        return activeFlowSourceIds.has(record.source_id || "");
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [normalizedRecords, flowDateStart, flowDateEnd, activeFlowSourceIds]);

  const flowNet = useMemo(() => flowRecords.reduce((sum, record) => sum + signedValue(record), 0), [flowRecords]);
  const flowOpeningBalance = useMemo(() => Number((flowCurrentBalance - flowNet).toFixed(2)), [flowCurrentBalance, flowNet]);
  const flowClosingBalance = useMemo(() => Number((flowOpeningBalance + flowNet).toFixed(2)), [flowOpeningBalance, flowNet]);

  const flowRows = useMemo(() => {
    let running = flowOpeningBalance;
    return flowRecords.map((record) => {
      running += signedValue(record);
      return { record, running };
    });
  }, [flowRecords, flowOpeningBalance]);

  const sourceLabelSummary = useMemo(() => {
    if (selectedSourceIds.includes("all") || selectedSourceIds.length === 0) return "Todas as contas e cartoes";
    return selectedSourceIds.map((id) => sourceById.get(id)?.label || id).join(" | ");
  }, [selectedSourceIds, sourceById]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [recordsRes, accountsRes, categoriesRes] = await Promise.all([
        fetch("/api/system/finance-records", { cache: "no-store" }),
        fetch("/api/system/bank-accounts", { cache: "no-store" }),
        fetch("/api/system/categories", { cache: "no-store" }),
      ]);

      const recordsJson = await recordsRes.json();
      const accountsJson = await accountsRes.json();
      const categoriesJson = await categoriesRes.json();

      setRecords(recordsJson?.success ? recordsJson.records || [] : []);
      setAccounts(accountsJson?.success ? accountsJson.accounts || [] : []);
      setCategories(Array.isArray(categoriesJson) ? categoriesJson : []);
    } catch (err) {
      console.error("Erro ao carregar financeiro:", err);
      setRecords([]);
      setAccounts([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const next = getRangeByPeriod(openPeriod);
    setOpenDateStart(next.start);
    setOpenDateEnd(next.end);
  }, [openPeriod]);

  useEffect(() => {
    const next = getRangeByPeriod(flowPeriod);
    setFlowDateStart(next.start);
    setFlowDateEnd(next.end);
  }, [flowPeriod]);

  useEffect(() => {
    const section = searchParams.get("section");
    const kind = searchParams.get("kind");
    if (section === "abertos") {
      setActiveSection("abertos");
      if (kind === "receivable") setOpenViewKind("receivable");
      if (kind === "payable") setOpenViewKind("payable");
    }
  }, [searchParams]);

  const openNewModal = () => {
    setEditingRecord(null);
    setForm({
      type: "expense",
      description: "",
      value: "",
      category: "",
      payment_method: "Pix",
      sourceId: "",
      status: "paid",
      date: toDateInput(new Date()),
      is_recurring: false,
      recurring_period: "monthly",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (record: FinanceRecord) => {
    setEditingRecord(record);
    setForm({
      type: record.type,
      description: getDisplayDescription(record) || "",
      value: String(Number(record.value || 0)),
      category: record.category || "",
      payment_method: record.payment_method || "Pix",
      sourceId: record.source_id || (record.bank_id ? `external:${record.bank_id}` : ""),
      status: record.status,
      date: toDateInput(new Date(record.created_at)),
      is_recurring: Boolean(record.is_recurring),
      recurring_period: record.recurring_period || "monthly",
    });
    setIsModalOpen(true);
  };

  const openSettleModal = (record: FinanceRecord) => {
    setSettleRecord(record);
    setSettleForm({
      paidAmount: String(Number(record.value || 0)),
      bankAccountId: record.bank_account_id || "",
      paymentMethod: record.payment_method || "Pix",
      differenceHandling: "adjust",
    });
    setIsSettleModalOpen(true);
  };

  const parseSourceSelection = (sourceId: string) => {
    if (!sourceId) {
      return {
        bankAccountId: null as string | null,
        bankId: null as string | null,
        metadataPatch: {} as Record<string, any>,
      };
    }
    if (sourceId.startsWith("external:")) {
      return {
        bankAccountId: null,
        bankId: sourceId.replace("external:", ""),
        metadataPatch: {
          card_id: null,
          card_name: null,
        },
      };
    }

    if (sourceId.startsWith("card:")) {
      const cardId = sourceId.replace("card:", "");
      const card = cardById.get(cardId);
      return {
        bankAccountId: card?.account_id || null,
        bankId: null,
        metadataPatch: {
          card_id: cardId,
          card_name: card?.name || null,
        },
      };
    }

    if (sourceId.startsWith("account:")) {
      const accountId = sourceId.replace("account:", "");
      return {
        bankAccountId: accountId,
        bankId: null,
        metadataPatch: {
          card_id: null,
          card_name: null,
        },
      };
    }

    return { bankAccountId: null, bankId: null, metadataPatch: {} };
  };

  const handleSave = async () => {
    if (!form.description.trim()) {
      alert("Informe a descricao do lancamento.");
      return;
    }
    if (!form.value || Number(form.value) <= 0) {
      alert("Informe um valor valido.");
      return;
    }

    setSaving(true);
    try {
      const { bankAccountId, bankId, metadataPatch } = parseSourceSelection(form.sourceId);
      const previousMetadata = (editingRecord?.metadata && typeof editingRecord.metadata === "object") ? editingRecord.metadata : {};

      const payload = {
        type: form.type,
        description: form.description,
        value: Number(form.value),
        category: form.category || "Geral",
        payment_method: form.payment_method,
        status: form.status,
        bank_account_id: bankAccountId,
        bank_id: bankId,
        created_at: new Date(`${form.date}T12:00:00`).toISOString(),
        is_recurring: form.is_recurring,
        recurring_period: form.is_recurring ? form.recurring_period : null,
        metadata: {
          ...previousMetadata,
          ...metadataPatch,
        },
      };

      const response = await fetch("/api/system/finance-records", {
        method: editingRecord ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRecord ? { id: editingRecord.id, ...payload } : payload),
      });

      const json = await response.json();
      if (!json?.success) throw new Error(json?.error || "Falha ao salvar lancamento.");

      setIsModalOpen(false);
      setEditingRecord(null);
      await loadData();
    } catch (err: any) {
      alert(`Erro ao salvar: ${err?.message || "desconhecido"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = confirm("Tem certeza que deseja excluir este lancamento?");
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/system/finance-records?id=${id}`, { method: "DELETE" });
      const json = await response.json();
      if (!json?.success) throw new Error(json?.error || "Falha ao excluir.");
      await loadData();
    } catch (err: any) {
      alert(`Erro ao excluir: ${err?.message || "desconhecido"}`);
    }
  };

  const handleSettle = async () => {
    if (!settleRecord) return;
    if (!settleForm.paidAmount || Number(settleForm.paidAmount) <= 0) {
      alert("Informe um valor pago valido.");
      return;
    }

    setSettling(true);
    try {
      const response = await fetch("/api/system/finance-records/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: settleRecord.id,
          paidAmount: Number(settleForm.paidAmount),
          bankAccountId: settleForm.bankAccountId || null,
          paymentMethod: settleForm.paymentMethod,
          differenceHandling: settleForm.differenceHandling,
        }),
      });

      const json = await response.json();
      if (!json?.success) throw new Error(json?.error || "Falha ao baixar lancamento.");

      setIsSettleModalOpen(false);
      setSettleRecord(null);
      await loadData();
    } catch (err: any) {
      alert(`Erro ao baixar: ${err?.message || "desconhecido"}`);
    } finally {
      setSettling(false);
    }
  };

  const toggleFlowSource = (sourceId: string) => {
    if (sourceId === "all") {
      setSelectedSourceIds(["all"]);
      return;
    }

    setSelectedSourceIds((prev) => {
      const withoutAll = prev.filter((id) => id !== "all");
      const exists = withoutAll.includes(sourceId);
      const next = exists ? withoutAll.filter((id) => id !== sourceId) : [...withoutAll, sourceId];
      if (next.length === 0) return ["all"];
      return next;
    });
  };

  const sourceOptionsForForm = sourceOptions.filter((source) => source.id !== "all");

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Receipt className="text-[#3b597b]" size={24} />
            Controle Financeiro Blindado
          </h1>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
            Fluxo de caixa consolidado com contas e cartoes da holding.
          </p>
        </div>
        <button
          onClick={openNewModal}
          className="bg-[#3b597b] text-white px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-[#2e4763] transition-all uppercase tracking-widest shadow-lg shadow-blue-900/10"
        >
          <Plus size={14} /> Novo lancamento
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Receitas (Pagos)</p>
          <h3 className="text-2xl font-bold text-emerald-600 tracking-tight mt-1">{formatCurrency(stats.revenue)}</h3>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Despesas (Pagos)</p>
          <h3 className="text-2xl font-bold text-red-600 tracking-tight mt-1">{formatCurrency(stats.expenses)}</h3>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Saldo disponivel</p>
          <h3 className="text-2xl font-bold text-slate-800 tracking-tight mt-1">{formatCurrency(stats.balance)}</h3>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/40 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveSection("lancamentos")}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === "lancamentos" ? "bg-[#3b597b] text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              Lancamentos
            </button>
            <button
              onClick={() => { setActiveSection("abertos"); setOpenViewKind("payable"); }}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === "abertos" && openViewKind === "payable" ? "bg-red-500 text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              Contas a pagar em aberto
            </button>
            <button
              onClick={() => { setActiveSection("abertos"); setOpenViewKind("receivable"); }}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === "abertos" && openViewKind === "receivable" ? "bg-emerald-500 text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              Contas a receber em aberto
            </button>
            <button
              onClick={() => setActiveSection("fluxo")}
              className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${activeSection === "fluxo" ? "bg-blue-500 text-white" : "text-slate-500 hover:text-slate-700"}`}
            >
              Fluxo de caixa
            </button>
          </div>

          {activeSection === "lancamentos" ? (
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setFilter("all")} className={`text-[10px] px-3 py-1.5 rounded-full font-bold uppercase ${filter === "all" ? "bg-[#3b597b] text-white" : "bg-white text-slate-500 border border-slate-200"}`}>Tudo</button>
                <button onClick={() => setFilter("revenue")} className={`text-[10px] px-3 py-1.5 rounded-full font-bold uppercase ${filter === "revenue" ? "bg-emerald-500 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>Receitas</button>
                <button onClick={() => setFilter("expense")} className={`text-[10px] px-3 py-1.5 rounded-full font-bold uppercase ${filter === "expense" ? "bg-red-500 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>Despesas</button>
                <button onClick={() => setFilter("payable")} className={`text-[10px] px-3 py-1.5 rounded-full font-bold uppercase ${filter === "payable" ? "bg-amber-500 text-white" : "bg-white text-slate-500 border border-slate-200"}`}>Contas a pagar</button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="bg-white border border-slate-200 rounded-xl pl-9 pr-4 h-[38px] text-xs w-full md:w-72"
                  placeholder="Pesquisar descricao, categoria ou conta..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {periodOptions.map((period) => (
                  <button
                    key={period}
                    onClick={() => activeSection === "fluxo" ? setFlowPeriod(period) : setOpenPeriod(period)}
                    className={`text-[10px] px-3 py-1.5 rounded-full uppercase tracking-widest font-bold ${(activeSection === "fluxo" ? flowPeriod : openPeriod) === period ? "bg-[#3b597b] text-white" : "bg-white border border-slate-200 text-slate-500"}`}
                  >
                    {getPeriodLabel(period)}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-slate-500">
                <Calendar size={13} /> Inicio
                <input type="date" value={activeSection === "fluxo" ? flowDateStart : openDateStart} onChange={(e) => activeSection === "fluxo" ? setFlowDateStart(e.target.value) : setOpenDateStart(e.target.value)} className="h-[34px] rounded-lg border border-slate-200 px-2 text-xs normal-case" />
                Fim
                <input type="date" value={activeSection === "fluxo" ? flowDateEnd : openDateEnd} onChange={(e) => activeSection === "fluxo" ? setFlowDateEnd(e.target.value) : setOpenDateEnd(e.target.value)} className="h-[34px] rounded-lg border border-slate-200 px-2 text-xs normal-case" />
              </div>

              {activeSection === "fluxo" && (
                <div className="space-y-3">
                  <div className="relative inline-block">
                    <button
                      onClick={() => setSourceDropdownOpen((prev) => !prev)}
                      className="h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold uppercase tracking-widest text-slate-700 inline-flex items-center gap-2"
                    >
                      <Filter size={13} />
                      Contas e cartoes
                    </button>

                    {sourceDropdownOpen && (
                      <div className="absolute z-20 mt-2 w-[420px] max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-xl p-2 space-y-1">
                        {sourceOptions.map((source) => {
                          const checked = source.id === "all" ? selectedSourceIds.includes("all") : selectedSourceIds.includes(source.id);
                          return (
                            <label key={source.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 cursor-pointer">
                              <input type="checkbox" checked={checked} onChange={() => toggleFlowSource(source.id)} className="mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-slate-800 uppercase truncate">{source.label}</p>
                                <p className="text-[10px] text-slate-500">{source.details || ""}</p>
                              </div>
                              <p className="text-[10px] font-black text-slate-600">{formatCurrency(source.amount)}</p>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Saldo inicial</p>
                      <p className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(flowOpeningBalance)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Lancamentos</p>
                      <p className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(flowNet)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-blue-50 p-4">
                      <p className="text-[10px] uppercase tracking-widest font-black text-blue-600">Saldo final</p>
                      <p className="mt-1 text-xl font-bold text-blue-700">{formatCurrency(flowClosingBalance)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {activeSection === "lancamentos" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-50 bg-slate-50/50">
                  <th className="px-6 py-3">Data / Status</th>
                  <th className="px-6 py-3">Descricao / Categoria</th>
                  <th className="px-6 py-3">Conta</th>
                  <th className="px-6 py-3">Metodo</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                  <th className="px-6 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400"><Loader2 className="animate-spin mx-auto" /></td></tr>
                ) : filteredRecords.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400 text-xs uppercase tracking-widest">Nenhum lancamento encontrado.</td></tr>
                ) : filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-xs">
                      <p className="text-slate-700">{formatDate(record.created_at)}</p>
                      <span className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${record.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {record.status === "paid" ? "Pago" : "Pendente"}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <p className="text-sm font-semibold text-slate-800">{getDisplayDescription(record)}</p>
                      <p className="text-[10px] uppercase tracking-wider font-black text-slate-500">{record.category || "Geral"}</p>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-600 uppercase tracking-widest font-bold">{record.source_label || "Sem conta"}</td>
                    <td className="px-6 py-3 text-xs text-slate-600 uppercase tracking-widest font-bold">{record.payment_method || "Pix"}</td>
                    <td className={`px-6 py-3 text-right text-sm font-black ${record.type === "revenue" ? "text-emerald-600" : "text-red-600"}`}>{record.type === "revenue" ? "+" : "-"} {formatCurrency(Number(record.value || 0))}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openEditModal(record)} className="text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1"><Pencil size={12} />Editar</button>
                        {record.status !== "paid" && (
                          <button onClick={() => openSettleModal(record)} className="text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1"><CheckCircle2 size={12} />Baixar</button>
                        )}
                        <button onClick={() => handleDelete(record.id)} className="text-slate-400 hover:text-red-600 border border-slate-200 hover:border-red-200 bg-white hover:bg-red-50 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1"><Trash2 size={12} />Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeSection === "abertos" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-50 bg-slate-50/50">
                  <th className="px-6 py-3">Data</th>
                  <th className="px-6 py-3">Lancamento</th>
                  <th className="px-6 py-3">Conta</th>
                  <th className="px-6 py-3">Categoria</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                  <th className="px-6 py-3 text-right">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400"><Loader2 className="animate-spin mx-auto" /></td></tr>
                ) : openRecords.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400 text-xs uppercase tracking-widest">Nenhuma conta em aberto para o periodo.</td></tr>
                ) : openRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-xs text-slate-700">{formatDate(record.created_at)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-slate-800">{getDisplayDescription(record)}</td>
                    <td className="px-6 py-3 text-xs text-slate-600 uppercase tracking-widest font-bold">{record.source_label || "Sem conta"}</td>
                    <td className="px-6 py-3 text-xs text-slate-600">{record.category || "Geral"}</td>
                    <td className={`px-6 py-3 text-right text-sm font-black ${record.type === "revenue" ? "text-emerald-600" : "text-red-600"}`}>{record.type === "revenue" ? "+" : "-"} {formatCurrency(Number(record.value || 0))}</td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => openSettleModal(record)} className="text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1"><CheckCircle2 size={12} />Baixar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeSection === "fluxo" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black border-b border-slate-50 bg-slate-50/50">
                  <th className="px-6 py-3">Data</th>
                  <th className="px-6 py-3">Lancamento</th>
                  <th className="px-6 py-3">Conta</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                  <th className="px-6 py-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                <tr className="bg-slate-50/50">
                  <td className="px-6 py-3 text-xs text-slate-500">Saldo inicial</td>
                  <td className="px-6 py-3 text-xs font-bold text-slate-700">Saldo final do dia anterior</td>
                  <td className="px-6 py-3 text-xs text-slate-500">{sourceLabelSummary}</td>
                  <td className="px-6 py-3 text-right text-xs font-bold text-slate-600">{formatCurrency(0)}</td>
                  <td className="px-6 py-3 text-right text-sm font-black text-slate-700">{formatCurrency(flowOpeningBalance)}</td>
                </tr>

                {flowRows.length ? flowRows.map(({ record, running }) => (
                  <tr key={record.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-xs text-slate-700">{formatDate(record.created_at)}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-slate-800">{getDisplayDescription(record)}</td>
                    <td className="px-6 py-3 text-xs text-slate-600 uppercase tracking-widest font-bold">{record.source_label || "Sem conta"}</td>
                    <td className={`px-6 py-3 text-right text-sm font-black ${record.type === "revenue" ? "text-emerald-600" : "text-red-600"}`}>{record.type === "revenue" ? "+" : "-"} {formatCurrency(Number(record.value || 0))}</td>
                    <td className="px-6 py-3 text-right text-sm font-black text-slate-700">{formatCurrency(running)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-slate-400 text-xs uppercase tracking-widest">Nenhum lancamento efetivado no periodo.</td>
                  </tr>
                )}

                <tr className="bg-slate-50/50">
                  <td className="px-6 py-3 text-xs text-slate-500">Saldo final</td>
                  <td className="px-6 py-3 text-xs font-bold text-slate-700">Saldo inicial + lancamentos do periodo</td>
                  <td className="px-6 py-3 text-xs text-slate-500">{sourceLabelSummary}</td>
                  <td className="px-6 py-3 text-right text-xs font-bold text-slate-600">{formatCurrency(flowNet)}</td>
                  <td className="px-6 py-3 text-right text-sm font-black text-blue-700">{formatCurrency(flowClosingBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800">{editingRecord ? "Editar lancamento" : "Novo lancamento"}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Tipo</label>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <button onClick={() => setForm((p) => ({ ...p, type: "revenue" }))} className={`flex-1 h-[36px] text-xs font-bold uppercase ${form.type === "revenue" ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-500"}`}>Receita</button>
                  <button onClick={() => setForm((p) => ({ ...p, type: "expense" }))} className={`flex-1 h-[36px] text-xs font-bold uppercase ${form.type === "expense" ? "bg-red-50 text-red-700" : "bg-white text-slate-500"}`}>Despesa</button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Valor</label>
                <input type="number" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Descricao</label>
                <input type="text" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm" />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Data</label>
                <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm" />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as FinanceStatus }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="paid">Pago</option>
                  <option value="pending">Pendente</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Categoria</label>
                <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">Selecione...</option>
                  {categories.filter((cat) => cat.type === form.type).map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Conta / Cartao</label>
                <select value={form.sourceId} onChange={(e) => setForm((p) => ({ ...p, sourceId: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">Sem conta</option>
                  {sourceOptionsForForm.map((source) => (
                    <option key={source.id} value={source.id}>{source.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Metodo</label>
                <select value={form.payment_method} onChange={(e) => setForm((p) => ({ ...p, payment_method: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm">
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex gap-3">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 h-[38px] rounded-lg border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-[2] h-[38px] rounded-lg bg-[#3b597b] text-white text-xs font-black uppercase tracking-widest disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettleModalOpen && settleRecord && (
        <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800">Baixar lancamento</h2>
              <button onClick={() => setIsSettleModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{getDisplayDescription(settleRecord)}</p>
                <p className="text-xs text-slate-500 mt-1">Valor original: {formatCurrency(Number(settleRecord.value || 0))}</p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Valor pago</label>
                <input type="number" value={settleForm.paidAmount} onChange={(e) => setSettleForm((p) => ({ ...p, paidAmount: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm" />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Metodo</label>
                <select value={settleForm.paymentMethod} onChange={(e) => setSettleForm((p) => ({ ...p, paymentMethod: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm">
                  {paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] uppercase tracking-widest font-black text-slate-500 mb-1">Conta bancaria</label>
                <select value={settleForm.bankAccountId} onChange={(e) => setSettleForm((p) => ({ ...p, bankAccountId: e.target.value }))} className="w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">Sem conta bancaria</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{`${account.bank_name || "Banco"} - ${account.name}`}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="radio" checked={settleForm.differenceHandling === "adjust"} onChange={() => setSettleForm((p) => ({ ...p, differenceHandling: "adjust" }))} />
                  Fechar lancamento com valor pago.
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="radio" checked={settleForm.differenceHandling === "keep_open"} onChange={() => setSettleForm((p) => ({ ...p, differenceHandling: "keep_open" }))} />
                  Manter diferenca em aberto.
                </label>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex gap-3 justify-end">
              <button onClick={() => setIsSettleModalOpen(false)} className="h-[38px] rounded-lg border border-slate-200 px-4 text-xs font-bold uppercase tracking-widest text-slate-600">Cancelar</button>
              <button onClick={handleSettle} disabled={settling} className="h-[38px] rounded-lg bg-emerald-600 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60 inline-flex items-center gap-2">
                {settling ? <Loader2 className="animate-spin" size={14} /> : <Wallet size={14} />} Confirmar baixa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
