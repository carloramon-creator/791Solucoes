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
  system_limits: {
    usersIncluded: number;
    extraUserPrice: number;
    wppDevices: number;
    extraDevicePrice: number;
    wppMessages: number;
    extraMessagePrice: number;
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
    if (!planConfig) return { base: 0, optionals: 0, extras: 0, total: 0 };
    const base = planConfig.base_price;
    
    const optionals = selectedOptionalIds.reduce((sum, modRef) => {
      const mod = allModules.find(m => m.id === modRef || m.slug === modRef);
      if (!mod) return sum;
      
      const isIncludedInBase = planConfig.included_modules.includes(mod.id) || planConfig.included_modules.includes(mod.slug || '');
      if (isIncludedInBase) return sum;

      const price = Number(planConfig.optional_modules_pricing?.[mod.id] || planConfig.optional_modules_pricing?.[mod.slug || ''] || 0);
      return sum + price;
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

  const handleToggleOptional = (modId: string) => {
    setSelectedOptionalIds(prev => {
      const mod = allModules.find(m => m.id === modId || m.slug === modId);
      if (!mod) return prev;

      const isSelected = prev.some(id => id === mod.id || id === mod.slug);
      let newSelection = isSelected 
        ? prev.filter(id => id !== mod.id && id !== mod.slug) 
        : [...prev, mod.slug || mod.id];
      
      if (mod && !mod.parent_slug) {
         const children = allModules.filter(m => m.parent_slug === mod.slug);
         const childrenIds = children.map(c => c.id);
         const childrenSlugs = children.map(c => c.slug).filter(Boolean) as string[];

         if (isSelected) {
            newSelection = newSelection.filter(id => !childrenIds.includes(id) && !childrenSlugs.includes(id));
         } else {
            [...childrenIds, ...childrenSlugs].forEach(ref => {
              if(!newSelection.includes(ref)) newSelection.push(ref);
            });
         }
      } else if (mod && mod.parent_slug) {
         const parent = allModules.find(m => m.slug === mod.parent_slug);
         if (parent && !isSelected && !newSelection.some(id => id === parent.id || id === parent.slug)) {
            newSelection.push(parent.slug || parent.id);
         }
      }
      return newSelection;
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

          {/* Módulos Opcionais */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5 text-purple-600">
              <Layers size={20} />
              <h2 className="font-medium text-xs uppercase tracking-wider">Adicionais e Módulos Opcionais</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {optionalParents.map(parent => {
                const isParentInBase = planConfig?.included_modules.includes(parent.id);
                
                const isParentSelected = selectedOptionalIds.some(id => id === parent.id || id === parent.slug);
                const isExpanded = expandedMenus[parent.slug] || false;
                // Lógica de Preço de Pacote (ex: Configurações)
                const isPackage = parent.slug === 'configuracoes';
                const children = allModules.filter(m => 
                  m.parent_slug === parent.slug && 
                  planConfig?.optional_modules_pricing.hasOwnProperty(m.id) &&
                  !planConfig.included_modules.includes(m.id)
                );

                const displayPrice = isPackage 
                  ? children.reduce((sum, child) => sum + (planConfig?.optional_modules_pricing[child.id] || 0), 0)
                  : (isParentInBase 
                      ? children.reduce((sum, child) => sum + (planConfig?.optional_modules_pricing[child.id] || 0), 0)
                      : (planConfig?.optional_modules_pricing[parent.id] || 0)
                    );
                
                return (
                  <div key={parent.id} className={`border rounded-xl overflow-hidden flex flex-col transition-all hover:border-slate-300 ${isParentInBase && !isPackage ? 'border-emerald-100 bg-emerald-50/20' : 'border-slate-100 bg-white'}`}>
                    <div className={`flex items-center justify-between p-4 transition-colors ${isParentSelected ? 'bg-blue-50/40' : ''}`}>
                      <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => handleToggleOptional(parent.id)}>
                        <div className={`h-5 w-5 rounded border flex items-center justify-center transition-all ${isParentSelected ? 'bg-[#3b597b] border-[#3b597b] text-white' : 'border-slate-300'}`}>
                          {isParentSelected && <Check size={12} />}
                        </div>
                        <span className={`text-xs font-medium uppercase tracking-tight ${isParentSelected ? 'text-slate-900' : 'text-slate-500'}`}>
                          {parent.nome}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        {displayPrice > 0 && <span className="text-xs text-[#3b597b] font-medium">+{formatCurrency(displayPrice)}</span>}
                        {children.length > 0 && (
                          <button onClick={() => toggleExpand(parent.slug)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                            {isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                          </button>
                        )}
                      </div>
                    </div>
                    {children.length > 0 && isExpanded && (
                      <div className="bg-slate-50/50 border-t border-slate-100 p-3 space-y-2">
                        {children.map(child => {
                          const isChildSelected = selectedOptionalIds.some(id => id === child.id || id === child.slug);
                          const childPrice = isPackage ? 0 : (planConfig?.optional_modules_pricing[child.id] || 0);
                          return (
                            <div key={child.id} onClick={() => handleToggleOptional(child.id)} className="flex items-center justify-between p-2.5 pl-8 rounded-lg hover:bg-white cursor-pointer group transition-all">
                              <div className="flex items-center gap-4">
                                <div className={`h-4 w-4 rounded border flex items-center justify-center transition-all ${isChildSelected ? 'bg-blue-400 border-blue-400 text-white' : 'border-slate-200'}`}>
                                  {isChildSelected && <Check size={10} />}
                                </div>
                                <span className={`text-xs font-medium uppercase tracking-tight ${isChildSelected ? 'text-slate-800' : 'text-slate-400'}`}>{child.nome}</span>
                              </div>
                              {childPrice > 0 && <span className="text-[11px] text-slate-400 font-medium">+{formatCurrency(childPrice)}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
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
                {selectedOptionalIds
                  .filter(modId => (planConfig?.optional_modules_pricing?.[modId] || 0) > 0 && !planConfig?.included_modules?.includes(modId))
                  .map(modId => {
                    const mod = allModules.find(m => m.id === modId);
                    return (
                      <div key={modId} className="flex justify-between items-center animate-in slide-in-from-right-1 duration-200">
                        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-tight">{mod?.nome}</span>
                        <span className="text-[11px] font-medium text-slate-600">+{formatCurrency(planConfig?.optional_modules_pricing[modId] || 0)}</span>
                      </div>
                    );
                  })}
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
