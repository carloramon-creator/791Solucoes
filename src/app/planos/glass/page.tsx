"use client";

import { useEffect, useState } from 'react';
import { supabaseGlass } from '@/lib/supabase-glass';
import { createSupabaseBrowser } from '@/lib/supabase-browser';
import { ArrowLeft, Check, Save, Layers, AlertCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Module {
  id: string;
  nome: string;
  ordem?: number;
  slug?: string;
  parent_slug?: string;
}

const supabase = createSupabaseBrowser();

// Função auxiliar para formatar moeda brasileira em tempo real
const formatCurrency = (value: string) => {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  const amount = Number(digits) / 100;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Função para converter string formatada (1.250,50) de volta para número (1250.50)
const parseCurrency = (formattedValue: string) => {
  return Number(formattedValue.replace(/\D/g, '')) / 100;
};

export default function PlanosGlassPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Estados do formulário por COMBOS
  const [basePrice, setBasePrice] = useState('');
  const [bundlePrices, setBundlePrices] = useState<Record<string, string>>({
    financeiro: '',
    producao: '',
    comunicacao: '',
    rh: '',
    fiscal: ''
  });

  const [limits, setLimits] = useState({
    usersIncluded: '',
    extraUserPrice: '',
    wppDevices: '',
    extraDevicePrice: '',
    wppMessages: '',
    extraMessagePrice: ''
  });

  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [selectedBasicModules, setSelectedBasicModules] = useState<string[]>([]);

  const BUNDLES = [
    { id: 'financeiro', name: 'Financeiro', items: ['Contas a Pagar', 'Contas a Receber', 'Fluxo de Caixa', 'Agendamentos', 'Bancos'] },
    { id: 'producao', name: 'Produção', items: ['Ordens de Serviço', 'Gestão de Produção', 'Etapas de Produção', 'Relatórios'] },
    { id: 'comunicacao', name: 'Comunicação', items: ['WhatsApp Business', 'CRM (Vendas)'] },
    { id: 'rh', name: 'Recursos Humanos (RH)', items: ['Colaboradores', 'Comissões'] },
    { id: 'fiscal', name: 'Notas Fiscais (NF-e)', items: ['NF-e', 'NFC-e', 'Focus NFE'] },
  ];

  // Cálculo do valor total
  const totalFullValue = parseCurrency(basePrice || '0') + 
    Object.values(bundlePrices).reduce((sum, val) => sum + parseCurrency(val || '0'), 0);

  const handleSave = async () => {
    setSaving(true);
    
    const payload = {
      name: '791glass', 
      sistema: '791glass', 
      base_price: parseCurrency(basePrice) || 0,
      bundle_prices: Object.fromEntries(
        Object.entries(bundlePrices).map(([k, v]) => [k, parseCurrency(v)])
      ), 
      system_limits: {
        ...limits,
        extraUserPrice: parseCurrency(limits.extraUserPrice),
        extraDevicePrice: parseCurrency(limits.extraDevicePrice),
        extraMessagePrice: parseCurrency(limits.extraMessagePrice)
      } 
    };

    try {
      const { error } = await supabase
        .from('system_plans')
        .upsert({
          ...payload,
          segment: 'glass'
        }, { onConflict: 'sistema' });

      if (error) throw error;
      alert("✅ Planos por Módulo salvos com sucesso!");
    } catch (err: any) {
      console.error("Erro ao salvar:", err);
      alert(`❌ Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleBasicModule = (mod: Module) => {
    setSelectedBasicModules(prev => {
      const isSelected = prev.includes(mod.id);
      let newSelection = [...prev];

      if (isSelected) {
        // Desmarcar
        newSelection = newSelection.filter(id => id !== mod.id);
        // Se for um menu pai, desmarca todos os filhos dele automaticamente
        if (!mod.parent_slug) {
          const childrenIds = modules.filter(m => m.parent_slug === mod.slug).map(c => c.id);
          newSelection = newSelection.filter(id => !childrenIds.includes(id));
        }
      } else {
        // Marcar
        newSelection.push(mod.id);
        // Se for um menu pai, marca todos os filhos dele automaticamente
        if (!mod.parent_slug) {
          const children = modules.filter(m => m.parent_slug === mod.slug);
          children.forEach(c => {
            if (!newSelection.includes(c.id)) newSelection.push(c.id);
          });
        } else {
          // Se for um filho sendo marcado, podemos opcionalmente marcar o pai também para fazer sentido
          const parent = modules.find(m => m.slug === mod.parent_slug);
          if (parent && !newSelection.includes(parent.id)) {
            newSelection.push(parent.id);
          }
        }
      }
      return newSelection;
    });
  };

  useEffect(() => {
    async function fetchPlan() {
      try {
        setLoading(true);
        const { data: planData, error: planError } = await supabase
          .from('system_plans')
          .select('*')
          .ilike('sistema', '791glass')
          .maybeSingle();

        if (planError) throw planError;

        if (planData) {
          setBasePrice(formatCurrency(String((planData.base_price || 0) * 100)));
          
          const formattedBundles: Record<string, string> = {};
          Object.entries(planData.bundle_prices || {}).forEach(([k, v]: [string, any]) => {
            formattedBundles[k] = formatCurrency(String(Number(v || 0) * 100));
          });
          setBundlePrices(prev => ({ ...prev, ...formattedBundles }));
          
          if (planData.system_limits) {
            setLimits({
              usersIncluded: String(planData.system_limits.usersIncluded || ''),
              extraUserPrice: formatCurrency(String(Number(planData.system_limits.extraUserPrice || 0) * 100)),
              wppDevices: String(planData.system_limits.wppDevices || ''),
              extraDevicePrice: formatCurrency(String(Number(planData.system_limits.extraDevicePrice || 0) * 100)),
              wppMessages: String(planData.system_limits.wppMessages || ''),
              extraMessagePrice: formatCurrency(String(Number(planData.system_limits.extraMessagePrice || 0) * 100))
            });
          }
        }
      } catch (err: any) {
        console.error('Erro ao carregar dados:', err.message);
        setErrorMsg(`Erro ao carregar: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchPlan();
  }, []);

  const renderBundles = () => {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {BUNDLES.map(bundle => (
          <div key={bundle.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col hover:border-[#3b597b] transition-all">
            <div className="bg-slate-50/50 p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wide">{bundle.name}</h3>
              <div className="relative w-32 shrink-0">
                <span className="absolute left-2.5 top-[11px] text-[11px] font-bold text-[#3b597b]">R$</span>
                <input 
                  type="text" 
                  placeholder="0,00" 
                  value={bundlePrices[bundle.id] || ''}
                  onChange={(e) => setBundlePrices(prev => ({ ...prev, [bundle.id]: formatCurrency(e.target.value) }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-xs font-black rounded-md pl-8 pr-2 h-[40px] focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b]" 
                />
              </div>
            </div>
            <div className="p-4 bg-white flex flex-wrap gap-2">
              {bundle.items.map(item => (
                <span key={item} className="bg-slate-50 text-slate-500 text-[10px] font-bold px-2.5 py-1 rounded-full border border-slate-100 uppercase tracking-tighter">
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 animate-in fade-in duration-500 pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Layers className="text-[#3b597b]" size={24} />
            Configuração de Planos (Glass)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Defina o preço base e o valor de cada módulo opcional (combos).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-md text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm">
            <ArrowLeft size={16} /> Voltar
          </Link>
          <button 
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 text-white rounded-md text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm ${saving ? 'bg-slate-400 cursor-not-allowed' : 'bg-[#3b597b] hover:bg-[#2e4763]'}`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{errorMsg}</p>
        </div>
      )}

      {/* Box 1: Valor do Plano Básico */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Plano Básico (Orçamentos/Materiais)</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Valor mensal do plano base (R$)</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">R$</span>
                <input 
                  type="text" 
                  placeholder="0,00"
                  value={basePrice}
                  onChange={(e) => setBasePrice(formatCurrency(e.target.value))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-black rounded-md pl-9 pr-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
            </div>

            <div className="bg-slate-50/80 p-4 rounded-xl border border-dashed border-slate-200">
              <label className="block text-[11px] font-bold text-[#3b597b] mb-1.5 uppercase tracking-widest">Valor de Todos os Combos Somados</label>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-[#3b597b]">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalFullValue)}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase">/ Mês</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-slate-100">
            <label className="block text-[10px] font-bold text-slate-400 mb-3 uppercase tracking-widest">Recursos Inclusos no Plano Base:</label>
            <div className="flex flex-wrap gap-2">
              {['ORÇAMENTOS', 'MATERIAIS (VIDROS/ALUMÍNIOS)', 'PESSOAS (CLIENTES/FORNEC.)', 'DASHBOARD', 'CONFIGURAÇÕES'].map(tag => (
                <span key={tag} className="bg-emerald-50 text-emerald-600 text-[9px] font-black px-3 py-1.5 rounded-lg border border-emerald-100 uppercase tracking-tight">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Box 2: Combos Opcionais */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Módulos de Expansão (Combos)</h2>
        </div>
        <div className="p-6 bg-slate-50/30">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm">Carregando módulos...</div>
          ) : (
            renderBundles()
          )}
        </div>
      </div>

      {/* Limitadores e Extras Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Box 4: Limite de Usuários */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Limite de Usuários do Sistema</h2>
          </div>
          <div className="p-6 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Limite de usuários (Incluso)</label>
              <input 
                type="number" 
                placeholder="Ex: 5"
                value={limits.usersIncluded}
                onChange={(e) => setLimits(prev => ({ ...prev, usersIncluded: e.target.value }))}
                className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md px-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Valor por usuário adicional (R$)</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">R$</span>
                <input 
                  type="text" 
                  placeholder="0,00"
                  value={limits.extraUserPrice}
                  onChange={(e) => setLimits(prev => ({ ...prev, extraUserPrice: formatCurrency(e.target.value) }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md pl-9 pr-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Box 5: WhatsApp */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Integração WhatsApp</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Aparelhos conectados</label>
                <input 
                  type="number" 
                  placeholder="Ex: 1"
                  value={limits.wppDevices}
                  onChange={(e) => setLimits(prev => ({ ...prev, wppDevices: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md px-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Valor por aparelho extra (R$)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">R$</span>
                  <input 
                    type="text" 
                    placeholder="0,00"
                    value={limits.extraDevicePrice}
                    onChange={(e) => setLimits(prev => ({ ...prev, extraDevicePrice: formatCurrency(e.target.value) }))}
                    className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md pl-9 pr-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Limite de mensagens</label>
                <input 
                  type="number" 
                  placeholder="Ex: 1000"
                  value={limits.wppMessages}
                  onChange={(e) => setLimits(prev => ({ ...prev, wppMessages: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md px-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5 uppercase tracking-tight">Valor por mensagem extra (R$)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">R$</span>
                  <input 
                    type="text" 
                    placeholder="0,00"
                    value={limits.extraMessagePrice}
                    onChange={(e) => setLimits(prev => ({ ...prev, extraMessagePrice: formatCurrency(e.target.value) }))}
                    className="w-full bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md pl-9 pr-3 h-[44px] focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
