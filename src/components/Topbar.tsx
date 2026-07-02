"use client";

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type TopbarUser = {
  name: string;
  email: string;
  avatarUrl: string | null;
};

export function Topbar() {
  const pathname = usePathname();
  const supabase = createSupabaseBrowser();
  const [user, setUser] = useState<TopbarUser | null>(null);

  useEffect(() => {
    let active = true;

    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      const currentUser = data.user;
      if (!currentUser) {
        setUser(null);
        return;
      }

      setUser({
        name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Admin',
        email: currentUser.email || '',
        avatarUrl: currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null,
      });

      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token || !currentUser.email) return;

      const response = await fetch(`/api/admin/users/${encodeURIComponent(currentUser.email.toLowerCase())}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });

      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      const cadastroAvatar = payload?.avatarUrl ? String(payload.avatarUrl) : null;
      if (!cadastroAvatar) return;

      setUser((prev) => {
        if (!prev) return prev;
        return { ...prev, avatarUrl: cadastroAvatar };
      });
    }

    loadUser().catch((err) => {
      console.error('Falha ao carregar avatar do topo:', err);
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  const initials = (user?.name || user?.email || 'AD')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'AD';
  
  if (pathname === '/login') return null;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center text-sm text-slate-500">
        <button className="mr-4 text-slate-400 hover:text-slate-600">
          <Search size={20} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="ml-2 h-8 w-8 overflow-hidden rounded-full border border-slate-200 bg-[#3b597b] text-[10px] font-black text-white cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center">
          {user ? (
            user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name || 'Perfil'} className="h-full w-full object-cover" />
            ) : (
              <span>{initials}</span>
            )
          ) : (
            <span>{initials}</span>
          )}
        </div>
      </div>
    </header>
  );
}
