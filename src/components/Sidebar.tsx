"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Scissors, Building2, CreditCard, Receipt, Settings, Users, Percent, ChevronRight, ChevronDown, PanelLeftClose, LogOut, Loader2, FileCheck, ShieldCheck, LifeBuoy } from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

const navigationItems = [
  { name: 'Painel', href: '/', icon: LayoutDashboard, resourceCode: 'menu.dashboard' },
  { name: 'FINANCEIRO', href: '/financeiro', icon: Receipt, resourceCode: 'menu.financeiro' },
  { name: 'NOTAS FISCAIS', href: '/notas-fiscais', icon: FileCheck, resourceCode: 'menu.notas_fiscais' },
  { name: 'SUPORTE', href: '/suporte', icon: LifeBuoy, resourceCode: 'menu.suporte' },
  { name: 'ASSINATURAS', href: '/assinaturas', icon: Users, hasSubmenu: true, resourceCode: 'menu.assinaturas' },
  { name: 'PATROCINADORES', href: '/patrocinadores', icon: ShieldCheck, resourceCode: 'menu.patrocinadores' },
  {
    name: 'PLANOS',
    href: '/planos',
    icon: CreditCard,
    resourceCode: 'menu.planos',
    hasSubmenu: true,
    subItems: [
      { name: 'Glass', href: '/planos/glass', resourceCode: 'submenu.planos.glass' },
      { name: 'Barber', href: '/planos/barber', resourceCode: 'submenu.planos.barber' }
    ]
  },
  { name: 'CUPONS', href: '/cupons', icon: Percent, resourceCode: 'menu.cupons' },
  { name: 'CONFIGURAÇÕES', href: '/configuracoes', icon: Settings, hasSubmenu: false, resourceCode: 'menu.configuracoes' },
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
  const [permissionCodes, setPermissionCodes] = useState<Set<string> | null>(null);
  const [unrestrictedFallback, setUnrestrictedFallback] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setDisplayName(
          user.user_metadata?.full_name ||
          user.email?.split('@')[0]?.toUpperCase() ||
          'ADMIN'
        );
        setDisplayEmail(user.email || '');
  const [unrestrictedFallback, setUnrestrictedFallback] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
    });
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPermissions() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (active) {
            setUnrestrictedFallback(true);
            setPermissionCodes(new Set());
          }
          return;
        }

        const res = await fetch('/api/admin/permissions/me', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
            setUnrestrictedFallback(false);

            setPermissionsLoaded(true);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (active) {
            setUnrestrictedFallback(true);
            setPermissionCodes(new Set());
          }
          return;
        }

        if (active) {
          const codes = Array.isArray(json.permissionCodes) ? json.permissionCodes : [];
          setPermissionCodes(new Set(codes));
          setUnrestrictedFallback(Boolean(json.unrestrictedFallback));
        }
            setUnrestrictedFallback(false);
        if (active) {
            setPermissionsLoaded(true);
          setUnrestrictedFallback(true);
          setPermissionCodes(new Set());
        }
      }
    }

    loadPermissions();

          setPermissionsLoaded(true);
    return () => {
      active = false;
    };
          setUnrestrictedFallback(false);

          setPermissionsLoaded(true);
  const canAccess = (resourceCode?: string) => {
    if (!resourceCode) return true;
    if (unrestrictedFallback) return true;
    if (!permissionCodes) return true;
    return permissionCodes.has(resourceCode);
  };

  const toggleMenu = (e: React.MouseEvent, name: string, hasSubItems: boolean) => {
    if (hasSubItems) {
      e.preventDefault();
      setOpenMenus(prev => ({ ...prev, [name]: !prev[name] }));
    }
  };
    if (!permissionsLoaded) return false;

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Erro ao sair:', err);
    }
    window.location.href = '/login';
  };

  if (pathname === '/login') return null;

  return (
    <div className="flex h-full w-[260px] flex-col bg-white border-r border-slate-200">
      <div className="flex h-20 shrink-0 items-center justify-center px-4 border-b border-slate-100 relative">
        <Link href="/" className="flex items-center justify-center font-bold text-lg text-slate-800 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="791 Soluções" className="h-[40px] w-auto max-w-[200px] object-contain" />
        </Link>
        <button className="absolute right-4 text-slate-400 hover:text-slate-600">
          <PanelLeftClose size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="flex flex-col gap-1 px-3">
          {navigationItems.filter((item) => canAccess(item.resourceCode)).map((item) => {
            const Icon = item.icon;
            const visibleSubItems = item.subItems?.filter((sub) => canAccess((sub as any).resourceCode));
            const hasVisibleSubItems = Boolean(visibleSubItems && visibleSubItems.length > 0);
            const isActive = pathname === item.href || (visibleSubItems && visibleSubItems.some(sub => pathname.startsWith(sub.href)));
            const isOpen = openMenus[item.name];

            return (
              <div key={item.name} className="flex flex-col">
                <Link
                  href={item.href}
                  onClick={(e) => toggleMenu(e, item.name, hasVisibleSubItems)}
                  className={`group flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-all ${isActive ? 'bg-[#3b597b] text-white' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'} />
                    <span className={!isActive && item.name === item.name.toUpperCase() ? 'text-xs font-semibold tracking-wider' : ''}>
                      {item.name}
                    </span>
                  </div>
                  {item.hasSubmenu && hasVisibleSubItems && (
                    isOpen
                      ? <ChevronDown size={16} className={isActive ? 'text-white/70' : 'text-slate-400'} />
                      : <ChevronRight size={16} className={isActive ? 'text-white/70' : 'text-slate-300'} />
                  )}
                </Link>

                {visibleSubItems && isOpen && (
                  <div className="mt-1 flex flex-col gap-1 pl-10 pr-2 pb-2">
                    {visibleSubItems.map((subItem) => {
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
