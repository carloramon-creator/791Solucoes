"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import {
  ArrowRight,
  Check,
  Clock,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  PencilLine,
  Save,
  Shield,
  Upload,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';

type TeamMember = {
  id: string;
  email: string;
  nome: string | null;
  cargo: string | null;
  created_at: string;
  last_sign_in_at?: string;
  cpf?: string | null;
  whatsapp?: string | null;
  cep?: string | null;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_complemento?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_uf?: string | null;
  salario_mensal?: number | null;
  periodo_trabalho_inicio?: string | null;
  periodo_trabalho_fim?: string | null;
  jornada_inicio?: string | null;
  jornada_fim?: string | null;
  foto_path?: string | null;
  avatarUrl?: string | null;
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

type UserDocument = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: string | null;
  signedUrl: string | null;
};

type UserDetailsForm = {
  nome: string;
  cpf: string;
  email: string;
  whatsapp: string;
  cep: string;
  enderecoRua: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoCidade: string;
  enderecoUf: string;
  salarioMensal: string;
  periodoTrabalhoInicio: string;
  periodoTrabalhoFim: string;
  jornadaInicio: string;
  jornadaFim: string;
};

type InviteDetailsForm = Omit<UserDetailsForm, 'email'>;

type CepLookupResult = {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
};

const fallbackCargos = ['Dono', 'Gerente', 'Financeiro', 'Suporte', 'Operacoes'];

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function maskCpf(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function maskWhatsapp(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function maskCep(value: string): string {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function formatMoneyFromNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '';
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoneyInput(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return '';
  const parsed = Number(digits) / 100;
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoneyInput(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).slice(0, 5);
}

function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function buildForm(member: TeamMember | null): UserDetailsForm {
  return {
    nome: member?.nome || '',
    cpf: member?.cpf || '',
    email: member?.email || '',
    whatsapp: member?.whatsapp || '',
    cep: member?.cep || '',
    enderecoRua: member?.endereco_rua || '',
    enderecoNumero: member?.endereco_numero || '',
    enderecoComplemento: member?.endereco_complemento || '',
    enderecoBairro: member?.endereco_bairro || '',
    enderecoCidade: member?.endereco_cidade || '',
    enderecoUf: member?.endereco_uf || '',
    salarioMensal: formatMoneyFromNumber(member?.salario_mensal),
    periodoTrabalhoInicio: toDateInput(member?.periodo_trabalho_inicio),
    periodoTrabalhoFim: toDateInput(member?.periodo_trabalho_fim),
    jornadaInicio: toTimeInput(member?.jornada_inicio),
    jornadaFim: toTimeInput(member?.jornada_fim),
  };
}

export default function EquipePage() {
  const supabase = createSupabaseBrowser();
  const cepCacheRef = useRef<Map<string, CepLookupResult>>(new Map());
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserEmail, setSavingUserEmail] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editingProfileId, setEditingProfileId] = useState('');
  const [editingDetails, setEditingDetails] = useState<UserDetailsForm>(buildForm(null));
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [generatingResetLink, setGeneratingResetLink] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteProfileId, setInviteProfileId] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteDetails, setInviteDetails] = useState<InviteDetailsForm>({
    nome: '',
    cpf: '',
    whatsapp: '',
    cep: '',
    enderecoRua: '',
    enderecoNumero: '',
    enderecoComplemento: '',
    enderecoBairro: '',
    enderecoCidade: '',
    enderecoUf: '',
    salarioMensal: '',
    periodoTrabalhoInicio: '',
    periodoTrabalhoFim: '',
    jornadaInicio: '',
    jornadaFim: '',
  });
  const [inviting, setInviting] = useState(false);
  const [loadingInviteCep, setLoadingInviteCep] = useState(false);
  const [loadingEditCep, setLoadingEditCep] = useState(false);
  const [lastInviteCepLookup, setLastInviteCepLookup] = useState('');
  const [lastEditCepLookup, setLastEditCepLookup] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const permissionProfileOptions = useMemo(() => {
    const activeProfiles = profiles.filter((profile) => profile.active);
    if (activeProfiles.length > 0) return activeProfiles;
    return fallbackCargos.map((name, index) => ({ id: `fallback-${index}`, name, active: true }));
  }, [profiles]);

  useEffect(() => {
    if (!inviteProfileId && permissionProfileOptions.length > 0) {
      setInviteProfileId(permissionProfileOptions[0].id);
    }
  }, [inviteProfileId, permissionProfileOptions]);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, [supabase]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getToken();
    if (!token) throw new Error('Sessao expirada.');

    const isFormDataBody = init?.body instanceof FormData;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (!isFormDataBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (init?.headers && typeof init.headers === 'object') {
      Object.assign(headers, init.headers as Record<string, string>);
    }

    const response = await fetch(path, {
      ...init,
      headers,
      cache: 'no-store',
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.error || 'Erro na requisicao');
    }
    return json;
  }, [getToken]);

  const refresh = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    setCurrentUser(userData.user);

    const [teamResult, permissionsResult] = await Promise.all([
      supabase
        .from('equipe_791')
        .select('*')
        .order('created_at', { ascending: true }),
      api('/api/admin/permissions') as Promise<PermissionProfileResponse>,
    ]);

    if (!teamResult.error) {
      const teamMembers = (teamResult.data || []) as TeamMember[];
      const withAvatars = await Promise.all(teamMembers.map(async (member) => {
        try {
          const detail = await api(`/api/admin/users/${encodeURIComponent(String(member.email || '').toLowerCase())}`);
          return { ...member, avatarUrl: detail?.avatarUrl ? String(detail.avatarUrl) : null };
        } catch {
          return { ...member, avatarUrl: null };
        }
      }));

      setMembers(withAvatars);
    }

    const activeProfiles = (permissionsResult.profiles || [])
      .filter((profile) => profile.active)
      .map((profile) => ({ id: profile.id, name: profile.name, active: profile.active }));

    setProfiles(activeProfiles);
  }, [api, supabase]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        await refresh();
      } catch (err: any) {
        setFeedback({ type: 'error', msg: err?.message || 'Falha ao carregar usuarios.' });
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
        email: inviteEmail.toLowerCase().trim(),
        nome: inviteDetails.nome || inviteName,
        cargo,
        cpf: inviteDetails.cpf || null,
        whatsapp: inviteDetails.whatsapp || null,
        cep: inviteDetails.cep || null,
        endereco_rua: inviteDetails.enderecoRua || null,
        endereco_numero: inviteDetails.enderecoNumero || null,
        endereco_complemento: inviteDetails.enderecoComplemento || null,
        endereco_bairro: inviteDetails.enderecoBairro || null,
        endereco_cidade: inviteDetails.enderecoCidade || null,
        endereco_uf: inviteDetails.enderecoUf || null,
        salario_mensal: parseMoneyInput(inviteDetails.salarioMensal),
        periodo_trabalho_inicio: inviteDetails.periodoTrabalhoInicio || null,
        periodo_trabalho_fim: inviteDetails.periodoTrabalhoFim || null,
        jornada_inicio: inviteDetails.jornadaInicio || null,
        jornada_fim: inviteDetails.jornadaFim || null,
        criado_por: currentUser?.id,
      });

      if (error) throw error;

      if (selectedProfile && !selectedProfile.id.startsWith('fallback-')) {
        await api(`/api/admin/permissions/users/${encodeURIComponent(inviteEmail.toLowerCase().trim())}`, {
          method: 'PATCH',
          body: JSON.stringify({ profileIds: [selectedProfile.id] }),
        });
      }

      setFeedback({ type: 'success', msg: `${inviteName} adicionado com sucesso.` });
      setInviteEmail('');
      setInviteName('');
      setInvitePassword('');
      setInviteDetails({
        nome: '',
        cpf: '',
        whatsapp: '',
        cep: '',
        enderecoRua: '',
        enderecoNumero: '',
        enderecoComplemento: '',
        enderecoBairro: '',
        enderecoCidade: '',
        enderecoUf: '',
        salarioMensal: '',
        periodoTrabalhoInicio: '',
        periodoTrabalhoFim: '',
        jornadaInicio: '',
        jornadaFim: '',
      });
      setInviteProfileId(permissionProfileOptions[0]?.id || '');
      setShowForm(false);
      await refresh();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setInviting(false);
    }
  };

  const loadUserDetails = useCallback(async (member: TeamMember) => {
    setLoadingDetails(true);
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(member.email.toLowerCase())}`);
      const mergedMember = ({ ...member, ...(result.member || {}) } as TeamMember);
      setEditingDetails(buildForm(mergedMember));
      setDocuments(Array.isArray(result.documents) ? result.documents : []);
      setAvatarUrl(result?.avatarUrl ? String(result.avatarUrl) : null);
    } catch {
      setEditingDetails(buildForm(member));
      setDocuments([]);
      setAvatarUrl(null);
    } finally {
      setLoadingDetails(false);
    }
  }, [api]);

  const openEditUser = (member: TeamMember) => {
    const currentProfile = profiles.find((profile) =>
      profile.active && (
        profile.name === member.cargo ||
        profile.name.toLowerCase() === String(member.cargo || '').toLowerCase()
      )
    );

    setEditingMember(member);
    setEditingProfileId(currentProfile?.id || '');
    setEditingDetails(buildForm(member));
    setDocuments([]);
    setAvatarUrl(null);
    void loadUserDetails(member);
  };

  const closeEditUser = () => {
    setEditingMember(null);
    setEditingProfileId('');
    setEditingDetails(buildForm(null));
    setDocuments([]);
    setAvatarUrl(null);
  };

  const handleUploadPhoto = async (file: File | null) => {
    if (!editingMember || !file) return;

    setUploadingPhoto(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await api(`/api/admin/users/${encodeURIComponent(editingMember.email.toLowerCase())}/photo`, {
        method: 'POST',
        body: formData,
      });

      setAvatarUrl(result?.avatarUrl ? String(result.avatarUrl) : null);
      setFeedback({ type: 'success', msg: 'Foto do usuario atualizada com sucesso.' });
      await refresh();
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Falha ao enviar foto do usuario.' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const lookupCep = useCallback(async (rawCep: string): Promise<CepLookupResult | null> => {
    const cep = onlyDigits(rawCep);
    if (cep.length !== 8) return null;

    const cached = cepCacheRef.current.get(cep);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.erro) return null;

      const result = {
        logradouro: String(data?.logradouro || '').trim(),
        bairro: String(data?.bairro || '').trim(),
        localidade: String(data?.localidade || '').trim(),
        uf: String(data?.uf || '').trim().toUpperCase(),
      };

      cepCacheRef.current.set(cep, result);

      return result;
    } catch {
      return null;
    }
  }, []);

  const applyInviteCepLookup = useCallback(async (cepValue: string) => {
    const cep = cepValue;
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return;
    if (digits === lastInviteCepLookup) return;

    setLoadingInviteCep(true);
    setLastInviteCepLookup(digits);
    const found = await lookupCep(cep);
    setLoadingInviteCep(false);

    if (!found) return;

    setInviteDetails((prev) => ({
      ...prev,
      enderecoRua: found.logradouro || prev.enderecoRua,
      enderecoBairro: found.bairro || prev.enderecoBairro,
      enderecoCidade: found.localidade || prev.enderecoCidade,
      enderecoUf: found.uf || prev.enderecoUf,
    }));
  }, [lastInviteCepLookup, lookupCep]);

  const applyEditCepLookup = useCallback(async (cepValue: string) => {
    const cep = cepValue;
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return;
    if (digits === lastEditCepLookup) return;

    setLoadingEditCep(true);
    setLastEditCepLookup(digits);
    const found = await lookupCep(cep);
    setLoadingEditCep(false);

    if (!found) return;

    setEditingDetails((prev) => ({
      ...prev,
      enderecoRua: found.logradouro || prev.enderecoRua,
      enderecoBairro: found.bairro || prev.enderecoBairro,
      enderecoCidade: found.localidade || prev.enderecoCidade,
      enderecoUf: found.uf || prev.enderecoUf,
    }));
  }, [lastEditCepLookup, lookupCep]);

  useEffect(() => {
    const digits = onlyDigits(inviteDetails.cep);
    if (digits.length === 8) {
      void applyInviteCepLookup(inviteDetails.cep);
    }
    if (digits.length < 8) {
      setLastInviteCepLookup('');
    }
  }, [inviteDetails.cep, applyInviteCepLookup]);

  useEffect(() => {
    const digits = onlyDigits(editingDetails.cep);
    if (digits.length === 8) {
      void applyEditCepLookup(editingDetails.cep);
    }
    if (digits.length < 8) {
      setLastEditCepLookup('');
    }
  }, [editingDetails.cep, applyEditCepLookup]);

  const handleSaveUser = async () => {
    if (!editingMember) return;

    setSavingUserEmail(editingMember.email);
    setFeedback(null);

    try {
      const selectedProfile = permissionProfileOptions.find((profile) => profile.id === editingProfileId) || null;

      await api(`/api/admin/permissions/users/${encodeURIComponent(editingMember.email.toLowerCase())}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileIds: selectedProfile && !selectedProfile.id.startsWith('fallback-') ? [selectedProfile.id] : [] }),
      });

      await api(`/api/admin/users/${encodeURIComponent(editingMember.email.toLowerCase())}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nome: editingDetails.nome,
          cpf: editingDetails.cpf,
          whatsapp: editingDetails.whatsapp,
          cep: editingDetails.cep,
          enderecoRua: editingDetails.enderecoRua,
          enderecoNumero: editingDetails.enderecoNumero,
          enderecoComplemento: editingDetails.enderecoComplemento,
          enderecoBairro: editingDetails.enderecoBairro,
          enderecoCidade: editingDetails.enderecoCidade,
          enderecoUf: editingDetails.enderecoUf,
          salarioMensal: parseMoneyInput(editingDetails.salarioMensal),
          periodoTrabalhoInicio: editingDetails.periodoTrabalhoInicio || null,
          periodoTrabalhoFim: editingDetails.periodoTrabalhoFim || null,
          jornadaInicio: editingDetails.jornadaInicio || null,
          jornadaFim: editingDetails.jornadaFim || null,
        }),
      });

      await refresh();
      setFeedback({ type: 'success', msg: `Dados de ${editingMember.email} atualizados.` });
      await loadUserDetails(editingMember);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message });
    } finally {
      setSavingUserEmail(null);
    }
  };

  const handleGenerateResetLink = async () => {
    if (!editingMember) return;
    setGeneratingResetLink(true);
    setFeedback(null);

    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(editingMember.email.toLowerCase())}/password-reset-link`, {
        method: 'POST',
      });

      const link = result?.actionLink;
      if (link) {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          // ignore clipboard failure
        }
        window.open(link, '_blank', 'noopener,noreferrer');
      }

      setFeedback({ type: 'success', msg: 'Link de redefinicao de senha gerado e aberto em nova aba.' });
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Falha ao gerar link de senha.' });
    } finally {
      setGeneratingResetLink(false);
    }
  };

  const handleUploadDocument = async (file: File | null) => {
    if (!editingMember || !file) return;
    setUploadingDocument(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await api(`/api/admin/users/${encodeURIComponent(editingMember.email.toLowerCase())}/documents`, {
        method: 'POST',
        body: formData,
      });

      if (result?.document) {
        setDocuments((prev) => [result.document as UserDocument, ...prev]);
      }

      setFeedback({ type: 'success', msg: 'Documento enviado com sucesso.' });
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Falha ao enviar documento.' });
    } finally {
      setUploadingDocument(false);
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Users className="text-[#3b597b]" size={24} />
            Usuarios
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Lista completa de usuarios com dados pessoais, jornada, salario, senha e documentos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/configuracoes/permissoes"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition-all"
          >
            <Shield size={16} />
            Gerenciar perfis
            <ArrowRight size={14} />
          </Link>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#3b597b] text-white text-sm font-bold rounded-xl hover:bg-[#2e4763] transition-all shadow-sm shadow-[#3b597b]/30 hover:shadow-md hover:-translate-y-0.5"
          >
            <UserPlus size={16} />
            Adicionar Usuario
          </button>
        </div>
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
          <h2 className="text-[13px] font-bold text-slate-700 uppercase tracking-wider mb-5">Novo Usuario</h2>
          <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Nome Completo</label>
              <input
                type="text"
                value={inviteDetails.nome}
                onChange={(e) => {
                  setInviteName(e.target.value);
                  setInviteDetails((prev) => ({ ...prev, nome: e.target.value }));
                }}
                required
                placeholder="Carlos Eduardo"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
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
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Perfil de Permissao</label>
              <div className="relative">
                <Shield size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={inviteProfileId}
                  onChange={(e) => setInviteProfileId(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] appearance-none transition-all"
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
                  placeholder="Opcional"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] font-medium text-slate-800 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b] transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">CPF</label>
              <input
                value={inviteDetails.cpf}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, cpf: maskCpf(e.target.value) }))}
                placeholder="000.000.000-00"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">WhatsApp</label>
              <input
                value={inviteDetails.whatsapp}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, whatsapp: maskWhatsapp(e.target.value) }))}
                placeholder="(00) 00000-0000"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">CEP</label>
              <input
                value={inviteDetails.cep}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, cep: maskCep(e.target.value) }))}
                placeholder="00000-000"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
              {loadingInviteCep && <span className="text-[10px] text-slate-500">Buscando endereco pelo CEP...</span>}
            </div>

            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Rua</label>
              <input
                value={inviteDetails.enderecoRua}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, enderecoRua: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Numero</label>
              <input
                value={inviteDetails.enderecoNumero}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, enderecoNumero: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Complemento</label>
              <input
                value={inviteDetails.enderecoComplemento}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, enderecoComplemento: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Bairro</label>
              <input
                value={inviteDetails.enderecoBairro}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, enderecoBairro: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cidade</label>
              <input
                value={inviteDetails.enderecoCidade}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, enderecoCidade: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">UF</label>
              <input
                value={inviteDetails.enderecoUf}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, enderecoUf: e.target.value.toUpperCase().slice(0, 2) }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] uppercase"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Salario mensal (R$)</label>
              <input
                value={inviteDetails.salarioMensal}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, salarioMensal: formatMoneyInput(e.target.value) }))}
                placeholder="0,00"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Inicio contrato</label>
              <input
                type="date"
                value={inviteDetails.periodoTrabalhoInicio}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, periodoTrabalhoInicio: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Fim contrato</label>
              <input
                type="date"
                value={inviteDetails.periodoTrabalhoFim}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, periodoTrabalhoFim: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Jornada inicio</label>
              <input
                type="time"
                value={inviteDetails.jornadaInicio}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, jornadaInicio: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Jornada fim</label>
              <input
                type="time"
                value={inviteDetails.jornadaFim}
                onChange={(e) => setInviteDetails((prev) => ({ ...prev, jornadaFim: e.target.value }))}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px]"
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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider font-bold text-slate-500">
              <th className="p-4 pl-6 text-left">Usuario</th>
              <th className="p-4 text-left">Perfil</th>
              <th className="p-4 text-left">Desde</th>
              <th className="p-4 text-left">Ultimo Acesso</th>
              <th className="p-4 pr-6 text-right">Acoes</th>
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
                <td colSpan={5} className="p-12 text-center text-slate-500 text-sm">
                  Nenhum usuario cadastrado.
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4 pl-6">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#3b597b] flex items-center justify-center text-white text-[11px] font-black shrink-0 overflow-hidden">
                        {member.avatarUrl ? (
                          <img src={member.avatarUrl} alt="Avatar do usuario" className="w-full h-full object-cover" />
                        ) : (
                          (member.nome || member.email || 'U').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="text-[13px] font-bold text-slate-800">{member.nome || '—'}</div>
                        <div className="text-[11px] text-slate-500">{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-[#3b597b]/10 text-[#3b597b] text-[10px] font-bold uppercase tracking-wider rounded-full">
                      {member.cargo || 'Sem perfil'}
                    </span>
                  </td>
                  <td className="p-4 text-[12px] text-slate-500 font-medium">
                    {member.created_at ? new Date(member.created_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="p-4 text-[12px] text-slate-500 font-medium">
                    {member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="p-4 pr-6 text-right">
                    <button
                      onClick={() => openEditUser(member)}
                      disabled={savingUserEmail === member.email}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#3b597b] text-white text-[11px] font-bold rounded-md hover:bg-[#2e4763] disabled:opacity-60"
                    >
                      <PencilLine size={14} />
                      Editar usuario
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-4 overflow-hidden">
          <div className="w-full max-w-[96vw] xl:max-w-7xl h-[90vh] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3.5 flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-2.5">
              <div>
                <h2 className="text-base font-bold text-slate-800 uppercase tracking-tight">Editar usuario</h2>
                <p className="text-xs text-slate-500">Dados completos, permissao, salario, jornada, senha e documentos.</p>
              </div>
              <button onClick={closeEditUser} className="text-slate-400 hover:text-slate-700">×</button>
            </div>

            <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-[13px] font-bold text-slate-800">{editingMember.nome || '—'}</div>
              <div className="text-xs text-slate-500">{editingMember.email}</div>
            </div>

            {loadingDetails ? (
              <div className="flex-1 py-10 text-center text-slate-500 text-sm flex items-center justify-center">
                <div>
                <Loader2 className="animate-spin mx-auto mb-2" />
                Carregando detalhes do usuario...
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-2">
                <div className="space-y-1.5 min-h-0">
                  <div className="rounded-xl border border-slate-200 p-2.5">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <div className="w-14 h-14 rounded-full bg-[#3b597b] text-white flex items-center justify-center text-sm font-black overflow-hidden shrink-0">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Foto do usuario" className="w-full h-full object-cover" />
                        ) : (
                          (editingDetails.nome || editingDetails.email || 'U').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Foto do usuario</p>
                        <div className="flex items-center gap-3">
                          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                            <Upload size={14} />
                            Upload de foto
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null;
                                void handleUploadPhoto(file);
                                e.currentTarget.value = '';
                              }}
                              disabled={uploadingPhoto}
                            />
                          </label>
                          {uploadingPhoto && (
                            <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                              <Loader2 size={12} className="animate-spin" />
                              Enviando foto...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nome completo</label>
                      <input
                        value={editingDetails.nome}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, nome: e.target.value }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Perfil de permissao</label>
                      <select
                        value={editingProfileId}
                        onChange={(e) => setEditingProfileId(e.target.value)}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      >
                        <option value="">Sem perfil</option>
                        {permissionProfileOptions.map((profile) => (
                          <option key={profile.id} value={profile.id}>{profile.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">CPF</label>
                    <input
                      value={editingDetails.cpf}
                      onChange={(e) => setEditingDetails((prev) => ({ ...prev, cpf: maskCpf(e.target.value) }))}
                      placeholder="000.000.000-00"
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">E-mail</label>
                    <input
                      value={editingDetails.email}
                      readOnly
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-100 text-[12px] text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">WhatsApp</label>
                    <input
                      value={editingDetails.whatsapp}
                      onChange={(e) => setEditingDetails((prev) => ({ ...prev, whatsapp: maskWhatsapp(e.target.value) }))}
                      placeholder="(00) 00000-0000"
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2 text-slate-700 mb-2">
                    <MapPin size={14} />
                    <h3 className="text-xs font-bold uppercase tracking-wider">Endereco completo</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">CEP</label>
                      <input
                        value={editingDetails.cep}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, cep: maskCep(e.target.value) }))}
                        placeholder="00000-000"
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                      {loadingEditCep && <span className="text-[10px] text-slate-500">Buscando endereco pelo CEP...</span>}
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rua</label>
                      <input
                        value={editingDetails.enderecoRua}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, enderecoRua: e.target.value }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Numero</label>
                      <input
                        value={editingDetails.enderecoNumero}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, enderecoNumero: e.target.value }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Complemento</label>
                      <input
                        value={editingDetails.enderecoComplemento}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, enderecoComplemento: e.target.value }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bairro</label>
                      <input
                        value={editingDetails.enderecoBairro}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, enderecoBairro: e.target.value }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cidade</label>
                      <input
                        value={editingDetails.enderecoCidade}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, enderecoCidade: e.target.value }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">UF</label>
                      <input
                        value={editingDetails.enderecoUf}
                        onChange={(e) => setEditingDetails((prev) => ({ ...prev, enderecoUf: e.target.value.toUpperCase().slice(0, 2) }))}
                        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px] uppercase"
                      />
                    </div>
                  </div>
                </div>
                </div>

                <div className="space-y-1.5 min-h-0">
                  <div className="rounded-xl border border-slate-200 p-2.5">
                    <div className="flex items-center gap-2 text-slate-700 mb-2">
                      <Wallet size={14} />
                      <h3 className="text-xs font-bold uppercase tracking-wider">Salario</h3>
                    </div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Salario mensal (R$)</label>
                    <input
                      value={editingDetails.salarioMensal}
                      onChange={(e) => setEditingDetails((prev) => ({ ...prev, salarioMensal: formatMoneyInput(e.target.value) }))}
                      placeholder="0,00"
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 p-2.5">
                    <div className="flex items-center gap-2 text-slate-700 mb-2">
                      <Clock size={14} />
                      <h3 className="text-xs font-bold uppercase tracking-wider">Periodos de trabalho</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Inicio contrato</label>
                        <input
                          type="date"
                          value={editingDetails.periodoTrabalhoInicio}
                          onChange={(e) => setEditingDetails((prev) => ({ ...prev, periodoTrabalhoInicio: e.target.value }))}
                          className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fim contrato</label>
                        <input
                          type="date"
                          value={editingDetails.periodoTrabalhoFim}
                          onChange={(e) => setEditingDetails((prev) => ({ ...prev, periodoTrabalhoFim: e.target.value }))}
                          className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Jornada inicio</label>
                        <input
                          type="time"
                          value={editingDetails.jornadaInicio}
                          onChange={(e) => setEditingDetails((prev) => ({ ...prev, jornadaInicio: e.target.value }))}
                          className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Jornada fim</label>
                        <input
                          type="time"
                          value={editingDetails.jornadaFim}
                          onChange={(e) => setEditingDetails((prev) => ({ ...prev, jornadaFim: e.target.value }))}
                          className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-2.5 min-h-0">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Senha e documentos</h3>
                    <button
                      type="button"
                      onClick={handleGenerateResetLink}
                      disabled={generatingResetLink}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-60"
                    >
                      {generatingResetLink ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                      Gerar link de nova senha
                    </button>
                  </div>

                  <div className="flex flex-col md:flex-row gap-3 md:items-center mb-3">
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <Upload size={14} />
                      Upload de documento
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          void handleUploadDocument(file);
                          e.currentTarget.value = '';
                        }}
                        disabled={uploadingDocument}
                      />
                    </label>
                    {uploadingDocument && (
                      <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                        <Loader2 size={12} className="animate-spin" />
                        Enviando arquivo...
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {documents.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum documento enviado.</p>
                    ) : (
                      documents.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate flex items-center gap-2">
                              <FileText size={12} />
                              {doc.fileName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {formatBytes(doc.sizeBytes)} • {new Date(doc.createdAt).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          {doc.signedUrl && (
                            <a
                              href={doc.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#3b597b] hover:text-[#2e4763]"
                            >
                              Abrir
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeEditUser}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-50 transition-colors"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleSaveUser}
                disabled={savingUserEmail === editingMember.email || loadingDetails}
                className="px-5 py-2 bg-[#3b597b] text-white text-sm font-bold rounded-lg hover:bg-[#2e4763] transition-colors flex items-center gap-2 disabled:opacity-60"
              >
                {savingUserEmail === editingMember.email ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvar usuario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
