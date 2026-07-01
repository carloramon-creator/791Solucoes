"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { KeyRound, Loader2, Plus, Save, ShieldCheck } from 'lucide-react';

type PermissionResource = {
  code: string;
  label: string;
  category: string;
  parent_code: string | null;
  sort_order: number;
  active: boolean;
};

type PermissionProfile = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  is_system: boolean;
  resourceCodes: string[];
  userEmails: string[];
};

type EditorState = {
  name: string;
  description: string;
  active: boolean;
  resourceCodes: Set<string>;
  userEmailsText: string;
};

function normalizeEmails(value: string): string[] {
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  ));
}

export default function PermissoesPage() {
  const supabase = createSupabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resources, setResources] = useState<PermissionResource[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [editors, setEditors] = useState<Record<string, EditorState>>({});

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [newProfile, setNewProfile] = useState({
    name: '',
    description: '',
    userEmailsText: '',
    resourceCodes: new Set<string>(),
  });

  const groupedResources = useMemo(() => {
    const map = new Map<string, PermissionResource[]>();
    for (const resource of resources) {
      if (!resource.active) continue;
      if (!map.has(resource.category)) {
        map.set(resource.category, []);
      }
      map.get(resource.category)?.push(resource);
    }
    return Array.from(map.entries());
  }, [resources]);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, [supabase]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getToken();
    if (!token) throw new Error('Sessao expirada.');

    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error || 'Erro na requisicao');
    }
    return json;
  }, [getToken]);

  const hydrateEditors = (nextProfiles: PermissionProfile[]) => {
    const state: Record<string, EditorState> = {};

    for (const profile of nextProfiles) {
      state[profile.id] = {
        name: profile.name,
        description: profile.description || '',
        active: profile.active,
        resourceCodes: new Set(profile.resourceCodes || []),
        userEmailsText: (profile.userEmails || []).join(', '),
      };
    }

    setEditors(state);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api('/api/admin/permissions');
      const nextResources = (data.resources || []) as PermissionResource[];
      const nextProfiles = (data.profiles || []) as PermissionProfile[];
      setResources(nextResources);
      setProfiles(nextProfiles);
      hydrateEditors(nextProfiles);
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar permissoes.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleNewResource = (code: string) => {
    setNewProfile((prev) => {
      const next = new Set(prev.resourceCodes);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return { ...prev, resourceCodes: next };
    });
  };

  const toggleEditorResource = (profileId: string, code: string) => {
    setEditors((prev) => {
      const current = prev[profileId];
      if (!current) return prev;
      const nextCodes = new Set(current.resourceCodes);
      if (nextCodes.has(code)) nextCodes.delete(code);
      else nextCodes.add(code);

      return {
        ...prev,
        [profileId]: {
          ...current,
          resourceCodes: nextCodes,
        },
      };
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setFeedback(null);

    try {
      await api('/api/admin/permissions', {
        method: 'POST',
        body: JSON.stringify({
          name: newProfile.name,
          description: newProfile.description || null,
          resourceCodes: Array.from(newProfile.resourceCodes.values()),
          userEmails: normalizeEmails(newProfile.userEmailsText),
        }),
      });

      setFeedback('Perfil criado com sucesso.');
      setNewProfile({ name: '', description: '', userEmailsText: '', resourceCodes: new Set() });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar perfil.');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveProfile = async (profileId: string) => {
    const editor = editors[profileId];
    if (!editor) return;

    setSaving(true);
    setError(null);
    setFeedback(null);

    try {
      await api(`/api/admin/permissions/${profileId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editor.name,
          description: editor.description || null,
          active: editor.active,
          resourceCodes: Array.from(editor.resourceCodes.values()),
          userEmails: normalizeEmails(editor.userEmailsText),
        }),
      });

      setFeedback('Perfil atualizado com sucesso.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar perfil.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-[70vh] w-full flex items-center justify-center">
        <Loader2 className="animate-spin text-[#3b597b]" size={34} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <ShieldCheck className="text-[#3b597b]" size={24} />
          Perfis e Permissoes
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Controle de menus, submenus e a distribuicao de tickets por perfil.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold">{error}</div>
      )}

      {feedback && (
        <div className="px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold">{feedback}</div>
      )}

      <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
          <Plus size={14} /> Novo perfil
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={newProfile.name}
            onChange={(e) => setNewProfile((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Nome do perfil"
            required
            className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
          />
          <input
            value={newProfile.description}
            onChange={(e) => setNewProfile((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Descricao"
            className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
          />
          <input
            value={newProfile.userEmailsText}
            onChange={(e) => setNewProfile((prev) => ({ ...prev, userEmailsText: e.target.value }))}
            placeholder="Usuarios (emails separados por virgula)"
            className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
          />
        </div>

        <div className="space-y-3">
          {groupedResources.map(([category, categoryResources]) => (
            <div key={category} className="p-3 border border-slate-100 rounded-xl">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{category}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {categoryResources.map((resource) => (
                  <label key={resource.code} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={newProfile.resourceCodes.has(resource.code)}
                      onChange={() => toggleNewResource(resource.code)}
                    />
                    <span>{resource.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-[#3b597b] text-white text-sm font-bold hover:bg-[#2e4763] disabled:opacity-50"
          >
            {creating ? 'Criando...' : 'Criar perfil'}
          </button>
        </div>
      </form>

      <div className="space-y-4">
        {profiles.map((profile) => {
          const editor = editors[profile.id];
          if (!editor) return null;

          return (
            <div key={profile.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-bold uppercase tracking-wider text-slate-700">{profile.name}</div>
                <button
                  onClick={() => handleSaveProfile(profile.id)}
                  disabled={saving}
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-wider hover:bg-black disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Salvar
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={editor.name}
                  onChange={(e) => setEditors((prev) => ({ ...prev, [profile.id]: { ...editor, name: e.target.value } }))}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                />
                <input
                  value={editor.description}
                  onChange={(e) => setEditors((prev) => ({ ...prev, [profile.id]: { ...editor, description: e.target.value } }))}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                />
                <input
                  value={editor.userEmailsText}
                  onChange={(e) => setEditors((prev) => ({ ...prev, [profile.id]: { ...editor, userEmailsText: e.target.value } }))}
                  placeholder="Usuarios (emails separados por virgula)"
                  className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                />
                <label className="md:col-span-3 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editor.active}
                    onChange={(e) => setEditors((prev) => ({ ...prev, [profile.id]: { ...editor, active: e.target.checked } }))}
                  />
                  Perfil ativo
                </label>
              </div>

              <div className="space-y-3">
                {groupedResources.map(([category, categoryResources]) => (
                  <div key={`${profile.id}-${category}`} className="p-3 border border-slate-100 rounded-xl">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{category}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {categoryResources.map((resource) => (
                        <label key={`${profile.id}-${resource.code}`} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={editor.resourceCodes.has(resource.code)}
                            onChange={() => toggleEditorResource(profile.id, resource.code)}
                          />
                          <span>{resource.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
