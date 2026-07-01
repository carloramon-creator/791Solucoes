"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { ArrowRight, Check, ChevronDown, Eye, Loader2, PencilLine, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';

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

type FormState = {
  name: string;
  description: string;
  active: boolean;
  resourceCodes: Set<string>;
};

export default function PermissoesPage() {
  const supabase = createSupabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resources, setResources] = useState<PermissionResource[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());
  const [newProfile, setNewProfile] = useState<FormState>({
    name: '',
    description: '',
    active: true,
    resourceCodes: new Set(),
  });
  const [editingProfile, setEditingProfile] = useState<Record<string, FormState>>({});

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, [supabase]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getToken();
    if (!token) throw new Error('Sessao expirada.');

    const response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.error || 'Erro na requisicao');
    }
    return json;
  }, [getToken]);

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

  const hydrateEditing = useCallback((nextProfiles: PermissionProfile[]) => {
    const state: Record<string, FormState> = {};
    for (const profile of nextProfiles) {
      state[profile.id] = {
        name: profile.name,
        description: profile.description || '',
        active: profile.active,
        resourceCodes: new Set(profile.resourceCodes || []),
      };
    }
    setEditingProfile(state);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api('/api/admin/permissions');
      setResources(data.resources || []);
      setProfiles(data.profiles || []);
      hydrateEditing(data.profiles || []);
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar permissões.');
    } finally {
      setLoading(false);
    }
  }, [api, hydrateEditing]);

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

  const toggleEditResource = (profileId: string, code: string) => {
    setEditingProfile((prev) => {
      const current = prev[profileId];
      if (!current) return prev;
      const next = new Set(current.resourceCodes);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return {
        ...prev,
        [profileId]: { ...current, resourceCodes: next },
      };
    });
  };

  const toggleProfileExpanded = (profileId: string) => {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
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
          active: newProfile.active,
          resourceCodes: Array.from(newProfile.resourceCodes.values()),
          userEmails: [],
        }),
      });
      setNewProfile({ name: '', description: '', active: true, resourceCodes: new Set() });
      setFeedback('Perfil criado com sucesso.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar perfil.');
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (profileId: string) => {
    const current = editingProfile[profileId];
    if (!current) return;

    setSavingProfileId(profileId);
    setError(null);
    setFeedback(null);

    try {
      await api(`/api/admin/permissions/${profileId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: current.name,
          description: current.description || null,
          active: current.active,
          resourceCodes: Array.from(current.resourceCodes.values()),
          userEmails: [],
        }),
      });
      setFeedback('Perfil atualizado com sucesso.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Falha ao atualizar perfil.');
    } finally {
      setSavingProfileId(null);
    }
  };

  const handleDelete = async (profileId: string) => {
    const ok = window.confirm('Inativar este perfil?');
    if (!ok) return;

    setSavingProfileId(profileId);
    setError(null);
    setFeedback(null);

    try {
      await api(`/api/admin/permissions/${profileId}`, { method: 'DELETE' });
      setFeedback('Perfil inativado com sucesso.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Falha ao inativar perfil.');
    } finally {
      setSavingProfileId(null);
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <ShieldCheck className="text-[#3b597b]" size={24} />
            Perfis e Permissões
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Crie, edite e inative perfis de acesso, menus e cargos da Holding.
          </p>
        </div>

        <Link
          href="/equipe"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition-all"
        >
          Ver equipe
          <ArrowRight size={14} />
        </Link>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold">
          {error}
        </div>
      )}

      {feedback && (
        <div className="px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold flex items-center gap-2">
          <Check size={16} />
          {feedback}
        </div>
      )}

      <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
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
            placeholder="Descrição"
            className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
          />
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={newProfile.active}
              onChange={(e) => setNewProfile((prev) => ({ ...prev, active: e.target.checked }))}
            />
            Ativo
          </label>
        </div>

        <div className="space-y-3">
          {groupedResources.map(([category, items]) => (
            <div key={category} className="border border-slate-100 rounded-xl p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{category}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {items.map((resource) => (
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
          const editor = editingProfile[profile.id];
          if (!editor) return null;
          const isExpanded = expandedProfiles.has(profile.id);

          return (
            <div key={profile.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">{profile.name}</h3>
                  <p className="text-xs text-slate-500">{profile.description || 'Sem descrição'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleProfileExpanded(profile.id)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
                  >
                    {isExpanded ? 'Ocultar permissões' : 'Expandir permissões'}
                    <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave(profile.id)}
                    disabled={savingProfileId === profile.id}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#3b597b] text-white text-xs font-bold hover:bg-[#2e4763] disabled:opacity-50"
                  >
                    {savingProfileId === profile.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Salvar
                  </button>
                  <button
                    onClick={() => handleDelete(profile.id)}
                    disabled={savingProfileId === profile.id || profile.is_system}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                    title={profile.is_system ? 'Perfil do sistema não pode ser inativado' : 'Inativar perfil'}
                  >
                    <Trash2 size={14} />
                    Inativar
                  </button>
                </div>
              </div>

              {isExpanded && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input
                      value={editor.name}
                      onChange={(e) => setEditingProfile((prev) => ({ ...prev, [profile.id]: { ...editor, name: e.target.value } }))}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                    />
                    <input
                      value={editor.description}
                      onChange={(e) => setEditingProfile((prev) => ({ ...prev, [profile.id]: { ...editor, description: e.target.value } }))}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                    />
                    <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={editor.active}
                        onChange={(e) => setEditingProfile((prev) => ({ ...prev, [profile.id]: { ...editor, active: e.target.checked } }))}
                      />
                      Ativo
                    </label>
                  </div>

                  <div className="space-y-3">
                    {groupedResources.map(([category, items]) => (
                      <div key={`${profile.id}-${category}`} className="border border-slate-100 rounded-xl p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{category}</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {items.map((resource) => (
                            <label key={`${profile.id}-${resource.code}`} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={editor.resourceCodes.has(resource.code)}
                                onChange={() => toggleEditResource(profile.id, resource.code)}
                              />
                              <span>{resource.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{profile.userEmails.length} usuário(s) vinculado(s)</span>
                <span>{profile.active ? 'Ativo' : 'Inativo'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
