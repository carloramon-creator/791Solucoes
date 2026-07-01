"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Users, UserPlus, Mail, Shield, Trash2, Loader2, Check, X, Save, KeyRound } from 'lucide-react';

type TeamMember = {
  id: string;
  email: string;
  nome: string | null;
  cargo: string | null;
  created_at: string;
  last_sign_in_at?: string;
};

type PermissionProfile = {
  id: string;
  name: string;
  active: boolean;
};

type PermissionProfileResponse = {
  profiles: Array<{
    id: string;
    name: string;
    description: string | null;
    active: boolean;
    is_system: boolean;
    resourceCodes: string[];
    userEmails: string[];
  }>;
};

const fallbackCargos = ['Dono', 'Gerente', 'Financeiro', 'Suporte', 'Operações'];

export default function EquipePage() {
  const supabase = createSupabaseBrowser();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [profileByEmail, setProfileByEmail] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingUserEmail, setSavingUserEmail] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [showForm, setShowForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteProfileId, setInviteProfileId] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const permissionProfileOptions = useMemo(() => {
    const activeProfiles = profiles.filter((profile) => profile.active);
    if (activeProfiles.length > 0) return activeProfiles;
    return fallbackCargos.map((name, index) => ({ id: `fallback-${index}`, name, active: true }));
  }, [profiles]);

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

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUser(user);

    const [teamResult, permissionsResult] = await Promise.all([
      supabase
        .from('equipe_791')
        .select('*')
        .order('created_at', { ascending: true }),
      api('/api/admin/permissions') as Promise<PermissionProfileResponse>,
    ]);

    if (!teamResult.error) {
      const teamMembers = (teamResult.data || []) as TeamMember[];
      setMembers(teamMembers);
    }

    const activeProfiles = (permissionsResult.profiles || [])
      .filter((profile) => profile.active)
      .map((profile) => ({ id: profile.id, name: profile.name, active: profile.active }));
    setProfiles(activeProfiles);

    const map: Record<string, string> = {};
    for (const profile of permissionsResult.profiles || []) {
      for (const email of profile.userEmails || []) {
        if (!map[email]) {
          map[email] = profile.id;
        }
      }
    }
    setProfileByEmail(map);
  }, [api, supabase]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        await refresh();
      } catch (err: any) {
        setFeedback({ type: 'error', msg: err?.message || 'Falha ao carregar equipe.' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [refresh]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setFeedback(null);

    try {
      const selectedProfile = permissionProfileOptions.find((profile) => profile.id === inviteProfileId) || permissionProfileOptions[0] || null;
      const cargo = selectedProfile?.name || 'Suporte';

      const { error } = await supabase.from('equipe_791').insert({
        email: inviteEmail,
        nome: inviteName,
        cargo,
        criado_por: currentUser?.id,
      });

      if (error) throw error;

      if (selectedProfile && !selectedProfile.id.startsWith('fallback-')) {
        await api(`/api/admin/permissions/users/${encodeURIComponent(inviteEmail.toLowerCase())}`, {
          method: 'PATCH',
          body: JSON.stringify({ profileIds: [selectedProfile.id] }),
        });
      }

      setFeedback({ type: 'success', msg: `${inviteName} adicionado à equipe com sucesso!` });
      setInviteEmail('');
      setInviteName('');
      setInvitePassword('');
      setInviteProfileId(permissionProfileOptions[0]?.id || '');
      setShowForm(false);
      await refresh();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setInviting(false);
    }
  };

  const handleSaveUserProfile = async (member: TeamMember) => {
    setSavingUserEmail(member.email);
    setFeedback(null);

    try {
      const selectedProfileId = profileByEmail[member.email] || '';
      const selectedProfile = permissionProfileOptions.find((profile) => profile.id === selectedProfileId) || null;

      await api(`/api/admin/permissions/users/${encodeURIComponent(member.email.toLowerCase())}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileIds: selectedProfile && !selectedProfile.id.startsWith('fallback-') ? [selectedProfile.id] : [] }),
      });

      await refresh();
      setFeedback({ type: 'success', msg: `Permissões de ${member.email} atualizadas.` });
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setSavingUserEmail(null);
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Users className="text-[#3b597b]" size={24} />
            Equipe 791
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Gerencie os colaboradores, perfis de permissão e acessos ao Command Center.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#3b597b] text-white text-sm font-bold rounded-xl hover:bg-[#2e4763] transition-all shadow-sm shadow-[#3b597b]/30 hover:shadow-md hover:-translate-y-0.5"
        >
          <UserPlus size={16} />
          Adicionar Colaborador
        </button>
      </div>

      {feedback && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold animate-in fade-in duration-200 ${
          feedback.type === 'success'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {feedback.type === 'success' ? <Check size={16} /> : <X size={16} />}
          {feedback.msg}
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <h2 className="text-[13px] font-bold text-slate-700 uppercase tracking-wider mb-5">Novo Colaborador</h2>
          <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Nome Completo</label>
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
                placeholder="Carlos Eduardo"
                className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">E-mail</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  placeholder="carlos@791.com.br"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cargo / Perfil de Permissão</label>
              <div className="relative">
                <Shield size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={inviteProfileId}
                  onChange={(e) => setInviteProfileId(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] appearance-none transition-all"
                >
                  {permissionProfileOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Senha Inicial</label>
              <div className="relative">
                <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
                />
              </div>
            </div>

            <div className="col-span-full flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="px-5 py-2 bg-[#3b597b] text-white text-sm font-bold rounded-lg hover:bg-[#2e4763] transition-colors flex items-center gap-2"
              >
                {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                {inviting ? 'Salvando...' : 'Adicionar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider font-bold text-slate-500">
              <th className="p-4 pl-6 text-left">Colaborador</th>
              <th className="p-4 text-left">Cargo / Perfil</th>
              <th className="p-4 text-left">Desde</th>
              <th className="p-4 text-left">Último Acesso</th>
              <th className="p-4 pr-6 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center">
                  <Loader2 className="animate-spin mx-auto text-slate-400" />
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-12 text-center">
                  <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Users size={40} className="text-slate-200" />
                    <p className="text-sm font-medium">Nenhum colaborador cadastrado ainda.</p>
                    <p className="text-[12px]">Clique em "Adicionar Colaborador" para começar.</p>
                  </div>
                </td>
              </tr>
            ) : (
              members.map((member) => {
                const selectedProfileId = profileByEmail[member.email] || '';
                const selectedProfileName = profiles.find((profile) => profile.id === selectedProfileId)?.name || member.cargo || 'Sem perfil';

                return (
                  <tr key={member.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="p-4 pl-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#3b597b] flex items-center justify-center text-white text-[11px] font-black shrink-0">
                          {(member.nome || member.email || 'U').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[13px] font-bold text-slate-800">{member.nome || '—'}</div>
                          <div className="text-[11px] text-slate-500">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedProfileId}
                          onChange={(e) => setProfileByEmail((prev) => ({ ...prev, [member.email]: e.target.value }))}
                          className="min-w-[220px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#3b597b]"
                        >
                          <option value="">Sem perfil</option>
                          {permissionProfileOptions.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.name}</option>
                          ))}
                        </select>
                        <span className="px-2.5 py-1 bg-[#3b597b]/10 text-[#3b597b] text-[10px] font-bold uppercase tracking-wider rounded-full">
                          {selectedProfileName}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-[12px] text-slate-500 font-medium">
                      {member.created_at ? new Date(member.created_at).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="p-4 text-[12px] text-slate-500 font-medium">
                      {member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleSaveUserProfile(member)}
                          disabled={savingUserEmail === member.email}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#3b597b] text-white text-[11px] font-bold rounded-md hover:bg-[#2e4763] disabled:opacity-60"
                        >
                          {savingUserEmail === member.email ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Salvar perfil
                        </button>
                        <button className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
