'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { ConfigTabs } from '@/components/ConfigTabs';
import { ArrowLeft, Loader2, RotateCcw, Save, Sparkles, ShieldCheck } from 'lucide-react';

type PromptConfig = {
  chave: string;
  titulo: string;
  descricao: string | null;
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
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [defaults, setDefaults] = useState(DEFAULTS);
  const [form, setForm] = useState<PromptConfig>(DEFAULTS);

  useEffect(() => {
    let active = true;

    async function init() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push('/login');
        return;
      }

      const res = await fetch('/api/admin/ai-prompts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload?.error || 'Nao foi possivel carregar o prompt.');
        setLoading(false);
        return;
      }

      if (!active) return;
      const config = payload.config || DEFAULTS;
      const nextDefaults = payload.defaults || DEFAULTS;
      setDefaults(nextDefaults);
      setForm({
        chave: config.chave || DEFAULTS.chave,
        titulo: config.titulo || DEFAULTS.titulo,
        descricao: config.descricao ?? DEFAULTS.descricao,
        system_prompt: config.system_prompt || nextDefaults.system_prompt || '',
        user_prompt_template: config.user_prompt_template || nextDefaults.user_prompt_template || '',
        ativo: config.ativo ?? true,
        versao: config.versao || 1,
        updated_by: config.updated_by || null,
        updated_at: config.updated_at || null,
      });
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
          titulo: form.titulo,
          descricao: form.descricao,
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
      setForm({
        chave: config.chave || DEFAULTS.chave,
        titulo: config.titulo || DEFAULTS.titulo,
        descricao: config.descricao ?? DEFAULTS.descricao,
        system_prompt: config.system_prompt || form.system_prompt,
        user_prompt_template: config.user_prompt_template || form.user_prompt_template,
        ativo: config.ativo ?? form.ativo,
        versao: config.versao || form.versao,
        updated_by: config.updated_by || null,
        updated_at: config.updated_at || null,
      });
      setSavedAt(new Date().toLocaleString('pt-BR'));
    } catch (err: any) {
      setError(err?.message || 'Nao foi possivel salvar o prompt.');
    } finally {
      setSaving(false);
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
            Edite o prompt usado na análise de crédito da Holding.
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
        <div className="grid grid-cols-1 xl:grid-cols-3">
          <div className="xl:col-span-2 p-6 space-y-5 border-b xl:border-b-0 xl:border-r border-slate-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Título</label>
                <input
                  value={form.titulo}
                  onChange={(e) => setForm((prev) => ({ ...prev, titulo: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b]"
                />
              </div>
              <div>
                <label className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">Descrição</label>
                <input
                  value={form.descricao || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
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