"use client";

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { supabaseGlass } from '@/lib/supabase-glass';
import { 
  Check, 
  ChevronLeft, 
  Loader2, 
  ShieldCheck, 
  Zap, 
  CreditCard, 
  Layers,
  Smartphone,
  Users,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

// Definição dos Pacotes (Bundles) para a Holding
const BUNDLES_CONFIG = [
  {
    id: 'financeiro',
    nome: 'Financeiro',
    icon: '💰',
    cor: 'blue',
    preco: 80,
    modulos: ['financeiro', 'configuracoes-fiscais', 'formas-pagamento', 'agendamentos', 'financeiro-agenda'],
    descricao: 'Controle de caixa, bancos, boletos e agendamentos.'
  },
  {
    id: 'producao',
    nome: 'Produção',
    icon: '🏭',
    cor: 'emerald',
    preco: 120,
    modulos: ['producao', 'ordens_servico', 'etapas-producao', 'relatorios'],
    descricao: 'Gestão completa de OS, fábrica e relatórios de produtividade.'
  },
  {
    id: 'comunicacao',
    nome: 'Comunicação',
    icon: '💬',
    cor: 'indigo',
    preco: 250,
    modulos: ['whatsapp', 'crm'],
    descricao: 'WhatsApp Business integrado e CRM de vendas.'
  },
  {
    id: 'rh',
    nome: 'Recursos Humanos',
    icon: '🧑‍💼',
    cor: 'amber',
    preco: 20,
    modulos: ['rh', 'colaboradores', 'comissoes'],
    descricao: 'Gestão de equipe, comissões e documentos de funcionários.'
  }
];

interface Module {
  id: string;
  nome: string;
  slug: string;
  parent_slug?: string;
}

interface PlanConfig {
  base_price: number;
  included_modules: string[];
  optional_modules_pricing: Record<string, number>;
  bundle_prices: Record<string, number>; // Novo campo para preços de combo
  system_limits: {
    usersIncluded: number;
    extraUserPrice: number;
    wppDevices: number;
    extraDevicePrice: number;
    wppMessages: number;
    extraMessagePrice: number;
    wppMessagesPrice: number;
  };
}

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
};

export default function ConfigureSubscriptionPage() {
  const { id: vidracariaId } = useParams();
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vidracaria, setVidracaria] = useState<any>(null);
  const [planConfig, setPlanConfig] = useState<PlanConfig | null>(null);
  const [allModules, setAllModules] = useState<Module[]>([]);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  
  // Seleção local
  const [selectedOptionalIds, setSelectedOptionalIds] = useState<string[]>([]);
  const [extraUsers, setExtraUsers] = useState(0);
  const [extraWppDevices, setExtraWppDevices] = useState(0);
  const [paymentCycle, setPaymentCycle] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');

  useEffect(() => {
    fetchData();
  }, [vidracariaId]);

  async function fetchData() {
    try {
      setLoading(true);
      
      // 1. Buscamos primeiro os módulos (a "chave")
      const { data: mData } = await supabaseGlass.from('modules').select('*').order('nome');
      if (mData) setAllModules(mData);

      // 2. Buscamos a vidracaria
      const { data: vData } = await supabaseGlass.from('vidracarias').select('*').eq('id', vidracariaId).single();
      if (vData) {
        setVidracaria(vData);
        setPaymentCycle(vData?.ciclo_pagamento || 'monthly');
      }

      // 3. Buscamos o plano e cruzamos os dados
      const { data: pData } = await supabase.from('system_plans').select('*').eq('sistema', '791glass').single();
      if (pData) {
        setPlanConfig(pData);
        const basicIds = pData.included_modules || [];
        
        const optionalsInVidracaria = (vData?.modulos_ativos || []).filter((modRef: string) => {
          const mod = mData?.find((m: any) => m.id === modRef || m.slug === modRef);
          if (!mod) return false;
          return !basicIds.includes(mod.id) && !basicIds.includes(mod.slug || '');
        });
        setSelectedOptionalIds(optionalsInVidracaria);
        
        const currentUsersLimit = vData?.limite_usuarios || 0;
        const baseUsers = pData.system_limits?.usersIncluded || 0;
        setExtraUsers(Math.max(0, currentUsersLimit - baseUsers));

        const currentWppDevices = vData?.limite_usuarios_whats || 0;
        const baseWpp = pData.system_limits?.wppDevices || 0;
        setExtraWppDevices(Math.max(0, currentWppDevices - baseWpp));
      }
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  }

  const pricing = useMemo(() => {
    if (!planConfig) return { base: 0, optionals: 0, extras: 0, total: 0, discount: 0 };
    const base = planConfig.base_price;
    
    // Calcula o preço baseado nos bundles selecionados
    const optionals = BUNDLES_CONFIG.reduce((sum, bundle) => {
      // Se algum módulo do bundle estiver selecionado, consideramos o bundle ativo
      const isBundleActive = bundle.modulos.some(slug => selectedOptionalIds.includes(slug));
      if (isBundleActive) {
        return sum + (planConfig.bundle_prices?.[bundle.id] || bundle.preco);
      }
      return sum;
    }, 0);

    const usersExtraCost = extraUsers * (planConfig.system_limits?.extraUserPrice || 0);
    const wppExtraCost = extraWppDevices * (planConfig.system_limits?.extraDevicePrice || 0);
    
    const subtotal = base + optionals + usersExtraCost + wppExtraCost;
    
    let discountPercent = 0;
    if (paymentCycle === 'semiannual') discountPercent = 5;
    if (paymentCycle === 'annual') discountPercent = 15;
    
    const discountAmount = subtotal * (discountPercent / 100);
    const total = subtotal - discountAmount;

    return { base, optionals, extras: usersExtraCost + wppExtraCost, total, discount: discountAmount };
  }, [planConfig, selectedOptionalIds, extraUsers, extraWppDevices, paymentCycle]);

  const handleToggleBundle = (bundleId: string) => {
    const bundle = BUNDLES_CONFIG.find(b => b.id === bundleId);
    if (!bundle) return;

    const isBundleActive = bundle.modulos.some(slug => selectedOptionalIds.includes(slug));
    
    setSelectedOptionalIds(prev => {
      if (isBundleActive) {
        // Remove todos os módulos do bundle
        return prev.filter(slug => !bundle.modulos.includes(slug));
      } else {
        // Adiciona todos os módulos do bundle
        const newSelection = [...prev];
        bundle.modulos.forEach(slug => {
          if (!newSelection.includes(slug)) newSelection.push(slug);
        });
        return newSelection;
      }
    });
  };

  const toggleExpand = (slug: string) => {
    setExpandedMenus(prev => ({ ...prev, [slug]: !prev[slug] }));
  };

  const handleSave = async () => {
    if (!vidracaria || !planConfig) return;
    setSaving(true);
    try {
      const finalModules = [...(planConfig.included_modules || []), ...selectedOptionalIds];
      const baseIncluded = Number(planConfig.system_limits?.usersIncluded || 0);
      const wppIncluded = Number(planConfig.system_limits?.wppDevices || 0);
      
      const finalUsersLimit = baseIncluded + Number(extraUsers);
      const finalWppLimit = wppIncluded + Number(extraWppDevices);
      
      const { error } = await supabaseGlass.from('vidracarias').update({
        modulos_ativos: finalModules,
        limite_usuarios: finalUsersLimit,
        limite_usuarios_whats: finalWppLimit,
        ciclo_pagamento: paymentCycle,
        status_assinatura: 'ativa',
        ativa: true
      }).eq('id', vidracariaId);

      if (error) throw error;
      alert('Assinatura atualizada com sucesso! ✅');
      router.push('/assinaturas');
    } catch (err: any) {
      alert('Erro: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <Loader2 className="animate-spin text-[#3b597b]" size={40} />
    </div>
  );

  const basicModules = allModules.filter(m => planConfig?.included_modules.includes(m.id));
  
  const optionalParents = allModules.filter(m => {
    if (m.parent_slug) return false;
    const isParentInBase = planConfig?.included_modules.includes(m.id);
    const hasOptionalChildren = allModules.some(child => 
      child.parent_slug === m.slug && 
      planConfig?.optional_modules_pricing.hasOwnProperty(child.id) &&
      !planConfig.included_modules.includes(child.id)
    );
    if (!isParentInBase && planConfig?.optional_modules_pricing.hasOwnProperty(m.id)) return true;
    if (isParentInBase && hasOptionalChildren) return true;
    return false;
  });

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-1 hover:bg-slate-50 rounded text-slate-400 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h1 className="text-sm font-medium uppercase tracking-wider text-slate-500">
              CONFIGURAR ASSINATURA: <span className="text-black font-medium">{vidracaria?.nome?.toUpperCase()}</span>
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        <div className="lg:col-span-3 space-y-6">
          
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
             <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-medium uppercase tracking-widest text-slate-400">📅 Ciclo de Faturamento</h2>
              <div className="flex gap-2">
                {[
                  { id: 'monthly', label: 'Mensal', off: '0%' },
                  { id: 'semiannual', label: 'Semestral', off: '5%' },
                  { id: 'annual', label: 'Anual', off: '15%' }
                ].map((cycle) => (
                  <button
                    key={cycle.id}
                    onClick={() => setPaymentCycle(cycle.id as any)}
                    className={`px-5 py-2 rounded-xl border flex items-center gap-2 transition-all shadow-sm ${
                      paymentCycle === cycle.id 
                        ? 'border-[#3b597b] bg-[#3b597b] text-white' 
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest">{cycle.label}</span>
                    {cycle.off !== '0%' && (
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                        paymentCycle === cycle.id ? 'bg-white text-emerald-600' : 'bg-emerald-500 text-white'
                      }`}>
                        {cycle.off} OFF
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </section>
          
          {/* Módulos Inclusos */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4 text-[#3b597b]">
              <ShieldCheck size={18} />
              <h2 className="font-medium text-xs uppercase tracking-wider">Módulos Inclusos no Plano Base</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {basicModules.filter(m => !m.parent_slug).map(mod => (
                <div key={mod.id} className="bg-emerald-50/30 p-3 rounded-lg border border-emerald-100 flex items-center gap-2 min-w-0">
                   <Check size={14} className="text-emerald-500 shrink-0" />
                   <span className="text-xs font-medium text-slate-700 uppercase tracking-tight truncate">{mod.nome}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Combos de Assinatura */}
          <section className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <Layers size={20} />
              </div>
              <div>
                <h2 className="font-black text-sm uppercase tracking-widest text-slate-800">Escolha os Combos Ativos</h2>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Selecione os pacotes de módulos para esta unidade</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {BUNDLES_CONFIG.map(bundle => {
                const isActive = bundle.modulos.some(slug => selectedOptionalIds.includes(slug));
                const price = planConfig?.bundle_prices?.[bundle.id] || bundle.preco;

                const colors: Record<string, string> = {
                  blue: 'border-blue-100 bg-blue-50/20 text-blue-600',
                  emerald: 'border-emerald-100 bg-emerald-50/20 text-emerald-600',
                  indigo: 'border-indigo-100 bg-indigo-50/20 text-indigo-600',
                  amber: 'border-amber-100 bg-amber-50/20 text-amber-600'
                };

                return (
                  <div 
                    key={bundle.id}
                    onClick={() => handleToggleBundle(bundle.id)}
                    className={`relative p-6 rounded-3xl border-2 transition-all cursor-pointer group flex flex-col gap-4 ${
                      isActive 
                        ? 'border-[#3b597b] bg-white shadow-xl shadow-blue-900/5' 
                        : 'border-slate-100 bg-slate-50/30 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-inner ${colors[bundle.cor]}`}>
                        {bundle.icon}
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        isActive ? 'bg-[#3b597b] border-[#3b597b] text-white' : 'border-slate-200'
                      }`}>
                        {isActive && <Check size={14} />}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-black text-slate-800 uppercase tracking-tight text-sm mb-1">{bundle.nome}</h3>
                      <p className="text-[10px] text-slate-400 font-bold leading-relaxed h-8 line-clamp-2">
                        {bundle.descricao}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-50 flex items-end justify-between mt-auto">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">A partir de</span>
                        <span className="text-lg font-black text-slate-900">
                          {formatCurrency(price)}<span className="text-[10px] text-slate-400 font-medium">/mês</span>
                        </span>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${
                        isActive ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {isActive ? 'Ativo' : 'Inativo'}
                      </div>
                    </div>

                    {/* Módulos inclusos */}
                    <div className="mt-4 flex flex-wrap gap-1.5">
                       {bundle.modulos.slice(0, 3).map(m => (
                         <span key={m} className="text-[8px] bg-white/50 border border-slate-100 px-2 py-0.5 rounded text-slate-400 uppercase font-black tracking-tighter">
                           {m.replace(/_/g, ' ')}
                         </span>
                       ))}
                       {bundle.modulos.length > 3 && <span className="text-[8px] text-slate-300 font-black">+ {bundle.modulos.length - 3}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="bg-blue-50/50 border border-blue-100 p-5 rounded-xl shadow-sm">
                <div className="flex items-center gap-2 mb-4 text-[#3b597b]"><Users size={20} /><h3 className="text-xs font-medium uppercase tracking-wider">Usuários do Sistema</h3></div>
                <div className="flex items-center justify-between gap-6">
                   <div className="flex-1">
                     <p className="text-[11px] text-[#3b597b]/70 mb-2 uppercase tracking-tight font-medium">Extra (Incluso: {planConfig?.system_limits.usersIncluded})</p>
                     <div className="flex items-center gap-3 bg-white/50 p-1.5 rounded-lg border border-blue-100 w-fit">
                        <button onClick={() => setExtraUsers(prev => Math.max(0, prev - 1))} className="h-8 w-8 hover:bg-white rounded-lg font-medium text-[#3b597b] transition-colors">-</button>
                        <span className="w-10 text-center font-medium text-lg text-[#3b597b]">{extraUsers}</span>
                        <button onClick={() => setExtraUsers(prev => prev + 1)} className="h-8 w-8 hover:bg-white rounded-lg font-medium text-[#3b597b] transition-colors">+</button>
                     </div>
                   </div>
                   <div className="text-right">
                      <p className="text-lg font-bold text-[#3b597b]">{formatCurrency(extraUsers * (planConfig?.system_limits.extraUserPrice || 0))}</p>
                      <p className="text-[10px] text-[#3b597b]/60 uppercase font-medium tracking-tight">ACRÉSCIMO MENSAL</p>
                   </div>
                </div>
             </div>
             <div className="bg-emerald-50/50 border border-emerald-100 p-5 rounded-xl shadow-sm">
                <div className="flex items-center gap-2 mb-4 text-emerald-700"><Smartphone size={20} /><h3 className="text-xs font-medium uppercase tracking-wider">Expansão WhatsApp</h3></div>
                <div className="flex items-center justify-between gap-6">
                   <div className="flex-1">
                     <p className="text-[11px] text-emerald-700/70 mb-2 uppercase tracking-tight font-medium">Aparelhos Extras (Incluso: {planConfig?.system_limits.wppDevices})</p>
                     <div className="flex items-center gap-3 bg-white/50 p-1.5 rounded-lg border border-emerald-100 w-fit">
                        <button onClick={() => setExtraWppDevices(prev => Math.max(0, prev - 1))} className="h-8 w-8 hover:bg-white rounded-lg font-medium text-emerald-700 transition-colors">-</button>
                        <span className="w-10 text-center font-medium text-lg text-emerald-700">{extraWppDevices}</span>
                        <button onClick={() => setExtraWppDevices(prev => prev + 1)} className="h-8 w-8 hover:bg-white rounded-lg font-medium text-emerald-700 transition-colors">+</button>
                     </div>
                   </div>
                   <div className="text-right">
                      <p className="text-lg font-bold text-emerald-700">{formatCurrency(extraWppDevices * (planConfig?.system_limits.extraDevicePrice || 0))}</p>
                      <p className="text-[10px] text-emerald-700/60 uppercase font-medium tracking-tight">ACRÉSCIMO MENSAL</p>
                   </div>
                </div>
             </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm sticky top-20">
             <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-6 border-b border-slate-100 pb-2">Resumo da Assinatura</h3>
             <div className="space-y-4">
                <div className="flex justify-between items-center"><span className="text-xs font-medium text-slate-600 uppercase tracking-tight">Plano Base 791Glass</span><span className="text-xs font-medium text-slate-800">{formatCurrency(pricing.base)}</span></div>
                 {BUNDLES_CONFIG.filter(b => b.modulos.some(slug => selectedOptionalIds.includes(slug))).map(bundle => (
                   <div key={bundle.id} className="flex justify-between items-center animate-in slide-in-from-right-1 duration-200">
                     <span className="text-[11px] font-medium text-slate-400 uppercase tracking-tight">Combo {bundle.nome}</span>
                     <span className="text-[11px] font-medium text-slate-600">+{formatCurrency(planConfig?.bundle_prices?.[bundle.id] || bundle.preco)}</span>
                   </div>
                 ))}
                {(extraUsers > 0 || extraWppDevices > 0) && <div className="pt-2 border-t border-slate-50"></div>}
                {extraUsers > 0 && (
                  <div className="flex justify-between items-center"><span className="text-[11px] font-medium text-slate-400 uppercase tracking-tight">{extraUsers} Usuários Extras</span><span className="text-[11px] font-medium text-slate-600">+{formatCurrency(extraUsers * (planConfig?.system_limits.extraUserPrice || 0))}</span></div>
                )}
                {extraWppDevices > 0 && (
                  <div className="flex justify-between items-center"><span className="text-[11px] font-medium text-slate-400 uppercase tracking-tight">{extraWppDevices} Aparelhos Extras</span><span className="text-[11px] font-medium text-slate-600">+{formatCurrency(extraWppDevices * (planConfig?.system_limits.extraDevicePrice || 0))}</span></div>
                )}
                {pricing.discount > 0 && (
                  <div className="flex justify-between items-center text-emerald-600 font-bold uppercase animate-in slide-in-from-right-1">
                    <span className="text-[11px]">Desconto ({paymentCycle === 'annual' ? '15%' : '5%'})</span>
                    <span className="text-[11px]">-{formatCurrency(pricing.discount)}</span>
                  </div>
                )}
                <div className="pt-6 mt-6 border-t border-slate-100">
                   <div className="flex justify-between items-end mb-6">
                      <span className="text-xs font-medium uppercase tracking-widest text-[#3b597b]">Total / Ciclo</span>
                      <span className="text-2xl font-medium text-slate-900 leading-none">{formatCurrency(pricing.total)}</span>
                   </div>
                   <button onClick={handleSave} disabled={saving} className="w-full bg-[#3b597b] text-white py-4 rounded-xl font-medium text-xs uppercase tracking-wider transition-all hover:bg-[#2e4763] shadow-md active:scale-95">
                     {saving ? 'Processando...' : 'Confirmar Assinatura'}
                   </button>
                </div>
             </div>
          </div>
        </div>

      </div>
    </div>
  );
}
