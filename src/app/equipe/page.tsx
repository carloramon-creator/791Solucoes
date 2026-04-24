"use client";

import { useEffect, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Users, UserPlus, Mail, Shield, Trash2, Loader2, Check, X } from 'lucide-react';

interface TeamMember {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string;
  user_metadata?: {
    full_name?: string;
    cargo?: string;
  };
}

const CARGOS = ['Dono', 'Gerente', 'Financeiro', 'Suporte', 'Operações'];

export default function EquipePage() {
  const supabase = createSupabaseBrowser();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Form de convite
  const [showForm, setShowForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteCargo, setInviteCargo] = useState('Suporte');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      // Busca a lista de admins da tabela profiles (se existir) ou usa a auth
      // Por ora, vamos usar uma tabela "equipe_791" no banco principal
      const { data, error } = await supabase
        .from('equipe_791')
        .select('*')
        .order('created_at', { ascending: true });

      if (!error) setMembers(data || []);
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setFeedback(null);

    try {
      const { error } = await supabase.from('equipe_791').insert({
        email: inviteEmail,
        nome: inviteName,
        cargo: inviteCargo,
        criado_por: currentUser?.id,
      });

      if (error) throw error;

      setFeedback({ type: 'success', msg: `${inviteName} adicionado à equipe com sucesso!` });
      setInviteEmail('');
      setInviteName('');
      setInvitePassword('');
      setInviteCargo('Suporte');
      setShowForm(false);

      // Atualiza a lista
      const { data } = await supabase.from('equipe_791').select('*').order('created_at');
      setMembers(data || []);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500 pb-12">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Users className="text-[#3b597b]" size={24} />
            Equipe 791
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Gerencie os colaboradores e acessos ao Command Center.
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

      {/* Feedback */}
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

      {/* Formulário de novo colaborador */}
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
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cargo / Função</label>
              <div className="relative">
                <Shield size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={inviteCargo}
                  onChange={(e) => setInviteCargo(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] appearance-none transition-all"
                >
                  {CARGOS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Senha Inicial</label>
              <input
                type="password"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                placeholder="••••••••"
                className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
              />
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

      {/* Tabela da Equipe */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider font-bold text-slate-500">
              <th className="p-4 pl-6 text-left">Colaborador</th>
              <th className="p-4 text-left">Cargo</th>
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
              members.map((m: any) => (
                <tr key={m.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="p-4 pl-6">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#3b597b] flex items-center justify-center text-white text-[11px] font-black shrink-0">
                        {(m.nome || m.email || 'U').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-[13px] font-bold text-slate-800">{m.nome || '—'}</div>
                        <div className="text-[11px] text-slate-500">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-[#3b597b]/10 text-[#3b597b] text-[10px] font-bold uppercase tracking-wider rounded-full">
                      {m.cargo || 'Sem cargo'}
                    </span>
                  </td>
                  <td className="p-4 text-[12px] text-slate-500 font-medium">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="p-4 text-[12px] text-slate-500 font-medium">
                    {m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="p-4 pr-6 text-right">
                    <button className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
