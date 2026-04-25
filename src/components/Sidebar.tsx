"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Scissors, Building2, CreditCard, Receipt, Settings, Users, Percent, ChevronRight, ChevronDown, PanelLeftClose, LogOut, Loader2, FileCheck } from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

const navigationItems = [
  { name: 'Painel', href: '/', icon: LayoutDashboard },
  { name: 'FINANCEIRO', href: '/financeiro', icon: Receipt },
  { name: 'NOTAS FISCAIS', href: '/notas-fiscais', icon: FileCheck },
  { name: 'ASSINATURAS', href: '/assinaturas', icon: Users, hasSubmenu: true },
  {
    name: 'PLANOS',
    href: '/planos',
    icon: CreditCard,
    hasSubmenu: true,
    subItems: [
      { name: 'Glass', href: '/planos/glass' },
      { name: 'Barber', href: '/planos/barber' }
    ]
  },
  { name: 'CUPONS', href: '/cupons', icon: Percent },
  { name: 'CONFIGURAÇÕES', href: '/configuracoes', icon: Settings, hasSubmenu: false },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createSupabaseBrowser();

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({ 'PLANOS': true });
  const [loggingOut, setLoggingOut] = useState(false);
  const [displayName, setDisplayName] = useState('ADMIN');
  const [displayEmail, setDisplayEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setDisplayName(
          user.user_metadata?.full_name ||
          user.email?.split('@')[0]?.toUpperCase() ||
          'ADMIN'
        );
        setDisplayEmail(user.email || '');
      }
    });

    // Buscar Logo da Holding
    fetch('/api/system/nfse-config')
      .then(res => res.json())
      .then(data => {
        if (data?.logo_base64) {
          setLogoUrl(data.logo_base64);
        }
      })
      .catch(err => console.error('Erro ao carregar logo sidebar:', err));
  }, []);

  const toggleMenu = (e: React.MouseEvent, name: string, hasSubItems: boolean) => {
    if (hasSubItems) {
      e.preventDefault();
      setOpenMenus(prev => ({ ...prev, [name]: !prev[name] }));
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  if (pathname === '/login') return null;

  return (
    <div className="flex h-full w-[260px] flex-col bg-white border-r border-slate-200">
      <div className="flex h-20 shrink-0 items-center justify-center px-4 border-b border-slate-100 relative">
        <Link href="/" className="flex items-center justify-center font-bold text-lg text-slate-800 hover:opacity-80 transition-opacity">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-[60px] w-auto max-w-[200px] object-contain" />
          ) : (
            <>
              <div className="h-8 w-8 rounded-full bg-[#3b597b] flex items-center justify-center text-white text-[10px]">
                791
              </div>
              <span>SOLUÇÕES</span>
            </>
          )}
        </Link>
        <button className="absolute right-4 text-slate-400 hover:text-slate-600">
          <PanelLeftClose size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="flex flex-col gap-1 px-3">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.subItems && item.subItems.some(sub => pathname.startsWith(sub.href)));
            const isOpen = openMenus[item.name];

            return (
              <div key={item.name} className="flex flex-col">
                <Link
                  href={item.href}
                  onClick={(e) => toggleMenu(e, item.name, !!item.subItems)}
                  className={`group flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-all ${isActive ? 'bg-[#3b597b] text-white' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'} />
                    <span className={!isActive && item.name === item.name.toUpperCase() ? 'text-xs font-semibold tracking-wider' : ''}>
                      {item.name}
                    </span>
                  </div>
                  {item.hasSubmenu && (
                    isOpen
                      ? <ChevronDown size={16} className={isActive ? 'text-white/70' : 'text-slate-400'} />
                      : <ChevronRight size={16} className={isActive ? 'text-white/70' : 'text-slate-300'} />
                  )}
                </Link>

                {item.subItems && isOpen && (
                  <div className="mt-1 flex flex-col gap-1 pl-10 pr-2 pb-2">
                    {item.subItems.map((subItem) => {
                      const isSubActive = pathname === subItem.href;
                      return (
                        <Link
                          key={subItem.name}
                          href={subItem.href}
                          className={`text-xs font-medium px-3 py-2 rounded-md transition-all ${isSubActive
                            ? 'bg-slate-100 text-[#3b597b] font-bold'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          • {subItem.name}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Footer: usuário real + logout */}
      <div className="border-t border-slate-100 p-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-[#3b597b] flex items-center justify-center text-white text-[11px] font-black">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col overflow-hidden flex-1 min-w-0">
            <span className="text-xs font-bold text-slate-700 uppercase truncate">
              {displayName} <span className="text-green-500">●</span>
            </span>
            <span className="text-[10px] text-slate-500 truncate">{displayEmail}</span>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Sair do sistema"
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors shrink-0"
          >
            {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
