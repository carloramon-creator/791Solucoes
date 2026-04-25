"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Wallet, Receipt, Bell, Tag } from 'lucide-react';

export function ConfigTabs() {
  const pathname = usePathname();

  const tabs = [
    { name: 'Financeiro e API', href: '/configuracoes/financeiro', icon: ShieldCheck },
    { name: 'Contas Bancárias', href: '/configuracoes/contas', icon: Wallet },
    { name: 'Notas Fiscais', href: '/configuracoes/nfs', icon: Receipt },
    { name: 'Categorias', href: '/configuracoes/categorias', icon: Tag },
    { name: 'Notificações', href: '/configuracoes/notificacoes', icon: Bell },
  ];

  return (
    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl w-fit mb-8 shadow-inner">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link 
            key={tab.href} 
            href={tab.href}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              isActive 
                ? 'bg-white text-[#3b597b] shadow-sm' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <tab.icon size={14} />
            {tab.name}
          </Link>
        );
      })}
    </div>
  );
}
