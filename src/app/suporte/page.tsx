"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import type { SupportQueue } from '@/lib/support-queue';
import { BellDot, CircleDot, Clock3, LifeBuoy, Loader2, MessageSquare, RefreshCcw, Send, UserRoundCheck } from 'lucide-react';

type Subject = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  assigneeEmails: string[];
  profileIds: string[];
};

type PermissionProfile = {
  id: string;
  name: string;
  active: boolean;
  userEmails?: string[];
};

type Ticket = {
  id: string;
  protocol: string;
  tenant_slug: string;
  tenant_name: string | null;
  tenant_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  subject_id: string | null;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'new' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  assigned_to_email: string | null;
  created_by_email: string | null;
  due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  subject?: {
    id: string;
    name: string;
  } | null;
};

type TicketMessage = {
  id: string;
  ticket_id: string;
  origin: 'holding' | 'tenant' | 'system';
  author_email: string | null;
  author_name: string | null;
  message: string;
  is_internal: boolean;
  created_at: string;
  author_avatar_url?: string | null;
};

type TeamMember = {
  name: string | null;
  email: string;
  avatarUrl?: string | null;
};

type QueueCounts = {
  all: number;
  new: number;
  mine: number;
  overdue: number;
  done: number;
};

const QUEUE_META: Array<{ key: SupportQueue; label: string; icon: React.ComponentType<any> }> = [
  { key: 'new', label: 'Novos', icon: CircleDot },
  { key: 'mine', label: 'Meus', icon: UserRoundCheck },
  { key: 'overdue', label: 'Atrasados', icon: Clock3 },
  { key: 'done', label: 'Concluidos', icon: BellDot },
  { key: 'all', label: 'Todos', icon: MessageSquare },
];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR');
}

function toInputDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export default function SuportePage() {
  const supabase = createSupabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [savingTicket, setSavingTicket] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [creatingSubject, setCreatingSubject] = useState(false);

  const [queue, setQueue] = useState<SupportQueue>('new');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<QueueCounts>({ all: 0, new: 0, mine: 0, overdue: 0, done: 0 });
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<PermissionProfile[]>([]);
  const [permissionCodes, setPermissionCodes] = useState<Set<string>>(new Set());
  const [unrestrictedFallback, setUnrestrictedFallback] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showSubjectPanel, setShowSubjectPanel] = useState(false);

  const [newTicket, setNewTicket] = useState({
    tenantSlug: '',
    tenantName: '',
    title: '',
    description: '',
    subjectId: '',
    priority: 'normal',
    requesterName: '',
    requesterEmail: '',
    dueAt: '',
  });

  const [draftMessage, setDraftMessage] = useState('');
  const [newSubject, setNewSubject] = useState({
    name: '',
    description: '',
    assigneeEmails: [] as string[],
    profileIds: [] as string[],
  });

  const availableSubjectUsers = useMemo(() => {
    if (newSubject.profileIds.length === 0) return team;

    const allowedEmails = new Set(
      permissionProfiles
        .filter((profile) => newSubject.profileIds.includes(profile.id))
        .flatMap((profile) => profile.userEmails || [])
        .map((email) => String(email || '').trim().toLowerCase())
        .filter(Boolean)
    );

    return team.filter((member) => allowedEmails.has(String(member.email || '').trim().toLowerCase()));
  }, [newSubject.profileIds, permissionProfiles, team]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  const [editState, setEditState] = useState({
    status: 'new',
    priority: 'normal',
    assignedToEmail: '',
    dueAt: '',
  });

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, [supabase]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getToken();
    if (!token) {
      throw new Error('Sessao expirada. Faca login novamente.');
    }

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

  const loadSupportData = useCallback(async (currentQueue: SupportQueue, preserveSelection = true) => {
    setQueueLoading(true);
    setError(null);

    try {
      const [ticketsRes, subjectsRes, teamRes, permissionsRes, meRes] = await Promise.all([
        api(`/api/support/tickets?queue=${currentQueue}`),
        api('/api/support/subjects'),
        api('/api/support/team'),
        api('/api/admin/permissions'),
        api('/api/admin/permissions/me'),
      ]);

      const loadedTickets: Ticket[] = ticketsRes.tickets || [];
      setTickets(loadedTickets);
      setCounts(ticketsRes.counts || { all: 0, new: 0, mine: 0, overdue: 0, done: 0 });
      setSubjects(subjectsRes.subjects || []);
      setTeam(teamRes.members || []);
      setPermissionProfiles((permissionsRes.profiles || []).filter((profile: PermissionProfile) => profile.active));
      setPermissionCodes(new Set(Array.isArray(meRes.permissionCodes) ? meRes.permissionCodes : []));
      setUnrestrictedFallback(Boolean(meRes.unrestrictedFallback));

      if (!preserveSelection) {
        setSelectedTicketId(loadedTickets[0]?.id || null);
      } else if (!loadedTickets.some((ticket) => ticket.id === selectedTicketId)) {
        setSelectedTicketId(loadedTickets[0]?.id || null);
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar suporte.');
    } finally {
      setQueueLoading(false);
      setLoading(false);
    }
  }, [api, selectedTicketId]);

  const loadMessages = useCallback(async (ticketId: string) => {
    setMessagesLoading(true);
    try {
      const response = await api(`/api/support/tickets/${ticketId}/messages`);
      setMessages(response.messages || []);
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar mensagens do ticket.');
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadSupportData(queue, false);
  }, [loadSupportData, queue]);

  useEffect(() => {
    if (selectedTicket) {
      setEditState({
        status: selectedTicket.status,
        priority: selectedTicket.priority,
        assignedToEmail: selectedTicket.assigned_to_email || '',
        dueAt: toInputDateTime(selectedTicket.due_at),
      });
      loadMessages(selectedTicket.id);
    } else {
      setMessages([]);
    }
  }, [selectedTicket, loadMessages]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingTicket(true);
    setError(null);
    setFeedback(null);

    try {
      await api('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          tenantSlug: newTicket.tenantSlug,
          tenantName: newTicket.tenantName || null,
          title: newTicket.title,
          description: newTicket.description,
          subjectId: newTicket.subjectId || null,
          priority: newTicket.priority,
          requesterName: newTicket.requesterName || null,
          requesterEmail: newTicket.requesterEmail || null,
          dueAt: newTicket.dueAt ? new Date(newTicket.dueAt).toISOString() : null,
        }),
      });

      setFeedback('Ticket criado com sucesso.');
      setShowNewTicket(false);
      setNewTicket({
        tenantSlug: '',
        tenantName: '',
        title: '',
        description: '',
        subjectId: '',
        priority: 'normal',
        requesterName: '',
        requesterEmail: '',
        dueAt: '',
      });

      await loadSupportData(queue, false);
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar ticket.');
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSubject(true);
    setError(null);
    setFeedback(null);

    try {
      const assigneeEmails = Array.from(new Set(
        (newSubject.assigneeEmails || [])
          .map((email) => String(email || '').trim().toLowerCase())
          .filter(Boolean)
      ));

      await api('/api/support/subjects', {
        method: 'POST',
        body: JSON.stringify({
          name: newSubject.name,
          description: newSubject.description || null,
          assigneeEmails,
          profileIds: newSubject.profileIds,
        }),
      });

      setFeedback('Assunto criado com sucesso.');
      setNewSubject({ name: '', description: '', assigneeEmails: [], profileIds: [] });
      await loadSupportData(queue, true);
    } catch (err: any) {
      setError(err?.message || 'Falha ao criar assunto.');
    } finally {
      setCreatingSubject(false);
    }
  };

  const handleToggleSubject = async (subject: Subject) => {
    try {
      await api(`/api/support/subjects/${subject.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !subject.active }),
      });
      await loadSupportData(queue, true);
    } catch (err: any) {
      setError(err?.message || 'Falha ao atualizar assunto.');
    }
  };

  const handleSaveTicket = async () => {
    if (!selectedTicket) return;

    setSavingTicket(true);
    setError(null);
    setFeedback(null);

    try {
      const dueAt = editState.dueAt ? new Date(editState.dueAt).toISOString() : null;

      await api(`/api/support/tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: editState.status,
          priority: editState.priority,
          assignedToEmail: editState.assignedToEmail || null,
          dueAt,
        }),
      });

      setFeedback('Ticket atualizado com sucesso.');
      await loadSupportData(queue, true);
    } catch (err: any) {
      setError(err?.message || 'Falha ao atualizar ticket.');
    } finally {
      setSavingTicket(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedTicket || !draftMessage.trim()) return;

    setSendingMessage(true);
    setError(null);

    try {
      await api(`/api/support/tickets/${selectedTicket.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          message: draftMessage,
          origin: 'holding',
          isInternal: false,
        }),
      });

      setDraftMessage('');
      await loadMessages(selectedTicket.id);
      await loadSupportData(queue, true);
    } catch (err: any) {
      setError(err?.message || 'Falha ao enviar mensagem.');
    } finally {
      setSendingMessage(false);
    }
  };

  const can = (resourceCode: string) => unrestrictedFallback || permissionCodes.has(resourceCode);

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
            <LifeBuoy className="text-[#3b597b]" size={24} />
            Suporte Holding
          </h1>
          <p className="text-sm text-slate-500 mt-1">Filas Novo, Meus, Atrasado e Concluido com operacao centralizada.</p>
        </div>

        <div className="flex items-center gap-2">
          {can('action.support.manage_subjects') && (
            <button
              onClick={() => setShowSubjectPanel((prev) => !prev)}
              className="px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
            >
              Assuntos
            </button>
          )}
          <button
            onClick={() => setShowNewTicket((prev) => !prev)}
            className="px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg bg-[#3b597b] text-white hover:bg-[#2e4763]"
          >
            Novo Ticket
          </button>
          <button
            onClick={() => loadSupportData(queue, true)}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-800"
            title="Atualizar"
          >
            <RefreshCcw size={16} className={queueLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold">
          {error}
        </div>
      )}

      {feedback && (
        <div className="px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-semibold">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
        {QUEUE_META.map((item) => {
          const Icon = item.icon;
          const active = queue === item.key;
          const count = counts[item.key as keyof QueueCounts] || 0;
          return (
            <button
              key={item.key}
              onClick={() => setQueue(item.key)}
              className={`rounded-xl border px-4 py-3 text-left transition-all ${
                active
                  ? 'bg-[#3b597b] border-[#3b597b] text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <Icon size={14} />
                  {item.label}
                </div>
                <span className="text-lg font-black">{count}</span>
              </div>
            </button>
          );
        })}
      </div>

      {showNewTicket && (
        <form onSubmit={handleCreateTicket} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Abrir novo ticket</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <input
              value={newTicket.tenantSlug}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, tenantSlug: e.target.value }))}
              placeholder="Tenant slug (obrigatorio)"
              required
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
            <input
              value={newTicket.tenantName}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, tenantName: e.target.value }))}
              placeholder="Nome da tenant"
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
            <select
              value={newTicket.subjectId}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, subjectId: e.target.value }))}
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            >
              <option value="">Assunto (opcional)</option>
              {subjects.filter((subject) => subject.active).map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <input
              value={newTicket.title}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Titulo"
              required
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm lg:col-span-2"
            />
            <select
              value={newTicket.priority}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, priority: e.target.value }))}
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            >
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
            <input
              value={newTicket.requesterName}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, requesterName: e.target.value }))}
              placeholder="Solicitante (nome)"
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
            <input
              value={newTicket.requesterEmail}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, requesterEmail: e.target.value }))}
              placeholder="Solicitante (e-mail)"
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
            <input
              value={newTicket.dueAt}
              onChange={(e) => setNewTicket((prev) => ({ ...prev, dueAt: e.target.value }))}
              type="datetime-local"
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
          </div>
          <textarea
            value={newTicket.description}
            onChange={(e) => setNewTicket((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Descreva o problema"
            required
            rows={4}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creatingTicket}
              className="px-4 py-2 rounded-lg bg-[#3b597b] text-white text-sm font-bold hover:bg-[#2e4763] disabled:opacity-50"
            >
              {creatingTicket ? 'Criando...' : 'Criar Ticket'}
            </button>
          </div>
        </form>
      )}

      {showSubjectPanel && can('action.support.manage_subjects') && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Assuntos e responsaveis</h2>

          <form onSubmit={handleCreateSubject} className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <input
              value={newSubject.name}
              onChange={(e) => setNewSubject((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nome do assunto"
              required
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
            <input
              value={newSubject.description}
              onChange={(e) => setNewSubject((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Descricao"
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm"
            />
            <select
              multiple
              value={newSubject.profileIds}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                setNewSubject((prev) => {
                  const allowedBySelectedProfiles = new Set(
                    permissionProfiles
                      .filter((profile) => selected.includes(profile.id))
                      .flatMap((profile) => profile.userEmails || [])
                      .map((email) => String(email || '').trim().toLowerCase())
                      .filter(Boolean)
                  );

                  const nextAssignees = prev.assigneeEmails.filter((email) =>
                    selected.length === 0 || allowedBySelectedProfiles.has(String(email || '').trim().toLowerCase())
                  );
                  return { ...prev, profileIds: selected, assigneeEmails: nextAssignees };
                });
              }}
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm lg:col-span-2 min-h-[110px]"
            >
              {permissionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <select
              multiple
              value={newSubject.assigneeEmails}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                setNewSubject((prev) => ({ ...prev, assigneeEmails: selected }));
              }}
              className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm lg:col-span-2 min-h-[110px]"
            >
              {availableSubjectUsers.map((member) => (
                <option key={member.email} value={member.email}>
                  {member.name ? `${member.name} (${member.email})` : member.email}
                </option>
              ))}
            </select>
            <div className="lg:col-span-2 text-[11px] text-slate-500">
              Perfil/Cargo: selecione um ou mais perfis para controlar o acesso ao assunto.
            </div>
            <div className="lg:col-span-2 text-[11px] text-slate-500">
              Usuarios: selecao multipla de responsaveis; pode ter varios usuarios no mesmo perfil.
            </div>
            <div className="lg:col-span-4 flex justify-end">
              <button
                type="submit"
                disabled={creatingSubject}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-black disabled:opacity-50"
              >
                {creatingSubject ? 'Salvando...' : 'Criar assunto'}
              </button>
            </div>
          </form>

          {team.length > 0 && (
            <p className="text-xs text-slate-500">
              Equipe detectada: {team.map((member) => member.email).join(', ')}
            </p>
          )}

          <div className="space-y-2">
            {subjects.map((subject) => (
              <div key={subject.id} className="p-3 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-800">{subject.name}</div>
                  <div className="text-xs text-slate-500">
                    {(subject.assigneeEmails || []).length > 0 ? subject.assigneeEmails.join(', ') : 'Sem responsavel definido'}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {(subject.profileIds || []).length > 0
                      ? `Perfis: ${permissionProfiles.filter((profile) => subject.profileIds.includes(profile.id)).map((profile) => profile.name).join(', ')}`
                      : 'Perfis: sem vinculo'}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleSubject(subject)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                    subject.active
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  {subject.active ? 'Ativo' : 'Inativo'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-500">
            Tickets da fila
          </div>

          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
            {queueLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
            ) : tickets.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">Nenhum ticket encontrado.</div>
            ) : (
              tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                    selectedTicketId === ticket.id ? 'bg-slate-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#3b597b]">{ticket.protocol}</span>
                    <span className="text-[10px] text-slate-400">{new Date(ticket.created_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-800 mt-1 line-clamp-1">{ticket.title}</div>
                  <div className="text-xs text-slate-500 mt-1 line-clamp-1">
                    {(ticket.tenant_name || ticket.tenant_slug)} • {ticket.subject?.name || 'Sem assunto'}
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">{ticket.status}</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase">{ticket.priority}</span>
                    {ticket.assigned_to_email && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">{ticket.assigned_to_email}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {!selectedTicket ? (
            <div className="h-full min-h-[320px] flex items-center justify-center text-slate-400 text-sm">Selecione um ticket para ver detalhes.</div>
          ) : (
            <div className="flex flex-col h-full max-h-[70vh]">
              <div className="px-4 py-3 border-b border-slate-100 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#3b597b]">{selectedTicket.protocol}</div>
                    <div className="text-sm font-bold text-slate-800">{selectedTicket.title}</div>
                  </div>
                  <button
                    onClick={handleSaveTicket}
                    disabled={savingTicket}
                    className="px-3 py-2 rounded-lg bg-[#3b597b] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#2e4763] disabled:opacity-50"
                  >
                    {savingTicket ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    value={editState.status}
                    onChange={(e) => setEditState((prev) => ({ ...prev, status: e.target.value }))}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold"
                  >
                    <option value="new">new</option>
                    <option value="in_progress">in_progress</option>
                    <option value="waiting_customer">waiting_customer</option>
                    <option value="resolved">resolved</option>
                    <option value="closed">closed</option>
                  </select>

                  <select
                    value={editState.priority}
                    onChange={(e) => setEditState((prev) => ({ ...prev, priority: e.target.value }))}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold"
                  >
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>

                  {can('action.support.assign') && (
                    <select
                      value={editState.assignedToEmail}
                      onChange={(e) => setEditState((prev) => ({ ...prev, assignedToEmail: e.target.value }))}
                      className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold"
                    >
                      <option value="">Sem responsavel</option>
                      {team.map((member) => (
                        <option key={member.email} value={member.email}>
                          {member.name ? `${member.name} (${member.email})` : member.email}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    type="datetime-local"
                    value={editState.dueAt}
                    onChange={(e) => setEditState((prev) => ({ ...prev, dueAt: e.target.value }))}
                    className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold"
                  />
                </div>

                <div className="text-xs text-slate-500">
                  Tenant: <span className="font-semibold text-slate-700">{selectedTicket.tenant_name || selectedTicket.tenant_slug}</span> • Criado em {formatDate(selectedTicket.created_at)}
                </div>
              </div>

              <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-600">
                <p className="whitespace-pre-wrap">{selectedTicket.description}</p>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/60">
                {messagesLoading ? (
                  <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
                ) : messages.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-8">Sem mensagens ainda.</div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
                      msg.origin === 'holding'
                        ? 'ml-auto bg-[#3b597b] text-white'
                        : msg.origin === 'tenant'
                          ? 'mr-auto bg-white border border-slate-200 text-slate-700'
                          : 'mx-auto bg-amber-50 border border-amber-200 text-amber-800'
                    }`}>
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80 mb-1">
                        {msg.author_avatar_url ? (
                          <img src={msg.author_avatar_url} alt="avatar" className="w-5 h-5 rounded-full object-cover" />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-slate-300/60 inline-flex items-center justify-center text-[9px] font-bold text-slate-700">
                            {String(msg.author_name || msg.author_email || 'S').slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span>
                          {msg.origin} • {msg.author_name || msg.author_email || 'sistema'}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap">{msg.message}</div>
                      <div className="text-[10px] opacity-70 mt-1">{formatDate(msg.created_at)}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t border-slate-100 bg-white">
                {can('action.support.reply') ? (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draftMessage}
                      onChange={(e) => setDraftMessage(e.target.value)}
                      rows={2}
                      placeholder="Responder ticket..."
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={sendingMessage || !draftMessage.trim()}
                      className="px-3 py-2 rounded-lg bg-[#3b597b] text-white hover:bg-[#2e4763] disabled:opacity-50"
                      title="Enviar mensagem"
                    >
                      {sendingMessage ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">Sem permissao para responder tickets.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
