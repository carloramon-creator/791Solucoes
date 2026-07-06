"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CreditCard,
  Receipt,
  Settings,
  Users,
  Percent,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  LogOut,
  Loader2,
  FileCheck,
  ShieldCheck,
  LifeBuoy,
} from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

type NavItem = {
  name: string;
  href: string;
  icon: any;
  resourceCode?: string;
  hasSubmenu?: boolean;
  subItems?: Array<{ name: string; href: string; resourceCode?: string }>;
};

const navigationItems: NavItem[] = [
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
      { name: 'Barber', href: '/planos/barber', resourceCode: 'submenu.planos.barber' },
    ],
  },
  { name: 'CUPONS', href: '/cupons', icon: Percent, resourceCode: 'menu.cupons' },
  { name: 'CONFIGURAÇÕES', href: '/configuracoes', icon: Settings, hasSubmenu: false, resourceCode: 'menu.configuracoes' },
];

export function Sidebar() {
  const pathname = usePathname();
  const supabase = createSupabaseBrowser();

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({ PLANOS: true });
  const [loggingOut, setLoggingOut] = useState(false);
  const [displayName, setDisplayName] = useState('ADMIN');
  const [displayEmail, setDisplayEmail] = useState('');
  const [permissionCodes, setPermissionCodes] = useState<Set<string>>(new Set());
  const [unrestrictedFallback, setUnrestrictedFallback] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [newAssignedTicketCount, setNewAssignedTicketCount] = useState(0);
  const [supportBadgeRefreshTick, setSupportBadgeRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active || !user) return;

      setDisplayName(user.user_metadata?.full_name || user.email?.split('@')[0]?.toUpperCase() || 'ADMIN');
      setDisplayEmail(user.email || '');
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    const handler = () => setSupportBadgeRefreshTick((prev) => prev + 1);
    window.addEventListener('support:tickets-updated', handler);
    return () => window.removeEventListener('support:tickets-updated', handler);
  }, []);

  useEffect(() => {
    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const getSeenMap = () => {
      if (typeof window === 'undefined') return {} as Record<string, string>;
      const raw = window.sessionStorage.getItem('holding.support.ticket.seen');
      if (!raw) return {} as Record<string, string>;

      try {
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {} as Record<string, string>;
      }
    };

    async function loadSupportBadge() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          if (active) setNewAssignedTicketCount(0);
          return;
        }

        const response = await fetch('/api/support/tickets?queue=all&limit=200', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (active) setNewAssignedTicketCount(0);
          return;
        }

        const tickets = Array.isArray(payload?.tickets) ? payload.tickets : [];
        const seenMap = getSeenMap();
        const count = tickets.filter((ticket: any) => {
          const status = String(ticket?.status || '').trim();
          if (!['new', 'in_progress', 'waiting_customer'].includes(status)) return false;

          const ticketId = String(ticket?.id || '').trim();
          const activityAt = String(ticket?.last_activity_at || ticket?.last_message_at || ticket?.updated_at || '').trim();
          if (!ticketId || !activityAt) return false;

          const seenAt = seenMap[ticketId];
          if (!seenAt) return true;
          return new Date(activityAt).getTime() > new Date(seenAt).getTime();
        }).length;

        if (active) {
          setNewAssignedTicketCount(count);
        }
      } catch {
        if (active) setNewAssignedTicketCount(0);
      }
    }

    if (permissionsLoaded && (unrestrictedFallback || permissionCodes.has('menu.suporte'))) {
      loadSupportBadge();
      intervalId = setInterval(loadSupportBadge, 7000);
    } else {
      setNewAssignedTicketCount(0);
    }

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [permissionCodes, permissionsLoaded, supabase, unrestrictedFallback, supportBadgeRefreshTick]);

  useEffect(() => {
    let active = true;

    async function loadPermissions() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          if (active) {
            setPermissionCodes(new Set());
            setUnrestrictedFallback(false);
            setPermissionsLoaded(true);
          }
          return;
        }

        const response = await fetch('/api/admin/permissions/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (active) {
            setPermissionCodes(new Set());
            setUnrestrictedFallback(false);
            setPermissionsLoaded(true);
          }
          return;
        }

        if (active) {
          const codes = Array.isArray(payload.permissionCodes) ? payload.permissionCodes : [];
          setPermissionCodes(new Set(codes));
          setUnrestrictedFallback(Boolean(payload.unrestrictedFallback));
          setPermissionsLoaded(true);
        }
      } catch {
        if (active) {
          setPermissionCodes(new Set());
          setUnrestrictedFallback(false);
          setPermissionsLoaded(true);
        }
      }
    }

    loadPermissions();

    return () => {
      active = false;
    };
  }, [supabase]);

  const canAccess = (resourceCode?: string) => {
    if (!resourceCode) return true;
    if (!permissionsLoaded) return false;
    if (unrestrictedFallback) return true;
    return permissionCodes.has(resourceCode);
  };

  const visibleItems = useMemo(
    () => navigationItems.filter((item) => canAccess(item.resourceCode)),
    [permissionCodes, unrestrictedFallback, permissionsLoaded]
  );

  const toggleMenu = (e: React.MouseEvent, name: string, hasSubItems: boolean) => {
    if (!hasSubItems) return;
    e.preventDefault();
    setOpenMenus((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Erro ao sair:', err);
    } finally {
      window.location.href = '/login';
    }
  };

  if (pathname === '/login') return null;

  return (
    <div className="flex h-full w-[260px] flex-col border-r border-slate-200 bg-white">
      <div className="relative flex h-20 shrink-0 items-center justify-center border-b border-slate-100 px-4">
        <Link href="/" className="flex items-center justify-center text-lg font-bold text-slate-800 transition-opacity hover:opacity-80">
          <img src="/logo.png" alt="791 Soluções" className="h-[40px] w-auto max-w-[200px] object-contain" />
        </Link>
        <button className="absolute right-4 text-slate-400 hover:text-slate-600" type="button">
          <PanelLeftClose size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="flex flex-col gap-1 px-3">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const visibleSubItems = item.subItems?.filter((sub) => canAccess(sub.resourceCode));
            const hasVisibleSubItems = Boolean(visibleSubItems?.length);
            const isActive = pathname === item.href || Boolean(visibleSubItems?.some((sub) => pathname.startsWith(sub.href)));
            const isOpen = openMenus[item.name];

            return (
              <div key={item.name} className="flex flex-col">
                <Link
                  href={item.href}
                  onClick={(e) => toggleMenu(e, item.name, hasVisibleSubItems)}
                  className={`group flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-all ${
                    isActive ? 'bg-[#3b597b] text-white' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'} />
                    <span className={!isActive && item.name === item.name.toUpperCase() ? 'text-xs font-semibold tracking-wider' : ''}>
                      {item.name}
                    </span>
                    {item.href === '/suporte' && newAssignedTicketCount > 0 && (
                      <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                        isActive ? 'bg-red-500 text-white' : 'bg-red-100 text-red-700'
                      }`}>
                        {newAssignedTicketCount}
                      </span>
                    )}
                  </div>

                  {item.hasSubmenu && hasVisibleSubItems && (
                    isOpen ? <ChevronDown size={16} className={isActive ? 'text-white/70' : 'text-slate-400'} /> : <ChevronRight size={16} className={isActive ? 'text-white/70' : 'text-slate-300'} />
                  )}
                </Link>

                {visibleSubItems && isOpen && (
                  <div className="mt-1 flex flex-col gap-1 pb-2 pl-10 pr-2">
                    {visibleSubItems.map((subItem) => {
                      const isSubActive = pathname === subItem.href;
                      return (
                        <Link
                          key={subItem.name}
                          href={subItem.href}
                          className={`rounded-md px-3 py-2 text-xs font-medium transition-all ${
                            isSubActive ? 'bg-slate-100 font-bold text-[#3b597b]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
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

      <div className="border-t border-slate-100 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3b597b] text-[11px] font-black text-white">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <span className="truncate text-xs font-bold uppercase text-slate-700">
              {displayName} <span className="text-green-500">●</span>
            </span>
            <span className="truncate text-[10px] text-slate-500">{displayEmail}</span>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Sair do sistema"
            className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            type="button"
          >
            {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
