"use client";

import { useState } from 'react';
import { 
  Bell, 
  Copy, 
  Check, 
  ShieldAlert, 
  Info,
  ArrowLeft,
  Link as LinkIcon,
  Globe,
  ExternalLink
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ConfigTabs } from '@/components/ConfigTabs';

export default function NotificacoesPage() {
  const router = useRouter();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const baseUrl = "https://api.791solucoes.com.br"; // Base URL da Holding

  const webhooks = [
    {
      id: 'asaas',
      name: 'ASAAS WEBHOOK URL (OFICIAL)',
      url: `${baseUrl}/api/webhooks/asaas`,
      active: true
    },
    {
      id: 'inter',
      name: 'INTER WEBHOOK URL (OFICIAL)',
      url: `${baseUrl}/api/webhooks/inter`,
      active: true
    },
    {
      id: 'stripe',
      name: 'STRIPE WEBHOOK URL',
      url: `${baseUrl}/api/webhooks/stripe`,
      active: false
    }
  ];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(id);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <Bell className="text-[#3b597b]" size={24} />
          Configurações do Sistema
        </h1>
        <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
          Gerencie as preferências globais e integrações da Holding.
        </p>
      </div>

      <ConfigTabs />

      {/* Destaque Inter */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
           <div className="flex items-center gap-3 text-[#3b597b]">
              <ShieldAlert size={20} />
              <h2 className="text-sm uppercase tracking-widest">Configuração de Webhook</h2>
           </div>
           <span className="text-[9px] bg-[#3b597b]/10 text-[#3b597b] px-2 py-0.5 rounded uppercase tracking-widest">Recomendado</span>
        </div>
        
        <div className="p-8 space-y-6">
          <p className="text-sm text-slate-500 leading-relaxed max-w-2xl uppercase text-[11px] tracking-wide">
            Para que o sistema receba confirmações de pagamento automáticas, você deve configurar a seguinte URL no painel do Banco Inter e do Stripe:
          </p>

          <div className="space-y-2">
            <label className="text-[9px] text-slate-400 uppercase tracking-widest ml-1">URL de Webhook (Banco Inter & Stripe)</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 h-[50px] flex items-center text-slate-600 font-mono text-sm overflow-hidden whitespace-nowrap">
                {`${baseUrl}/api/webhooks/inter`}
              </div>
              <button 
                onClick={() => handleCopy(`${baseUrl}/api/webhooks/inter`, 'main')}
                className="bg-[#3b597b] hover:bg-[#2e4763] text-white px-6 rounded-xl flex items-center gap-2 transition-all uppercase text-[10px] tracking-widest shadow-sm"
              >
                {copiedField === 'main' ? <Check size={16} className="text-white" /> : <Copy size={16} />}
                {copiedField === 'main' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-5">
             <div className="flex gap-3">
                <Info size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800 leading-relaxed uppercase tracking-wider">
                  <span className="text-amber-600">Dica Banco Inter:</span> No Internet Banking, vá em "Minhas Integrações", clique nos três pontinhos da aplicação "791 Holding" e escolha "Configurar Webhook". Cole o link acima e, se solicitado, use o arquivo <span className="text-[#3b597b] font-medium">ca.crt</span> que você baixou.
                </p>
             </div>
          </div>
        </div>
      </div>

      {/* Grid de Webhooks Individuais */}
      <div className="grid grid-cols-1 gap-4">
        {webhooks.map((webhook) => (
          <div 
            key={webhook.id}
            className={`bg-white border ${webhook.active ? 'border-[#3b597b]/20' : 'border-slate-100'} rounded-2xl p-6 flex items-center justify-between group hover:border-[#3b597b]/30 transition-all shadow-sm`}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {webhook.active ? (
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                ) : (
                  <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                )}
                <h4 className={`text-[10px] uppercase tracking-widest ${webhook.active ? 'text-[#3b597b]' : 'text-slate-400'}`}>
                  {webhook.name}
                </h4>
              </div>
              <p className="text-sm text-slate-500 font-mono tracking-tight">{webhook.url}</p>
            </div>
            
            <button 
              onClick={() => handleCopy(webhook.url, webhook.id)}
              className="h-10 w-10 flex items-center justify-center rounded-xl text-slate-300 hover:text-[#3b597b] hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100"
            >
              {copiedField === webhook.id ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}
