"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Loader2, Lock, Mail, Eye, EyeOff, CheckCircle2, KeyRound } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // 'login' | 'set_password'
  const [mode, setMode] = useState<'login' | 'set_password'>('login');
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  // Detectar se o Supabase redirecionou com um token de convite ou recuperação de senha
  useEffect(() => {
    const hash = window.location.hash;
    // Supabase usa type=invite para convites e type=recovery para resets de senha
    if (hash && (hash.includes('type=recovery') || hash.includes('type=invite'))) {
      setMode('set_password');
    }
  }, []);

  // Formulário de criação/redefinição de senha (após clicar no link do e-mail)
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
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        setError('Erro ao definir senha: ' + updateError.message);
        setLoading(false);
        return;
      }

      setSuccess('Senha definida com sucesso! Redirecionando...');

      // Verificar se é patrocinador e redirecionar adequadamente
      const { data: userData } = await supabase.auth.getUser();
      const userEmail = userData?.user?.email || '';

      if (userData?.user?.user_metadata?.role === 'sponsor') {
        const { data: sp } = await supabase.from('patrocinadores').select('id').eq('email', userEmail).single();
        if (sp) {
          router.push(`/portal/${sp.id}`);
          router.refresh();
          return;
        }
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setError('Ocorreu um erro inesperado.');
      setLoading(false);
    }
  };

  // Formulário de login normal
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError('Credenciais inválidas ou erro no acesso.');
        setLoading(false);
        return;
      }

      // Verificar se é patrocinador
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.user_metadata?.role === 'sponsor') {
        const { data: sp } = await supabase.from('patrocinadores').select('id').eq('email', email).single();
        if (sp) {
          router.push(`/portal/${sp.id}`);
          router.refresh();
          return;
        }
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setError('Ocorreu um erro inesperado.');
      setLoading(false);
    }
  };

  // ── MODO: Definir nova senha ────────────────────────────────────────────────
  if (mode === 'set_password') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] p-4">
        <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#3b597b] text-white shadow-lg">
              <KeyRound size={28} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">Criar sua Senha</h2>
            <p className="mt-2 text-sm text-slate-500">Defina uma senha para acessar seu portal</p>
          </div>

          {success ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 size={48} className="text-emerald-500" />
              <p className="text-emerald-700 font-semibold text-center">{success}</p>
              <Loader2 className="animate-spin text-slate-400" size={20} />
            </div>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handleSetPassword}>
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
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                    placeholder="Mínimo 8 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Confirmar nova senha
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Lock size={18} />
                  </div>
                  <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                    placeholder="Repita a senha"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative flex w-full justify-center rounded-lg bg-[#3b597b] py-3.5 text-sm font-bold text-white hover:bg-[#2e4762] focus:outline-none focus:ring-2 focus:ring-[#3b597b] focus:ring-offset-2 disabled:opacity-70 transition-all shadow-md active:scale-[0.98] mt-2"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  "DEFINIR SENHA E ACESSAR"
                )}
              </button>
            </form>
          )}

          <p className="text-center text-xs text-slate-400 pt-2">
            © 2026 791 Soluções Holding. Todos os direitos reservados.
          </p>
        </div>
      </div>
    );
  }

  // ── MODO: Login normal ───────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] p-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#3b597b] text-white shadow-lg">
            <span className="text-xl font-black">791</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">Acesso Restrito</h2>
          <p className="mt-2 text-sm text-slate-500">791 Soluções - Painel de Controle</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100 animate-in fade-in slide-in-from-top-2 duration-300">
              {error}
            </div>
          )}
          
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Mail size={18} />
              </div>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                placeholder="nome@791solucoes.com.br"
              />
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Lock size={18} />
              </div>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-10 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                placeholder="Sua senha secreta"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative flex w-full justify-center rounded-lg bg-[#3b597b] py-3 text-sm font-bold text-white hover:bg-[#2e4762] focus:outline-none focus:ring-2 focus:ring-[#3b597b] focus:ring-offset-2 disabled:opacity-70 transition-all shadow-md active:scale-[0.98]"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              "ENTRAR NO DASHBOARD"
            )}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 pt-4">
          © 2026 791 Soluções Holding. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
