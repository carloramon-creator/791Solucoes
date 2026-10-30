"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { holdingAuthFetch } from "@/lib/holding-auth-fetch";

export interface FinanceCategory {
  id: string;
  name: string;
  type: "revenue" | "expense";
  parent_id?: string | null;
}

function isCategory(value: unknown): value is FinanceCategory {
  return Boolean(value && typeof value === "object" &&
    "id" in value && typeof value.id === "string" && value.id &&
    "name" in value && typeof value.name === "string" && value.name.trim() &&
    "type" in value && (value.type === "revenue" || value.type === "expense") &&
    "parent_id" in value && (value.parent_id === null || typeof value.parent_id === "string"));
}

export default function FinanceCategoryDialog({
  type, categories, initialParentId, onClose, onCreated,
}: {
  type: FinanceCategory["type"];
  categories: FinanceCategory[];
  initialParentId: string;
  onClose: () => void;
  onCreated: (created: FinanceCategory[], selectedId: string) => void;
}) {
  const [mode, setMode] = useState<"category" | "subcategory">(initialParentId ? "subcategory" : "category");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(initialParentId);
  const [subcategoryName, setSubcategoryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const roots = categories.filter((category) => !category.parent_id && category.type === type);

  useEffect(() => {
    const previous = document.activeElement;
    nameRef.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  async function save() {
    if (busyRef.current) return;
    if (!name.trim() || (mode === "subcategory" && !roots.some((root) => root.id === parentId))) {
      setError(mode === "subcategory" ? "Informe o nome e escolha a classe principal." : "Informe o nome da classe.");
      return;
    }
    busyRef.current = true;
    dialogRef.current?.focus();
    setSaving(true);
    setError("");
    try {
      const withSubcategory = mode === "category" && Boolean(subcategoryName.trim());
      const response = await holdingAuthFetch("/api/system/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), type, parent_id: mode === "subcategory" ? parentId : null,
          use_webhook: false,
          ...(withSubcategory ? { subcategory_name: subcategoryName.trim() } : {}),
        }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        throw new Error(json && typeof json === "object" && "error" in json && typeof json.error === "string"
          ? json.error : "Falha ao criar classe/subclasse.");
      }
      let created: FinanceCategory[];
      if (withSubcategory) {
        if (!json || typeof json !== "object" || !("categories" in json) ||
            !Array.isArray(json.categories) || json.categories.length !== 2 || !json.categories.every(isCategory)) {
          throw new Error("O servidor retornou uma classe/subclasse inválida. Confira o cadastro antes de tentar novamente.");
        }
        created = json.categories;
      } else {
        if (!isCategory(json)) throw new Error("O servidor retornou uma classe/subclasse inválida. Confira o cadastro antes de tentar novamente.");
        created = [json];
      }
      const root = created.find((category) => !category.parent_id);
      const selected = withSubcategory
        ? created.find((category) => category.parent_id === root?.id)
        : created[0];
      if (created.some((category) => category.type !== type) || !selected ||
          selected.name !== (withSubcategory ? subcategoryName.trim() : name.trim()) ||
          (withSubcategory && root?.name !== name.trim()) ||
          (!withSubcategory && (selected.parent_id || null) !== (mode === "subcategory" ? parentId : null))) {
        throw new Error("A classe/subclasse criada não corresponde ao pedido. Confira o cadastro antes de tentar novamente.");
      }
      onCreated(created, selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar classe/subclasse.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-60";

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 text-[calc(0.75rem+2pt)] leading-normal"
      onClick={(event) => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!busyRef.current) onClose();
        }
        if (event.key === "Tab") {
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])");
          if (!controls?.length) { event.preventDefault(); return; }
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
            event.preventDefault(); first.focus();
          }
        }
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="finance-category-title" tabIndex={-1} className="my-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 id="finance-category-title" className="font-bold text-slate-800">Nova classe / subclasse</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Fechar criação de classe" className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40"><X size={18} /></button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="space-y-4 px-5 py-4">
            <p className="text-slate-500">Tipo do lançamento: <b>{type === "revenue" ? "Receita" : "Despesa"}</b>. Após criar, use Salvar na linha para classificar o lançamento.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={saving} aria-pressed={mode === "category"} onClick={() => { setMode("category"); setError(""); }} className={`rounded-xl border px-3 py-2 font-semibold ${mode === "category" ? "border-[#3b597b] bg-slate-100 text-[#3b597b]" : "border-slate-200 text-slate-500"}`}>Nova classe</button>
              <button type="button" disabled={saving} aria-pressed={mode === "subcategory"} onClick={() => { setMode("subcategory"); setError(""); }} className={`rounded-xl border px-3 py-2 font-semibold ${mode === "subcategory" ? "border-[#3b597b] bg-slate-100 text-[#3b597b]" : "border-slate-200 text-slate-500"}`}>Nova subclasse</button>
            </div>
            {mode === "subcategory" && (
              <label className="block space-y-1">
                <span className="font-semibold text-slate-600">Classe principal</span>
                <select required disabled={saving} value={parentId} onChange={(event) => setParentId(event.target.value)} className={inputClass}>
                  <option value="">Escolher classe…</option>
                  {roots.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}
                </select>
                {roots.length === 0 && <span className="block text-slate-500">Crie primeiro uma classe na opção Nova classe.</span>}
              </label>
            )}
            <label className="block space-y-1">
              <span className="font-semibold text-slate-600">{mode === "category" ? "Nome da classe" : "Nome da subclasse"}</span>
              <input ref={nameRef} required disabled={saving} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
            </label>
            {mode === "category" && (
              <label className="block space-y-1">
                <span className="font-semibold text-slate-600">Subclasse inicial (opcional)</span>
                <input disabled={saving} value={subcategoryName} onChange={(event) => setSubcategoryName(event.target.value)} className={inputClass} />
                <span className="block text-slate-500">Preencha para criar a classe e a subclasse juntas.</span>
              </label>
            )}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-red-700">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 disabled:opacity-40">Cancelar</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-[#3b597b] px-4 py-2 font-bold text-white disabled:opacity-60">
              {saving && <Loader2 size={16} className="animate-spin" />} Criar e selecionar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
