"use client";

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { Loader2 } from 'lucide-react';

export function MainLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createSupabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [sponsorId, setSponsorId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function checkAuth() {
      try {
        // ⚡ Se a URL contém token de convite/recuperação, deixar a página tratar o fluxo
        // Não redirecionar enquanto o usuário ainda não criou a senha
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        if (hash && (hash.includes('type=invite') || hash.includes('type=recovery'))) {
          setLoading(false);
          return;
        }

        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!active) return;

        if (!authUser) {
          setUser(null);
          setSponsorId(null);
          if (pathname !== '/login' && pathname !== '/set-password') {
            router.push('/login');
          }
          setLoading(false);
          return;
        }

        setUser(authUser);

        // Verificar se este e-mail pertence a um patrocinador
        const { data: sponsorData } = await supabase
          .from('patrocinadores')
          .select('id')
          .eq('email', authUser.email)
          .maybeSingle();

        if (!active) return;

        if (sponsorData) {
          setSponsorId(sponsorData.id);
          // Nunca redirecionar da página de criar senha
          if (pathname === '/set-password') {
            // Deixar o usuário criar a senha sem interrupção
          } else if (!pathname.startsWith('/portal/')) {
            // Se for patrocinador e tentar acessar rotas admin, redireciona para o portal dele
            router.push(`/portal/${sponsorData.id}`);
          } else {
            // Se estiver no portal, garantir que está acessando o portal correto dele
            const urlId = pathname.split('/')[2];
            if (urlId && urlId !== sponsorData.id) {
              router.push(`/portal/${sponsorData.id}`);
            }
          }
        } else {
          // É administrador. Se estiver no login, manda pro home admin
          setSponsorId(null);
          if (pathname === '/login') {
            router.push('/');
          }
        }
      } catch (err) {
        console.error('Erro na validação de login:', err);
      } finally {
        if (active) setLoading(false);
      }
    }

    checkAuth();

    // Escutar mudanças de autenticação
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setSponsorId(null);
        router.push('/login');
      } else if (event === 'SIGNED_IN') {
        checkAuth();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-50 gap-3">
        <Loader2 className="animate-spin text-[#3b597b]" size={40} />
        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest animate-pulse">Carregando painel...</span>
      </div>
    );
  }

  // Rotas limpas em tela cheia (Login, Set Password ou Portal do Patrocinador)
  const isPortal = pathname.startsWith('/portal/');
  const isLogin = pathname === '/login';
  const isSetPassword = pathname === '/set-password';

  if (isLogin || isPortal || isSetPassword) {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-slate-50">
        {children}
      </div>
    );
  }

  // Layout administrativo padrão
  return (
    <div className="flex h-screen bg-[#f8fafc] text-slate-900 overflow-hidden w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-[#f8fafc]">
          {children}
        </main>
      </div>
    </div>
  );
}
