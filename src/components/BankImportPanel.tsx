"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Landmark, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { holdingAuthFetch } from "@/lib/holding-auth-fetch";

type FinanceType = "revenue" | "expense";

interface Category {
  id: string;
  name: string;
  type: FinanceType;
  parent_id?: string | null;
}

interface SyncAccount {
  id: string;
  name: string;
  bank_name?: string | null;
  provider?: string | null;
  sync_enabled: boolean;
  sync_start_date?: string | null;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  provider_balance?: number | null;
  provider_balance_at?: string | null;
}

interface PendingItem {
  id: string;
  type: FinanceType;
  value: number;
  description: string;
  date: string;
  bank_account_id?: string | null;
  counterparty?: string | null;
  suggested_pattern: string;
}

interface PendingSettlement {
  id: string;
  bank_account_id: string;
  tx_date: string;
  amount: number;
  description: string;
}

interface PendingReview {
  id: string;
  bank_account_id: string;
  tx_date: string;
  amount: number;
  description: string;
  counterparty?: string | null;
  review_reason?: string | null;
}

interface ReviewCandidate {
  id: string;
  status: string | null;
  record_type: string | null;
  value: number;
  description: string | null;
  created_at: string | null;
  bank_account_id: string | null;
  payment_method: string | null;
  category: string | null;
  bank_id: string | null;
  source: string | null;
  blocked_reason: string | null;
}

type ReviewDraft = {
  expanded: boolean;
  loading: boolean;
  saving: boolean;
  candidates: ReviewCandidate[];
  offset: number;
  pageSize: number;
  total: number;
  error?: string;
};

interface Rule {
  id: string;
  pattern: string;
  record_type: FinanceType;
  category_name: string;
  bank_account_id?: string | null;
  hits: number;
}

type Draft = { categoryId: string; createRule: boolean; pattern: string; saving?: boolean; error?: string };

const PROVIDER_LABEL: Record<string, string> = { asaas: "Asaas", inter: "Inter", cora: "Cora" };
const PROVIDER_HINT: Record<string, string> = {
  inter: "Sincronização do Inter não habilitada para esta conta.",
  cora: "Falta ativar a Integração Direta da Cora (certificado + client id).",
};

const EMPTY_REVIEW: ReviewDraft = {
  expanded: false, loading: false, saving: false, candidates: [], offset: 0, pageSize: 20, total: 0,
};

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(v) ? v : 0);
const dateBr = (v?: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "--");
const dateTimeBr = (v?: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca");

export default function BankImportPanel({
  categories,
  systemBalances,
  onChanged,
}: {
  categories: Category[];
  systemBalances: Record<string, number>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SyncAccount[]>([]);
  const [interImportEnabled, setInterImportEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [settlements, setSettlements] = useState<PendingSettlement[]>([]);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const loadSequence = useRef(0);

  const load = useCallback(() => {
    const sequence = ++loadSequence.current;
    return holdingAuthFetch(`/api/system/bank-sync?reviewOffset=${reviewOffset}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Falha ao carregar o extrato.");
        if (!Array.isArray(json.pendingReviews) || !Number.isSafeInteger(json.pendingReviewCount) || json.pendingReviewCount < 0) {
          throw new Error("O servidor retornou uma fila de revisão inválida.");
        }
        if (sequence !== loadSequence.current) return;
        if (reviewOffset > 0 && reviewOffset >= json.pendingReviewCount) {
          setReviewOffset(json.pendingReviewCount ? Math.floor((json.pendingReviewCount - 1) / 100) * 100 : 0);
          return;
        }
        setAccounts(json.accounts || []);
        setInterImportEnabled(typeof json.interImportEnabled === "boolean" ? json.interImportEnabled : null);
        setPending(json.pending || []);
        setSettlements(json.pendingSettlement || []);
        setReviews(json.pendingReviews);
        setReviewCount(json.pendingReviewCount);
        setRules(json.rules || []);
      })
      .catch((err: unknown) => {
        if (sequence === loadSequence.current) {
          setInterImportEnabled(null);
          setMessage(err instanceof Error ? err.message : "Falha ao carregar o extrato.");
        }
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
  }, [reviewOffset]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const accountName = (id?: string | null) => accounts.find((a) => a.id === id)?.name || "--";

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await holdingAuthFetch("/api/system/bank-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Falha ao sincronizar.");
      const results = (json.results || []) as Array<{ account: string; imported: number; reconciled: number; autoClassified: number; pendingReview?: number; error?: string; skipped?: string }>;
      setMessage(results.length
        ? results.map((r) => r.error ? `${r.account}: erro — ${r.error}` : r.skipped ? `${r.account}: ${r.skipped}` : `${r.account}: ${r.imported} novas (${r.reconciled} conciliadas, ${r.autoClassified} classificadas por regra${r.pendingReview ? `, ${r.pendingReview} em revisão` : ""})`).join(" · ")
        : "Nenhuma conta com extrato habilitado.");
      await refresh();
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao sincronizar.");
    } finally {
      setSyncing(false);
    }
  };

  const draftOf = (item: PendingItem): Draft => drafts[item.id] || { categoryId: "", createRule: true, pattern: item.suggested_pattern };
  const setDraft = (id: string, patch: Partial<Draft>, item: PendingItem) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(item), ...prev[id], ...patch } }));

  const classify = async (item: PendingItem) => {
    const draft = draftOf(item);
    if (!draft.categoryId) {
      setDraft(item.id, { error: "Escolha a classe/subclasse." }, item);
      return;
    }
    setDraft(item.id, { saving: true, error: undefined }, item);
    try {
      const res = await holdingAuthFetch("/api/system/bank-sync/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: item.id, categoryId: draft.categoryId, createRule: draft.createRule, pattern: draft.pattern }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Falha ao classificar.");
      if (json.similarApplied > 0) setMessage(`Regra aplicada também a ${json.similarApplied} lançamento(s) semelhante(s).`);
      await refresh();
      onChanged();
    } catch (err) {
      setDraft(item.id, { saving: false, error: err instanceof Error ? err.message : "Falha ao classificar." }, item);
    }
  };

  const removeRule = async (id: string) => {
    const res = await holdingAuthFetch(`/api/system/bank-sync/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const setReviewDraft = (id: string, patch: Partial<ReviewDraft>) =>
    setReviewDrafts((prev) => ({ ...prev, [id]: { ...EMPTY_REVIEW, ...prev[id], ...patch } }));

  const loadCandidates = async (item: PendingReview, offset = 0) => {
    setReviewDraft(item.id, { expanded: true, loading: true, error: undefined });
    try {
      const params = new URLSearchParams({ transactionId: item.id, offset: String(offset) });
      const res = await holdingAuthFetch(`/api/system/bank-sync/reconcile?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Falha ao buscar possíveis correspondências.");
      if (!Array.isArray(json.candidates) || !Number.isSafeInteger(json.total) ||
          !Number.isSafeInteger(json.offset) || !Number.isSafeInteger(json.pageSize)) {
        throw new Error("O servidor retornou uma lista de correspondências inválida.");
      }
      if (offset > 0 && json.candidates.length === 0) {
        await loadCandidates(item, 0);
        return;
      }
      setReviewDraft(item.id, {
        loading: false,
        candidates: json.candidates,
        total: json.total,
        offset: json.offset,
        pageSize: json.pageSize,
      });
    } catch (err) {
      setReviewDraft(item.id, { loading: false, error: err instanceof Error ? err.message : "Falha ao buscar possíveis correspondências." });
    }
  };

  const resolveReview = async (item: PendingReview, action: "link" | "create", candidate?: ReviewCandidate) => {
    const account = accountName(item.bank_account_id);
    const question = action === "create"
      ? `Criar um novo lançamento pago de ${brl(Math.abs(Number(item.amount)))} na conta ${account}? Isso alterará o saldo.`
      : candidate?.status === "pending"
        ? `Vincular ao lançamento pendente? Ele será atribuído à conta ${account}, continuará pendente e deverá receber baixa normalmente.`
        : `Vincular ao lançamento pago, sem criar outro?${candidate?.bank_account_id ? "" : ` Ele será atribuído à conta ${account}, o que pode alterar os saldos das contas.`}`;
    if (!window.confirm(question)) return;

    setReviewDraft(item.id, { saving: true, error: undefined });
    try {
      const res = await holdingAuthFetch("/api/system/bank-sync/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: item.id, action, recordId: candidate?.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Falha ao conciliar.");
      setMessage(action === "create"
        ? "Novo lançamento criado."
        : candidate?.status === "pending" ? "Movimentação vinculada. O lançamento continua pendente de baixa." : "Movimentação vinculada ao lançamento existente.");
      await refresh();
      onChanged();
    } catch (err) {
      setReviewDraft(item.id, { error: err instanceof Error ? err.message : "Falha ao conciliar." });
    } finally {
      setReviewDraft(item.id, { saving: false });
    }
  };

  const optionsFor = (type: FinanceType) => {
    const roots = categories.filter((c) => !c.parent_id && c.type === type);
    return roots.map((root) => ({ root, children: categories.filter((c) => c.parent_id === root.id) }));
  };

  const count = pending.length + settlements.length + reviewCount;

  return (
    <>
      <button
        onClick={() => { setOpen(true); void refresh(); }}
        className="relative bg-white text-[#3b597b] border border-[#3b597b]/20 px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-[#f3f7fb] transition-all uppercase tracking-widest"
      >
        <Landmark size={14} /> Extrato bancário
        {count > 0 && (
          <span className="ml-1 bg-amber-400 text-amber-950 rounded-full px-2 py-0.5 text-[10px] font-black">{count}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl my-8 text-[calc(1rem+2pt)] leading-normal" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-[calc(1.125rem+2pt)] font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2"><Landmark size={18} className="text-[#3b597b]" /> Extrato bancário</h2>
                <p className="text-[calc(0.75rem+2pt)] text-slate-500">Lançamentos novos são pagos e aguardam classificação. Possíveis duplicados do Inter aguardam sua decisão, sem afetar o saldo.</p>
              </div>
              <div className="flex items-center justify-between gap-2 shrink-0">
                <button onClick={syncNow} disabled={syncing} className="bg-[#3b597b] text-white px-4 py-2 rounded-xl text-[calc(10px+2pt)] font-bold flex items-center gap-2 uppercase tracking-widest whitespace-nowrap disabled:opacity-60">
                  {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronizar agora
                </button>
                <button onClick={() => setOpen(false)} aria-label="Fechar extrato" className="p-2 text-slate-400 hover:text-slate-700"><X size={18} /></button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {message && <div className="text-[calc(0.75rem+2pt)] bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-700">{message}</div>}

              <section className="overflow-x-auto">
                <h3 className="text-[calc(10px+2pt)] uppercase tracking-widest font-black text-slate-500 mb-2">Contas</h3>
                <p className="text-[calc(10px+2pt)] text-slate-400 mb-1 lg:hidden">Deslize para ver todas as colunas.</p>
                <table className="w-full min-w-[900px] table-fixed text-[calc(0.75rem+2pt)]">
                  <thead className="text-[calc(10px+2pt)] uppercase tracking-widest text-slate-400">
                    <tr className="text-left">
                      <th className="w-[15%] py-1.5 pr-3 whitespace-nowrap">Conta</th><th className="w-[15%] pr-3 whitespace-nowrap">Extrato</th><th className="w-[11%] pr-3 whitespace-nowrap">Desde</th><th className="w-[19%] pr-3 leading-tight">Última sincronização</th>
                      <th className="w-[14%] text-right pl-2 leading-tight">Saldo no banco</th><th className="w-[15%] text-right pl-2 leading-tight">Saldo no sistema</th><th className="w-[11%] text-right pl-2 whitespace-nowrap">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => {
                      const provider = String(acc.provider || "");
                      const interServerUnavailable = provider === "inter" && interImportEnabled !== true;
                      const active = acc.sync_enabled && !interServerUnavailable;
                      const inactiveHint = provider === "inter" && interImportEnabled === null
                        ? "Não foi possível confirmar a liberação do Inter no servidor."
                        : provider === "inter" && interImportEnabled === false
                          ? "Importação do Inter bloqueada no servidor."
                          : PROVIDER_HINT[provider] || "";
                      const inactiveLabel = acc.sync_enabled && interServerUnavailable
                        ? interImportEnabled === null ? "Estado desconhecido" : "Bloqueado"
                        : "Não habilitado";
                      const bankBalance = acc.provider_balance === null || acc.provider_balance === undefined ? null : Number(acc.provider_balance);
                      const systemBalance = systemBalances[acc.id];
                      const diff = bankBalance === null || systemBalance === undefined ? null : Number((systemBalance - bankBalance).toFixed(2));
                      return (
                        <tr key={acc.id} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3 font-semibold text-slate-700">{acc.name}</td>
                          <td className="pr-3">
                            {active
                              ? <span className="text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 font-bold">{PROVIDER_LABEL[provider] || provider} ativo</span>
                              : <span className="text-slate-500 bg-slate-100 rounded-full px-2 py-0.5" title={inactiveHint}>{inactiveLabel}</span>}
                            {acc.last_sync_error && <span className="ml-2 text-red-600" title={acc.last_sync_error}><AlertTriangle size={12} className="inline" /> erro</span>}
                          </td>
                          <td className="pr-3">{acc.sync_enabled ? dateBr(acc.sync_start_date ? `${acc.sync_start_date}T12:00:00` : null) : "--"}</td>
                          <td className="pr-3">
                            {active ? dateTimeBr(acc.last_sync_at) : (
                              <>
                                {inactiveHint || "--"}
                                {acc.last_sync_at && <span className="block text-slate-400">Última: {dateTimeBr(acc.last_sync_at)}</span>}
                              </>
                            )}
                          </td>
                          <td className="text-right pl-2">{bankBalance === null ? "--" : brl(bankBalance)}</td>
                          <td className="text-right pl-2">{systemBalance === undefined ? "--" : brl(systemBalance)}</td>
                          <td className={`text-right pl-2 font-bold ${diff === null ? "text-slate-400" : Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-amber-600"}`}>
                            {diff === null ? "--" : Math.abs(diff) < 0.01 ? "OK" : brl(diff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>

              {settlements.length > 0 && (
                <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <h3 className="text-[calc(10px+2pt)] uppercase tracking-widest font-black text-amber-700 mb-2">No banco, mas pendente no sistema ({settlements.length})</h3>
                  <p className="text-[calc(0.75rem+2pt)] text-amber-800 mb-2">A movimentação foi vinculada, mas o lançamento continua pendente. Dê baixa no lançamento correspondente.</p>
                  <ul className="text-[calc(0.75rem+2pt)] space-y-1">
                    {settlements.map((s) => (
                      <li key={s.id}>{dateBr(`${s.tx_date}T12:00:00`)} · {accountName(s.bank_account_id)} · {s.description} · <b>{brl(Number(s.amount))}</b></li>
                    ))}
                  </ul>
                </section>
              )}

              {reviews.length > 0 && (
                <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <h3 className="text-[calc(10px+2pt)] uppercase tracking-widest font-black text-amber-700 mb-2">Possíveis duplicados do Inter ({reviewCount})</h3>
                  <p className="text-[calc(0.75rem+2pt)] text-amber-800 mb-3">
                    Estas movimentações ainda não alteram o saldo. Compare os lançamentos e escolha vincular ou criar um novo.
                    {reviewCount > 100 ? " Exibindo até 100 por página." : ""}
                  </p>
                  <div className="space-y-3">
                    {reviews.map((item) => {
                      const draft = reviewDrafts[item.id] || EMPTY_REVIEW;
                      return (
                        <div key={item.id} className="bg-white rounded-xl border border-amber-200 p-3 text-[calc(0.75rem+2pt)]">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-bold text-slate-800">
                                {dateBr(`${item.tx_date}T12:00:00`)} · {accountName(item.bank_account_id)} · {item.description}
                              </p>
                              {item.counterparty && <p className="text-slate-500 mt-1">{item.counterparty}</p>}
                              {item.review_reason && <p className="text-amber-700 mt-1">{item.review_reason}</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <b className={Number(item.amount) > 0 ? "text-emerald-700" : "text-red-700"}>
                                {Number(item.amount) > 0 ? "+" : "-"}{brl(Math.abs(Number(item.amount)))}
                              </b>
                              <button
                                onClick={() => draft.expanded ? setReviewDraft(item.id, { expanded: false }) : void loadCandidates(item)}
                                disabled={draft.saving}
                                className="border border-amber-300 text-amber-800 rounded-lg px-3 py-1 font-bold disabled:opacity-60"
                              >
                                {draft.expanded ? "Ocultar" : "Ver correspondências"}
                              </button>
                              <button
                                onClick={() => void resolveReview(item, "create")}
                                disabled={draft.saving}
                                className="bg-[#3b597b] text-white rounded-lg px-3 py-1 font-bold disabled:opacity-60"
                              >
                                Criar lançamento
                              </button>
                            </div>
                          </div>
                          {draft.error && <p role="alert" className="text-red-700 mt-2">{draft.error}</p>}
                          {draft.expanded && (
                            <div className="mt-3 border-t border-slate-100 pt-2">
                              {draft.loading ? (
                                <Loader2 size={16} className="animate-spin text-slate-400" />
                              ) : draft.candidates.length === 0 ? (
                                <p className="text-slate-500">Nenhuma correspondência disponível nesta página. Confira antes de criar um lançamento.</p>
                              ) : (
                                <ul className="space-y-2">
                                  {draft.candidates.map((candidate) => (
                                    <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 rounded-lg p-2">
                                      <div>
                                        <span className="font-semibold text-slate-700">{candidate.description || "Sem descrição"}</span>
                                        <span className="text-slate-500"> · {brl(Number(candidate.value))} · {dateBr(candidate.created_at)} · {candidate.bank_account_id ? accountName(candidate.bank_account_id) : "Sem conta"} · {candidate.payment_method || "Forma não informada"}{candidate.category ? ` · ${candidate.category}` : ""}{candidate.bank_id || candidate.source ? ` · Origem: ${candidate.bank_id || candidate.source}` : ""}</span>
                                        <span className="block text-slate-500 mt-0.5">
                                          {candidate.status === "pending" ? "Pendente: não será baixado automaticamente." : candidate.status === "paid" ? "Pago: ao vincular, não será criado outro lançamento." : "Situação não reconhecida: ajuste o lançamento antes de vincular."}
                                          {candidate.blocked_reason === "cartao" ? " Lançamento de cartão: ajuste a origem antes de vincular." : ""}
                                          {candidate.blocked_reason === "tipo_invalido" ? ` Tipo: ${candidate.record_type || "não informado"}.` : ""}
                                          {candidate.blocked_reason && candidate.blocked_reason !== "cartao" ? " Confira situação, tipo, valor e vínculo antes de vincular." : ""}
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => void resolveReview(item, "link", candidate)}
                                        disabled={draft.saving || Boolean(candidate.blocked_reason)}
                                        className="bg-emerald-600 text-white rounded-lg px-3 py-1 font-bold disabled:opacity-40"
                                      >
                                        Vincular
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {draft.total > draft.pageSize && (
                                <div className="flex justify-end items-center gap-3 mt-2 text-slate-500">
                                  <span>{draft.offset + 1}–{Math.min(draft.offset + draft.pageSize, draft.total)} de {draft.total}</span>
                                  <button disabled={draft.offset === 0 || draft.loading} onClick={() => void loadCandidates(item, Math.max(0, draft.offset - draft.pageSize))} className="disabled:opacity-40">Anterior</button>
                                  <button disabled={draft.offset + draft.pageSize >= draft.total || draft.loading} onClick={() => void loadCandidates(item, draft.offset + draft.pageSize)} className="disabled:opacity-40">Próxima</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {reviewCount > 100 && (
                    <div className="flex justify-end items-center gap-3 mt-3 text-[calc(0.75rem+2pt)] text-amber-800">
                      <span>{reviewOffset + 1}–{Math.min(reviewOffset + reviews.length, reviewCount)} de {reviewCount}</span>
                      <button
                        disabled={reviewOffset === 0 || loading}
                        onClick={() => { setLoading(true); setReviewOffset(Math.max(0, reviewOffset - 100)); }}
                        className="disabled:opacity-40"
                      >
                        Anterior
                      </button>
                      <button
                        disabled={reviewOffset + reviews.length >= reviewCount || loading}
                        onClick={() => { setLoading(true); setReviewOffset(reviewOffset + 100); }}
                        className="disabled:opacity-40"
                      >
                        Próxima
                      </button>
                    </div>
                  )}
                </section>
              )}

              <section className="overflow-x-auto">
                <h3 className="text-[calc(10px+2pt)] uppercase tracking-widest font-black text-slate-500 mb-2">A classificar ({pending.length})</h3>
                {!loading && pending.length > 0 && <p className="text-[calc(10px+2pt)] text-slate-400 mb-1 lg:hidden">Deslize para ver todas as colunas.</p>}
                {loading ? (
                  <div className="py-6 text-center text-slate-400"><Loader2 size={18} className="animate-spin inline" /></div>
                ) : pending.length === 0 ? (
                  <p className="text-[calc(0.75rem+2pt)] text-slate-400 py-3">Nada pendente. Tudo classificado.</p>
                ) : (
                  <table className="w-full min-w-[920px] text-[calc(0.75rem+2pt)]">
                    <thead className="text-[calc(10px+2pt)] uppercase tracking-widest text-slate-400">
                      <tr className="text-left">
                        <th className="py-1.5 w-24 pr-2">Data</th><th className="w-24">Conta</th><th>Descrição</th><th className="text-right w-24">Valor</th>
                        <th className="w-52 pl-3">Classe / subclasse</th><th className="w-56">Regra (aprender)</th><th className="w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((item) => {
                        const draft = draftOf(item);
                        return (
                          <tr key={item.id} className="border-t border-slate-100 align-top">
                            <td className="py-1.5 pr-2 whitespace-nowrap">{dateBr(item.date)}</td>
                            <td>{accountName(item.bank_account_id)}</td>
                            <td className="pr-2 text-slate-700">{item.description}{item.counterparty ? <span className="block text-slate-400">{item.counterparty}</span> : null}</td>
                            <td className={`text-right font-bold ${item.type === "revenue" ? "text-emerald-600" : "text-red-600"}`}>{item.type === "revenue" ? "+" : "-"}{brl(item.value)}</td>
                            <td className="pl-3">
                              <select
                                value={draft.categoryId}
                                onChange={(e) => setDraft(item.id, { categoryId: e.target.value, error: undefined }, item)}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1 bg-white"
                              >
                                <option value="">Escolher…</option>
                                {optionsFor(item.type).map(({ root, children }) => (
                                  <optgroup key={root.id} label={root.name}>
                                    <option value={root.id}>{root.name}</option>
                                    {children.map((child) => <option key={child.id} value={child.id}>{root.name} › {child.name}</option>)}
                                  </optgroup>
                                ))}
                              </select>
                              {draft.error && <span className="block text-red-600 mt-1">{draft.error}</span>}
                            </td>
                            <td className="pl-2">
                              <label className="flex items-center gap-1 text-slate-600">
                                <input type="checkbox" checked={draft.createRule} onChange={(e) => setDraft(item.id, { createRule: e.target.checked }, item)} />
                                Sempre que contiver:
                              </label>
                              {draft.createRule && (
                                <input
                                  value={draft.pattern}
                                  onChange={(e) => setDraft(item.id, { pattern: e.target.value }, item)}
                                  className="w-full border border-slate-200 rounded-lg px-2 py-1 mt-1"
                                />
                              )}
                            </td>
                            <td className="text-right">
                              <button onClick={() => classify(item)} disabled={draft.saving} className="bg-emerald-600 text-white rounded-lg px-3 py-1 font-bold disabled:opacity-60">
                                {draft.saving ? <Loader2 size={12} className="animate-spin inline" /> : "Salvar"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="overflow-x-auto">
                <h3 className="text-[calc(10px+2pt)] uppercase tracking-widest font-black text-slate-500 mb-2">Regras aprendidas ({rules.length})</h3>
                {rules.length === 0 ? (
                  <p className="text-[calc(0.75rem+2pt)] text-slate-400">Ao classificar com &quot;Sempre que contiver&quot;, o sistema passa a classificar sozinho os próximos lançamentos parecidos.</p>
                ) : (
                  <table className="w-full min-w-[700px] text-[calc(0.75rem+2pt)]">
                    <tbody>
                      {rules.map((rule) => (
                        <tr key={rule.id} className="border-t border-slate-100">
                          <td className="py-1.5">“{rule.pattern}”</td>
                          <td>{rule.record_type === "revenue" ? "Receita" : "Despesa"}</td>
                          <td className="font-semibold">{rule.category_name}</td>
                          <td>{rule.bank_account_id ? accountName(rule.bank_account_id) : "Todas as contas"}</td>
                          <td className="text-slate-400">{rule.hits} uso(s)</td>
                          <td className="text-right"><button onClick={() => removeRule(rule.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
