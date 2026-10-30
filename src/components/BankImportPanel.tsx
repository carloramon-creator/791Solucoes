"use client";

import { useCallback, useEffect, useState } from "react";
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
  inter: "Aguardando acesso à API do Inter e implementação da conciliação antes de habilitar.",
  cora: "Falta ativar a Integração Direta da Cora (certificado + client id).",
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
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SyncAccount[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [settlements, setSettlements] = useState<PendingSettlement[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await holdingAuthFetch("/api/system/bank-sync");
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Falha ao carregar o extrato.");
      setAccounts(json.accounts || []);
      setPending(json.pending || []);
      setSettlements(json.pendingSettlement || []);
      setRules(json.rules || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao carregar o extrato.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      const results = (json.results || []) as Array<{ account: string; imported: number; reconciled: number; autoClassified: number; error?: string; skipped?: string }>;
      setMessage(results.length
        ? results.map((r) => r.error ? `${r.account}: erro — ${r.error}` : r.skipped ? `${r.account}: ${r.skipped}` : `${r.account}: ${r.imported} novas (${r.reconciled} conciliadas, ${r.autoClassified} classificadas por regra)`).join(" · ")
        : "Nenhuma conta com extrato habilitado.");
      await load();
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
      await load();
      onChanged();
    } catch (err) {
      setDraft(item.id, { saving: false, error: err instanceof Error ? err.message : "Falha ao classificar." }, item);
    }
  };

  const removeRule = async (id: string) => {
    const res = await holdingAuthFetch(`/api/system/bank-sync/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const optionsFor = (type: FinanceType) => {
    const roots = categories.filter((c) => !c.parent_id && c.type === type);
    return roots.map((root) => ({ root, children: categories.filter((c) => c.parent_id === root.id) }));
  };

  const count = pending.length + settlements.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative bg-white text-[#3b597b] border border-[#3b597b]/20 px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-[#f3f7fb] transition-all uppercase tracking-widest"
      >
        <Landmark size={14} /> Extrato bancário
        {count > 0 && (
          <span className="ml-1 bg-amber-400 text-amber-950 rounded-full px-2 py-0.5 text-[10px] font-black">{count}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2"><Landmark size={18} className="text-[#3b597b]" /> Extrato bancário</h2>
                <p className="text-xs text-slate-500">Importado automaticamente de hora em hora. Lançamentos novos entram como pagos e ficam aqui até receberem classe/subclasse.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={syncNow} disabled={syncing} className="bg-[#3b597b] text-white px-4 py-2 rounded-xl text-[10px] font-bold flex items-center gap-2 uppercase tracking-widest disabled:opacity-60">
                  {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sincronizar agora
                </button>
                <button onClick={() => setOpen(false)} className="p-2 text-slate-400 hover:text-slate-700"><X size={18} /></button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {message && <div className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-700">{message}</div>}

              <section>
                <h3 className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-2">Contas</h3>
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                    <tr className="text-left">
                      <th className="py-1.5">Conta</th><th>Extrato</th><th>Desde</th><th>Última sincronização</th>
                      <th className="text-right">Saldo no banco</th><th className="text-right">Saldo no sistema</th><th className="text-right">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => {
                      const provider = String(acc.provider || "");
                      const bankBalance = acc.provider_balance === null || acc.provider_balance === undefined ? null : Number(acc.provider_balance);
                      const systemBalance = systemBalances[acc.id];
                      const diff = bankBalance === null || systemBalance === undefined ? null : Number((systemBalance - bankBalance).toFixed(2));
                      return (
                        <tr key={acc.id} className="border-t border-slate-100">
                          <td className="py-1.5 font-semibold text-slate-700">{acc.name}</td>
                          <td>
                            {acc.sync_enabled
                              ? <span className="text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 font-bold">{PROVIDER_LABEL[provider] || provider} ativo</span>
                              : <span className="text-slate-500 bg-slate-100 rounded-full px-2 py-0.5" title={PROVIDER_HINT[provider] || ""}>Não habilitado</span>}
                            {acc.last_sync_error && <span className="ml-2 text-red-600" title={acc.last_sync_error}><AlertTriangle size={12} className="inline" /> erro</span>}
                          </td>
                          <td>{acc.sync_enabled ? dateBr(acc.sync_start_date ? `${acc.sync_start_date}T12:00:00` : null) : "--"}</td>
                          <td>{acc.sync_enabled ? dateTimeBr(acc.last_sync_at) : (PROVIDER_HINT[provider] || "--")}</td>
                          <td className="text-right">{bankBalance === null ? "--" : brl(bankBalance)}</td>
                          <td className="text-right">{systemBalance === undefined ? "--" : brl(systemBalance)}</td>
                          <td className={`text-right font-bold ${diff === null ? "text-slate-400" : Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-amber-600"}`}>
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
                  <h3 className="text-[10px] uppercase tracking-widest font-black text-amber-700 mb-2">Recebido no banco, mas pendente no sistema ({settlements.length})</h3>
                  <p className="text-xs text-amber-800 mb-2">O dinheiro entrou, mas a cobrança continua pendente aqui. Dê baixa em Contas a receber.</p>
                  <ul className="text-xs space-y-1">
                    {settlements.map((s) => (
                      <li key={s.id}>{dateBr(`${s.tx_date}T12:00:00`)} · {accountName(s.bank_account_id)} · {s.description} · <b>{brl(Number(s.amount))}</b></li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-2">A classificar ({pending.length})</h3>
                {loading ? (
                  <div className="py-6 text-center text-slate-400"><Loader2 size={18} className="animate-spin inline" /></div>
                ) : pending.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3">Nada pendente. Tudo classificado.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                      <tr className="text-left">
                        <th className="py-1.5 w-20">Data</th><th className="w-24">Conta</th><th>Descrição</th><th className="text-right w-24">Valor</th>
                        <th className="w-56 pl-3">Classe / subclasse</th><th className="w-56">Regra (aprender)</th><th className="w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((item) => {
                        const draft = draftOf(item);
                        return (
                          <tr key={item.id} className="border-t border-slate-100 align-top">
                            <td className="py-1.5">{dateBr(item.date)}</td>
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

              <section>
                <h3 className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-2">Regras aprendidas ({rules.length})</h3>
                {rules.length === 0 ? (
                  <p className="text-xs text-slate-400">Ao classificar com &quot;Sempre que contiver&quot;, o sistema passa a classificar sozinho os próximos lançamentos parecidos.</p>
                ) : (
                  <table className="w-full text-xs">
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
