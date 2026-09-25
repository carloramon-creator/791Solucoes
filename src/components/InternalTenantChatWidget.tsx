'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, Clock3, Download, MessageCircle, Paperclip, Send, UserPlus, Users, X } from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type PresenceStatus = 'available' | 'away' | 'busy';
type Tenant = { id: string; nome: string | null; slug: string };
type User = { user_id: string; nome_exibicao: string | null };
type Conversation = { id: string; titulo: string | null; participants?: Array<{ user_id: string }> };
type Attachment = { id: string; file_name: string; url: string | null };
type Message = { id: string; sender_id: string; body: string; created_at: string; internal_chat_attachments?: Attachment[] };
type Reminder = { id: string; texto: string; lembrar_em: string };

export default function InternalTenantChatWidget() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [presence, setPresence] = useState<Record<string, PresenceStatus>>({});
  const [currentUserId, setCurrentUserId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [myStatus, setMyStatus] = useState<PresenceStatus>('available');
  const [showReminder, setShowReminder] = useState(false);
  const [reminderRecipientId, setReminderRecipientId] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const api = async (path: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessao expirada.');
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, headers, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Chat indisponivel.');
    return payload;
  };

  const loadTenants = async () => {
    try {
      const payload = await api('/api/support/tenants');
      const items = (payload.tenants || []) as Tenant[];
      setTenants(items);
      const firstTenantId = items[0]?.id || '';
      setTenantId((current) => current || firstTenantId);
      if (firstTenantId) await loadChat(firstTenantId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar tenants.');
    }
  };

  const loadChat = async (requestedTenantId = tenantId) => {
    if (!requestedTenantId) return;
    try {
      const payload = await api(`/api/internal-chat?tenantId=${encodeURIComponent(requestedTenantId)}`);
      setUsers(payload.users || []);
      setConversations(payload.conversations || []);
      setCurrentUserId(payload.currentUserId || '');
      setPresence((payload.presence || []).reduce((map: Record<string, PresenceStatus>, item: { user_id: string; status: PresenceStatus }) => {
        map[item.user_id] = item.status;
        return map;
      }, {}));
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar chat.');
    }
  };

  const loadMessages = async (conversationId: string, requestedTenantId = tenantId) => {
    if (!requestedTenantId || !conversationId) return;
    const query = new URLSearchParams({ tenantId: requestedTenantId, action: 'messages', conversationId });
    const payload = await api(`/api/internal-chat?${query.toString()}`);
    setMessages(payload.messages || []);
  };

  useEffect(() => {
    if (!tenantId) return;
    const sync = () => api('/api/internal-chat', { method: 'POST', body: JSON.stringify({ action: 'presence', tenantId, status: myStatus }) }).catch(() => undefined);
    void sync();
    const interval = window.setInterval(sync, 60_000);
    return () => window.clearInterval(interval);
  }, [tenantId, myStatus]);

  useEffect(() => {
    if (!tenantId || activeReminder) return;
    const check = () => api(`/api/internal-chat?${new URLSearchParams({ tenantId, action: 'reminders' })}`)
      .then(async (payload) => {
        const reminder = payload.reminders?.[0] as Reminder | undefined;
        if (!reminder) return;
        setActiveReminder(reminder);
        await api('/api/internal-chat', { method: 'POST', body: JSON.stringify({ action: 'reminder-status', tenantId, reminderId: reminder.id, status: 'notified' }) });
      }).catch(() => undefined);
    void check();
    const interval = window.setInterval(check, 15_000);
    return () => window.clearInterval(interval);
  }, [tenantId, activeReminder]);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId);
  const participantIds = useMemo(() => new Set((selectedConversation?.participants || []).map((participant) => participant.user_id)), [selectedConversation]);
  const reminderUsers = users.filter((user) => participantIds.has(user.user_id));

  const statusColor = (status?: PresenceStatus) => status === 'busy' ? 'bg-red-500' : status === 'away' ? 'bg-amber-400' : 'bg-emerald-500';
  const userName = (user: User) => user.nome_exibicao || 'Usuario do tenant';

  const toggleOpen = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen) return;
    if (tenants.length === 0) void loadTenants();
    else void loadChat();
  };

  const selectTenant = (nextTenantId: string) => {
    setTenantId(nextTenantId);
    setSelectedId('');
    setMessages([]);
    if (nextTenantId) void loadChat(nextTenantId);
  };

  const selectConversation = (conversationId: string) => {
    setSelectedId(conversationId);
    void loadMessages(conversationId).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Falha ao carregar mensagens.'));
  };

  const startConversation = async (recipientId: string) => {
    setBusy(true);
    try {
      const payload = await api('/api/internal-chat', { method: 'POST', body: JSON.stringify({ action: 'start', tenantId, recipientId }) });
      setConversations((current) => [payload.conversation, ...current]);
      setSelectedId(payload.conversation.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar conversa.');
    } finally { setBusy(false); }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || !selectedId) return;
    const body = draft.trim();
    setDraft('');
    try {
      await api('/api/internal-chat', { method: 'POST', body: JSON.stringify({ action: 'send', tenantId, conversationId: selectedId, body }) });
      await loadMessages(selectedId);
    } catch (err: unknown) {
      setDraft(body);
      setError(err instanceof Error ? err.message : 'Falha ao enviar mensagem.');
    }
  };

  const sendFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedId) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('action', 'send'); form.append('tenantId', tenantId); form.append('conversationId', selectedId);
      form.append('body', draft.trim()); form.append('attachment', file);
      await api('/api/internal-chat', { method: 'POST', body: form });
      setDraft('');
      await loadMessages(selectedId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar arquivo.');
    } finally { setBusy(false); }
  };

  const scheduleReminder = async (event: FormEvent) => {
    event.preventDefault();
    const recipientId = reminderRecipientId || currentUserId;
    if (!selectedId || !recipientId || !reminderText.trim() || !reminderAt) return;
    try {
      await api('/api/internal-chat', { method: 'POST', body: JSON.stringify({ action: 'reminder', tenantId, conversationId: selectedId, recipientId, text: reminderText, remindAt: new Date(reminderAt).toISOString() }) });
      setReminderText(''); setReminderAt(''); setShowReminder(false);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Falha ao agendar lembrete.'); }
  };

  const completeReminder = async () => {
    if (!activeReminder) return;
    const reminderId = activeReminder.id;
    setActiveReminder(null);
    await api('/api/internal-chat', { method: 'POST', body: JSON.stringify({ action: 'reminder-status', tenantId, reminderId, status: 'completed' }) }).catch(() => undefined);
  };

  return <>
    {activeReminder && <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"><section role="alertdialog" aria-modal="true" className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl"><div className="flex items-center gap-3 bg-amber-50 px-5 py-4 text-amber-900"><BellRing size={22} /><div><p className="text-[10px] font-black uppercase tracking-widest">Lembrete</p><h2 className="text-base font-black">Mensagem agendada</h2></div></div><div className="px-5 py-5"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{activeReminder.texto}</p><time className="mt-3 block text-xs text-slate-400">{new Date(activeReminder.lembrar_em).toLocaleString('pt-BR')}</time></div><div className="flex justify-end border-t border-slate-100 px-5 py-3"><button onClick={() => void completeReminder()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-black uppercase text-white"><Check size={16} /> Entendido</button></div></section></div>}
    <div className="fixed bottom-5 right-5 z-[120]">
      {open && <section className="mb-3 flex h-[min(650px,calc(100vh-100px))] w-[min(410px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between bg-[#294862] px-4 py-3 text-white"><div className="flex items-center gap-2"><MessageCircle size={18} /><div><p className="text-sm font-black">Chat com tenants</p><p className="text-[10px] text-white/60">Atendimento rapido da 791</p></div></div><div className="flex items-center gap-2"><div className="flex rounded-lg bg-white/10 p-1">{(['available', 'away', 'busy'] as PresenceStatus[]).map((status) => <button key={status} onClick={() => setMyStatus(status)} title={status === 'available' ? 'Disponivel' : status === 'away' ? 'Ausente' : 'Ocupado'} className={`flex h-6 w-6 items-center justify-center rounded-md ${myStatus === status ? 'bg-white/20' : ''}`}><span className={`h-2.5 w-2.5 rounded-full ${statusColor(status)}`} /></button>)}</div><button onClick={() => setOpen(false)} title="Fechar"><X size={17} /></button></div></header>
        <div className="border-b border-slate-100 p-3"><select value={tenantId} onChange={(event) => selectTenant(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><option value="">Selecione um tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.nome || tenant.slug}</option>)}</select></div>
        {error && <div className="bg-red-50 px-4 py-2 text-[11px] font-semibold text-red-700">{error}</div>}
        {!selectedId ? <div className="flex min-h-0 flex-1 flex-col"><div className="border-b border-slate-100 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500">Conversas</div><div className="min-h-0 flex-1 overflow-y-auto p-2">{conversations.map((conversation) => <button key={conversation.id} onClick={() => selectConversation(conversation.id)} className="w-full rounded-lg px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">{conversation.titulo || 'Conversa'}</button>)}{conversations.length === 0 && <p className="px-3 py-5 text-xs text-slate-400">Nenhuma conversa com este tenant.</p>}</div><div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500"><Users size={14} /> Pessoas</div><div className="max-h-44 overflow-y-auto p-2">{users.map((user) => <button key={user.user_id} disabled={busy} onClick={() => void startConversation(user.user_id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50"><span className={`h-2.5 w-2.5 rounded-full ${statusColor(presence[user.user_id])}`} /><span className="min-w-0 flex-1 truncate">{userName(user)}</span><UserPlus size={14} className="text-emerald-600" /></button>)}</div></div> : <>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"><button onClick={() => setSelectedId('')} className="text-xs font-bold text-emerald-700">Conversas</button><span className="text-slate-300">/</span><span className="truncate text-sm font-bold text-slate-700">{selectedConversation?.titulo || 'Conversa'}</span></div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/70 p-3">{messages.map((message) => <div key={message.id} className={`max-w-[82%] rounded-2xl px-3 py-2 text-xs ${message.sender_id === currentUserId ? 'ml-auto bg-emerald-600 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>{message.body && <p className="whitespace-pre-wrap">{message.body}</p>}{(message.internal_chat_attachments || []).map((attachment) => <a key={attachment.id} href={attachment.url || '#'} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 rounded-lg border border-current/20 px-2 py-2 font-bold hover:underline"><Download size={14} /><span className="truncate">{attachment.file_name}</span></a>)}<time className="mt-1 block text-[9px] opacity-60">{new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div>
          {showReminder && <form onSubmit={scheduleReminder} className="space-y-2 border-t border-amber-100 bg-amber-50 p-3"><div className="flex gap-2"><select value={reminderRecipientId || currentUserId} onChange={(event) => setReminderRecipientId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2 text-xs"><option value={currentUserId}>Eu mesmo</option>{reminderUsers.map((user) => <option key={user.user_id} value={user.user_id}>{userName(user)}</option>)}</select><input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2 text-xs" /></div><div className="flex gap-2"><input value={reminderText} onChange={(event) => setReminderText(event.target.value)} placeholder="Texto do lembrete" className="h-9 min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2 text-xs" /><button disabled={!reminderText.trim() || !reminderAt} className="rounded-lg bg-amber-500 px-3 text-xs font-bold text-white disabled:opacity-40">Agendar</button></div></form>}
          <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3"><input ref={fileInputRef} type="file" className="hidden" onChange={sendFile} /><button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} title="Enviar arquivo" className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500"><Paperclip size={16} /></button><button type="button" onClick={() => setShowReminder((current) => !current)} title="Agendar lembrete" className={`flex h-10 w-10 items-center justify-center rounded-lg border ${showReminder ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}><Clock3 size={16} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escreva..." className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs" /><button disabled={!draft.trim()} title="Enviar" className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white disabled:opacity-40"><Send size={15} /></button></form>
        </>}
      </section>}
      <button onClick={toggleOpen} title="Abrir chat com tenants" className="ml-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700"><MessageCircle size={22} /></button>
    </div>
  </>;
}