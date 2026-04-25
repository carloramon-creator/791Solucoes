"use client";

import Link from 'next/link';
import { 
  Settings, 
  ShieldCheck, 
  Users, 
  CreditCard, 
  ChevronRight,
  Bell,
  Monitor,
  Wallet,
  Receipt,
  Tag
} from 'lucide-react';

export default function ConfiguracoesPage() {
  const configSections = [
    {
      title: 'Financeiro e API',
      desc: 'Gerencie as chaves do Asaas, Inter e faturamento.',
      href: '/configuracoes/financeiro',
      icon: ShieldCheck,
      color: 'text-blue-600',
      bg: 'bg-blue-50'
    },
    {
      title: 'Contas Bancárias',
      desc: 'Gerencie saldos, limites e cartões da Holding.',
      href: '/configuracoes/contas',
      icon: Wallet,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50'
    },
    {
      title: 'Notas Fiscais',
      desc: 'Servidor de NFS-e, certificados e impostos.',
      href: '/configuracoes/nfs',
      icon: Receipt,
      color: 'text-purple-600',
      bg: 'bg-purple-50'
    },
    {
      title: 'Equipe e Permissões',
      desc: 'Controle quem pode acessar o painel da Holding.',
      href: '/equipe',
      icon: Users,
      color: 'text-[#3b597b]',
      bg: 'bg-slate-100'
    },
    {
      title: 'Mapa DRE / Categorias',
      desc: 'Plano de contas e árvore de categorias.',
      href: '/configuracoes/categorias',
      icon: Tag,
      color: 'text-amber-600',
      bg: 'bg-amber-50'
    },
    {
      title: 'Notificações',
      desc: 'Configure avisos de pagamentos e webhooks.',
      href: '/configuracoes/notificacoes',
      icon: Bell,
      color: 'text-rose-600',
      bg: 'bg-rose-50'
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <Settings className="text-[#3b597b]" size={24} />
          Centro de Configurações
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Gerencie todas as preferências e integrações da Holding 791 Soluções.
        </p>
      </div>

      {/* Grid de Configurações */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {configSections.map((section) => (
          <Link 
            key={section.title} 
            href={section.href}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-[#3b597b]/30 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <div className={`${section.bg} ${section.color} p-3 rounded-xl transition-colors`}>
                <section.icon size={24} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{section.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{section.desc}</p>
              </div>
            </div>
            <ChevronRight className="text-slate-300 group-hover:text-[#3b597b] transition-colors" size={20} />
          </Link>
        ))}
      </div>

      {/* Footer Info */}
      <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 flex items-center gap-4">
        <Monitor className="text-slate-400" size={20} />
        <p className="text-[11px] text-slate-500 leading-relaxed uppercase tracking-widest">
          Versão do Sistema: 1.0.0-PROD | Última atualização: 24 de Abril de 2026
        </p>
      </div>

    </div>
  );
}
