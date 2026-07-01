"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Loader2, Lock, Eye, EyeOff, CheckCircle2, KeyRound, AlertCircle } from 'lucide-react';

export default function SetPasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(true); // aguardando sessão
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  useEffect(() => {
    // Extrair tokens do hash da URL enviada pelo Supabase no e-mail
    const hash = window.location.hash;
    if (!hash) {
      setError('Link inválido ou expirado. Solicite um novo e-mail de acesso.');
      setPreparing(false);
      return;
    }

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');

    if (!accessToken || !refreshToken || !['invite', 'recovery'].includes(type || '')) {
      setError('Link inválido ou expirado. Solicite um novo e-mail de acesso.');
      setPreparing(false);
      return;
    }

    // Estabelecer sessão com os tokens do link
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError('Link expirado ou já utilizado. Solicite um novo e-mail de acesso.');
        }
        setPreparing(false);
      });
  }, []);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

      if (updateError) {
        setError('Erro ao definir senha: ' + updateError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);

      // Aguardar 1.5s e redirecionar adequadamente
      setTimeout(async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userEmail = userData?.user?.email || '';

        if (userData?.user?.user_metadata?.role === 'sponsor') {
          const { data: sp } = await supabase
            .from('patrocinadores')
            .select('id')
            .eq('email', userEmail)
            .single();
          if (sp) {
            router.push(`/portal/${sp.id}`);
            return;
          }
        }
        router.push('/');
      }, 1500);

    } catch (err) {
      setError('Ocorreu um erro inesperado.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#3b597b] text-white shadow-lg">
            <KeyRound size={28} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">Criar sua Senha</h2>
          <p className="mt-2 text-sm text-slate-500">Defina uma senha para acessar seu portal exclusivo</p>
        </div>

        {/* Estado: carregando sessão */}
        {preparing && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="animate-spin text-[#3b597b]" size={32} />
            <p className="text-sm text-slate-500">Validando seu link de acesso...</p>
          </div>
        )}

        {/* Estado: sucesso */}
        {!preparing && success && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 size={52} className="text-emerald-500" />
            <p className="text-emerald-700 font-semibold text-center text-lg">Senha criada com sucesso!</p>
            <p className="text-sm text-slate-400 text-center">Redirecionando para seu portal...</p>
            <Loader2 className="animate-spin text-slate-400 mt-2" size={20} />
          </div>
        )}

        {/* Estado: erro fatal (link expirado) */}
        {!preparing && !success && error && newPassword === '' && confirmPassword === '' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <AlertCircle size={48} className="text-red-400" />
            <p className="text-red-600 font-semibold text-center">{error}</p>
            <button
              onClick={() => router.push('/login')}
              className="mt-2 text-sm text-[#3b597b] underline hover:text-[#2e4762]"
            >
              Voltar para o login
            </button>
          </div>
        )}

        {/* Estado: formulário */}
        {!preparing && !success && !(error && newPassword === '' && confirmPassword === '') && (
          <form className="space-y-5" onSubmit={handleSetPassword}>
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Nova senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock size={18} />
                </div>
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                  placeholder="Mínimo 8 caracteres"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Confirmar senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock size={18} />
                </div>
                <input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                  placeholder="Repita a senha"
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600">
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-lg bg-[#3b597b] py-3.5 text-sm font-bold text-white hover:bg-[#2e4762] focus:outline-none disabled:opacity-70 transition-all shadow-md active:scale-[0.98] mt-2 items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : null}
              {loading ? 'SALVANDO...' : 'DEFINIR SENHA E ACESSAR'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-slate-400 pt-6">
          © 2026 791 Soluções Holding. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
