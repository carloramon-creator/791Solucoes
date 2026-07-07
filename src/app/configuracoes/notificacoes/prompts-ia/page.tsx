'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { ConfigTabs } from '@/components/ConfigTabs';
import { ArrowLeft, Loader2, Plus, RotateCcw, Save, Sparkles, ShieldCheck } from 'lucide-react';

type PromptConfig = {
  chave: string;
  titulo: string;
  descricao: string | null;
  uso_em: string[];
  system_prompt: string;
  user_prompt_template: string;
  ativo: boolean;
  versao: number;
  updated_by: string | null;
  updated_at: string | null;
};

const SAMPLE_CONTEXT = JSON.stringify({
  status_consulta: 'aprovado',
  score: 734,
  limite_sugerido_api: 15000,
  motivo: 'Consulta concluida com sucesso',
  valor_pedido: 12792.98,
  sinais_estruturados: {
    pendencias_financeiras: 0,
    protestos: 0,
    bacen: 0,
    acoes_civeis: 0,
    falencias: 0,
    restricoes: 0,
    situacao_receita: 'REGULAR',
    score_relatorio: 734,
    sinais_textuais: ['Consulta sem ocorrencias relevantes'],
  },
}, null, 2);

const DEFAULTS: PromptConfig = {
  chave: 'credito_analise',
  titulo: 'Análise de crédito',
  descricao: 'Prompt usado na análise financeira de crédito',
  uso_em: ['orcamentos.credito'],
  system_prompt: '',
  user_prompt_template: '',
  ativo: true,
  versao: 1,
  updated_by: null,
  updated_at: null,
};

export default function PromptsIaPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [defaults, setDefaults] = useState(DEFAULTS);
  const [form, setForm] = useState<PromptConfig>(DEFAULTS);
  const [list, setList] = useState<PromptConfig[]>([DEFAULTS]);
  const [selectedKey, setSelectedKey] = useState(DEFAULTS.chave);
  const [newKey, setNewKey] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const hydratePrompt = (config: any, fallback: PromptConfig): PromptConfig => ({
    chave: config?.chave || fallback.chave,
    titulo: config?.titulo || fallback.titulo,
    descricao: config?.descricao ?? fallback.descricao,
    uso_em: Array.isArray(config?.uso_em) ? config.uso_em.map((item: any) => String(item || '').trim()).filter(Boolean) : fallback.uso_em,
    system_prompt: config?.system_prompt || fallback.system_prompt || '',
    user_prompt_template: config?.user_prompt_template || fallback.user_prompt_template || '',
    ativo: config?.ativo ?? true,
    versao: config?.versao || 1,
    updated_by: config?.updated_by || null,
    updated_at: config?.updated_at || null,
  });

  const loadPrompt = async (key?: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.push('/login');
      return;
    }

    const query = key ? `?chave=${encodeURIComponent(key)}` : '';
    const res = await fetch(`/api/admin/ai-prompts${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || 'Nao foi possivel carregar o prompt.');
    }

    const nextDefaults = hydratePrompt(payload.defaults || DEFAULTS, DEFAULTS);
    const current = hydratePrompt(payload.config || DEFAULTS, nextDefaults);
    const nextList = Array.isArray(payload.list)
      ? payload.list.map((item: any) => hydratePrompt(item, DEFAULTS))
      : [current];

    setDefaults(nextDefaults);
    setForm(current);
    setSelectedKey(current.chave);
    setList(nextList);
    setSavedAt(current.updated_at ? new Date(current.updated_at).toLocaleString('pt-BR') : null);
  };

  useEffect(() => {
    let active = true;

    async function init() {
      await loadPrompt();
      if (!active) return;
      setLoading(false);
    }

    init().catch((err) => {
      if (!active) return;
      setError(err?.message || 'Nao foi possivel carregar o prompt.');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [router, supabase]);

  const preview = useMemo(() => {
    const template = form.user_prompt_template || defaults.user_prompt_template;
    return template.includes('{{contexto_json}}')
      ? template.replace(/\{\{contexto_json\}\}/g, SAMPLE_CONTEXT)
      : `${template}\n\n${SAMPLE_CONTEXT}`;
  }, [defaults.user_prompt_template, form.user_prompt_template]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/admin/ai-prompts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          chave: selectedKey,
          titulo: form.titulo,
          descricao: form.descricao,
          uso_em: form.uso_em,
          system_prompt: form.system_prompt,
          user_prompt_template: form.user_prompt_template,
          ativo: form.ativo,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Nao foi possivel salvar.');
      }

      const config = payload.config || form;
      const nextDefaults = hydratePrompt(payload.defaults || defaults, defaults);
      const nextConfig = hydratePrompt(config, form);
      const nextList = Array.isArray(payload.list)
        ? payload.list.map((item: any) => hydratePrompt(item, DEFAULTS))
        : list;

      setDefaults(nextDefaults);
      setForm(nextConfig);
      setList(nextList);
      setSelectedKey(nextConfig.chave);
      setSavedAt(new Date().toLocaleString('pt-BR'));
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel salvar o prompt.');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPrompt = async (key: string) => {
    setError('');
    setLoading(true);
    try {
      await loadPrompt(key);
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel carregar o prompt selecionado.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePrompt = async () => {
    const cleanKey = String(newKey || '').trim().toLowerCase();
    const cleanTitle = String(newTitle || '').trim();

    if (!cleanKey || !/^[a-z0-9_]+$/.test(cleanKey)) {
      setError('Defina uma chave válida usando apenas letras minúsculas, números e underscore.');
      return;
    }

    setCreating(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/admin/ai-prompts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          chave: cleanKey,
          titulo: cleanTitle || cleanKey.replace(/_/g, ' '),
          descricao: form.descricao,
          uso_em: form.uso_em,
          system_prompt: defaults.system_prompt || form.system_prompt,
          user_prompt_template: defaults.user_prompt_template || form.user_prompt_template,
          ativo: true,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Nao foi possivel criar o prompt.');
      }

      const nextDefaults = hydratePrompt(payload.defaults || DEFAULTS, DEFAULTS);
      const nextConfig = hydratePrompt(payload.config || DEFAULTS, nextDefaults);
      const nextList = Array.isArray(payload.list)
        ? payload.list.map((item: any) => hydratePrompt(item, DEFAULTS))
        : [nextConfig];

      setDefaults(nextDefaults);
      setForm(nextConfig);
      setList(nextList);
      setSelectedKey(nextConfig.chave);
      setNewKey('');
      setNewTitle('');
      setSavedAt(new Date().toLocaleString('pt-BR'));
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel criar o prompt.');
    } finally {
      setCreating(false);
    }
  };

  const restoreDefaults = () => {
    setForm((current) => ({
      ...current,
      titulo: defaults.titulo,
      descricao: defaults.descricao,
      system_prompt: defaults.system_prompt,
      user_prompt_template: defaults.user_prompt_template,
      ativo: true,
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#3b597b]" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => router.push('/configuracoes/notificacoes')}
            className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-[#3b597b] transition-colors mb-3"
          >
            <ArrowLeft size={14} />
            Voltar para notificações
          </button>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Sparkles className="text-[#3b597b]" size={24} />
            Prompts de IA
          </h1>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
            Gerencie múltiplos prompts por contexto (crédito, custos, estoque e outros).
          </p>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
          <span className={`px-3 py-2 rounded-full ${form.ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {form.ativo ? 'Prompt ativo' : 'Prompt desativado'}
          </span>
          <span className="px-3 py-2 rounded-full bg-blue-50 text-blue-700">v{form.versao}</span>
          <span className="px-3 py-2 rounded-full bg-slate-100 text-slate-600">Holding</span>
        </div>
      </div>

      <ConfigTabs />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 xl:grid-cols-4">
          <aside className="p-6 border-b xl:border-b-0 xl:border-r border-slate-100 bg-slate-50/70 space-y-4">
            <div>
              <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Lista de prompts</label>
              <select
                value={selectedKey}
                onChange={(e) => handleSelectPrompt(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
              >
                {list.map((item) => (
                  <option key={item.chave} value={item.chave}>
                    {item.titulo} ({item.chave})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Novo prompt</p>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                placeholder="ex: risco_fornecedor"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
              />
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Título do prompt"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
              />
              <button
                type="button"
                onClick={handleCreatePrompt}
                disabled={creating}
                className="inline-flex w-full items-center justify-center gap-2 h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Criar prompt
              </button>
            </div>
          </aside>

          <div className="xl:col-span-2 p-6 space-y-5 border-b xl:border-b-0 xl:border-r border-slate-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Chave</label>
                <input
                  value={form.chave}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none bg-slate-50 text-slate-500"
                />
              </div>
              <div>
                <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Título</label>
                <input
                  value={form.titulo}
                  onChange={(e) => setForm((prev) => ({ ...prev, titulo: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Descrição</label>
                <input
                  value={form.descricao || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Onde será utilizado</label>
                <input
                  value={form.uso_em.join(', ')}
                  onChange={(e) => setForm((prev) => ({
                    ...prev,
                    uso_em: Array.from(new Set(
                      e.target.value
                        .split(',')
                        .map((item) => item.trim().toLowerCase())
                        .filter((item) => /^[a-z0-9._-]+$/.test(item))
                    )),
                  }))}
                  placeholder="ex: orcamentos.credito, financeiro.custos, estoque.analise"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Prompt do sistema</label>
                  <span className="text-[9px] uppercase tracking-[0.2em] text-slate-300 font-bold">Somente JSON</span>
                </div>
                <textarea
                  value={form.system_prompt}
                  onChange={(e) => setForm((prev) => ({ ...prev, system_prompt: e.target.value }))}
                  rows={18}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-mono leading-6 text-slate-700 outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Prompt do usuário</label>
                  <span className="text-[9px] uppercase tracking-[0.2em] text-slate-300 font-bold">Use {'{{contexto_json}}'}</span>
                </div>
                <textarea
                  value={form.user_prompt_template}
                  onChange={(e) => setForm((prev) => ({ ...prev, user_prompt_template: e.target.value }))}
                  rows={18}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-mono leading-6 text-slate-700 outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-[#3b597b] text-white text-[10px] font-black uppercase tracking-widest shadow-sm disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar prompt
              </button>
              <button
                type="button"
                onClick={restoreDefaults}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase tracking-widest"
              >
                <RotateCcw size={14} />
                Restaurar padrão
              </button>
              <label className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-[10px] font-black uppercase tracking-widest cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.ativo}
                  onChange={(e) => setForm((prev) => ({ ...prev, ativo: e.target.checked }))}
                  className="accent-[#3b597b]"
                />
                Ativo
              </label>
              <div className="text-[10px] font-medium text-slate-400">
                {savedAt ? `Salvo em ${savedAt}` : form.updated_at ? `Última alteração: ${new Date(form.updated_at).toLocaleString('pt-BR')}` : 'Nenhuma alteração salva ainda'}
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium">
                {error}
              </div>
            )}
          </div>

          <aside className="p-6 space-y-4 bg-slate-50/80">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-600" />
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Prévia</h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                O placeholder {'{{contexto_json}}'} será substituído pelo contexto real da consulta.
              </p>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono">
{preview}
              </pre>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Atalhos</p>
              <button
                type="button"
                onClick={() => router.push('/configuracoes/notificacoes')}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:border-[#3b597b]/30 transition-colors"
              >
                Voltar para notificações
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}