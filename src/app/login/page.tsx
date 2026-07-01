"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Loader2, Lock, Mail, Eye, EyeOff, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // 'login' | 'forgot_password'
  const [mode, setMode] = useState<'login' | 'forgot_password'>('login');
  const [forgotEmail, setForgotEmail] = useState('');

  const router = useRouter();
  const supabase = createSupabaseBrowser();

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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: 'https://admin.791solucoes.com.br/set-password',
      });

      if (resetError) {
        setError('Erro ao enviar e-mail de recuperação: ' + resetError.message);
        setLoading(false);
        return;
      }

      setSuccess('E-mail de recuperação enviado com sucesso! Verifique sua caixa de entrada e pasta de Spam.');
      setForgotEmail('');
    } catch (err) {
      setError('Ocorreu um erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  // ── MODO: Esqueci minha senha ──────────────────────────────────────────────
  if (mode === 'forgot_password') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] p-4">
        <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-10 shadow-xl border border-slate-100 animate-in fade-in duration-300">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#3b597b] text-white shadow-lg">
              <KeyRound size={28} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">Recuperar Senha</h2>
            <p className="mt-2 text-sm text-slate-500">Digite seu e-mail para receber as instruções</p>
          </div>

          {success ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle2 size={48} className="text-emerald-500 animate-bounce" />
              <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-100 leading-relaxed font-medium">
                {success}
              </div>
              <button
                onClick={() => {
                  setSuccess(null);
                  setMode('login');
                }}
                className="mt-4 flex items-center gap-2 text-sm font-bold text-[#3b597b] hover:text-[#2e4762] transition-colors"
              >
                <ArrowLeft size={16} /> Voltar para o login
              </button>
            </div>
          ) : (
            <form className="mt-8 space-y-6" onSubmit={handleForgotPassword}>
              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100">
                  {error}
                </div>
              )}
              
              <div className="space-y-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Mail size={18} />
                  </div>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-slate-900 placeholder-slate-400 focus:border-[#3b597b] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 transition-all text-sm"
                    placeholder="Seu e-mail cadastrado"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative flex w-full justify-center rounded-lg bg-[#3b597b] py-3.5 text-sm font-bold text-white hover:bg-[#2e4762] focus:outline-none disabled:opacity-70 transition-all shadow-md active:scale-[0.98] items-center gap-2"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loading ? 'ENVIANDO...' : 'ENVIAR LINK DE RECUPERAÇÃO'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('login');
                  }}
                  className="flex w-full items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-700 py-2 transition-colors"
                >
                  <ArrowLeft size={14} /> Voltar para o login
                </button>
              </div>
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

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('forgot_password');
              }}
              className="text-xs font-bold text-[#3b597b] hover:text-[#2e4762] transition-colors"
            >
              Esqueceu sua senha?
            </button>
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
