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
    // 1. Interceptação imediata de hash na montagem (para convites e recuperações de senha)
    const initialHash = typeof window !== 'undefined' ? window.location.hash : '';
    if (initialHash && (initialHash.includes('type=recovery') || initialHash.includes('type=invite'))) {
      if (pathname !== '/set-password') {
        router.push('/set-password' + initialHash);
        setLoading(false);
        return;
      }
    }

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
          // É administrador. Se estiver no login, manda pro primeiro menu com permissão
          setSponsorId(null);
          if (pathname === '/login') {
            // Buscar permissões e redirecionar para primeiro menu disponível
            try {
              const token = authUser.user_metadata?.token || (await supabase.auth.getSession()).data?.session?.access_token;
              if (token) {
                const permRes = await fetch('/api/admin/permissions/me', {
                  headers: { 'Authorization': `Bearer ${token}` },
                });
                
                if (permRes.ok) {
                  const permData = await permRes.json();
                  const permissionCodes = new Set(permData.permission_codes || []);
                  
                  // Navegar para o primeiro menu com permissão
                  const menuOrder = ['/financeiro', '/notas-fiscais', '/suporte', '/assinaturas', '/'];
                  for (const menu of menuOrder) {
                    const resourceMap: Record<string, string> = {
                      '/financeiro': 'financeiro',
                      '/notas-fiscais': 'notas-fiscais',
                      '/suporte': 'suporte',
                      '/assinaturas': 'assinaturas',
                    };
                    const resource = resourceMap[menu];
                    
                    // Se não tem recurso mapeado ou tem permissão, vai para lá
                    if (!resource || permissionCodes.has(resource) || permissionCodes.size === 0) {
                      router.push(menu);
                      return;
                    }
                  }
                  // Fallback
                  router.push('/');
                } else {
                  router.push('/');
                }
              } else {
                router.push('/');
              }
            } catch (err) {
              console.error('Erro ao buscar permissões:', err);
              router.push('/');
            }
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
        window.location.href = '/login';
      } else if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') {
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const isResetFlow = event === 'PASSWORD_RECOVERY' || (hash && (hash.includes('type=recovery') || hash.includes('type=invite')));
        
        if (isResetFlow && pathname !== '/set-password') {
          // Redireciona imediatamente para a tela de definir senha com o hash
          router.push('/set-password' + hash);
        } else {
          checkAuth();
        }
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
  const isSponsor = user?.user_metadata?.role === 'sponsor';

  if (isLogin || isPortal || isSetPassword || isSponsor) {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-slate-50">
        {isSponsor && !isPortal && !isSetPassword ? (
          <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-50 gap-3">
            <Loader2 className="animate-spin text-[#3b597b]" size={40} />
            <span className="text-sm font-bold text-slate-500 uppercase tracking-widest animate-pulse">Redirecionando para o Portal...</span>
          </div>
        ) : (
          children
        )}
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
