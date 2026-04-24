"use client";

import { useEffect, useState } from 'react';
import { supabaseGlass } from '@/lib/supabase-glass';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Check, Save, Layers, AlertCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface Module {
  id: string;
  nome: string;
  ordem?: number;
  slug?: string;
  parent_slug?: string;
}

export default function PlanosGlassPage() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Estados do formulário
  const [selectedBasicModules, setSelectedBasicModules] = useState<string[]>([]);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [basePrice, setBasePrice] = useState('');
  const [optionalPrices, setOptionalPrices] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState({
    usersIncluded: '',
    extraUserPrice: '',
    wppDevices: '',
    extraDevicePrice: '',
    wppMessages: '',
    extraMessagePrice: ''
  });

  const handleSave = async () => {
    setSaving(true);
    
    const payload = {
      name: '791glass', // Preenchendo a coluna name que é obrigatória no seu banco
      sistema: '791glass', // Para identificar qual SaaS é esse plano
      base_price: Number(basePrice) || 0,
      included_modules: selectedBasicModules, // Array com os IDs dos módulos inclusos
      optional_modules_pricing: optionalPrices, // Objeto { "id_modulo": "valor" }
      system_limits: limits // Objeto com todos os limites
    };

    try {
      console.log("🚀 Enviando para o Supabase (791 Soluções):", payload);
      
      const { error } = await supabase
        .from('system_plans')
        .upsert(payload, { onConflict: 'sistema' }); // Atualiza se já existir um plano '791glass'

      if (error) {
        // Se a tabela não tiver chave única em 'sistema', o upsert pode falhar
        // Nesse caso, o erro vai aparecer no alert.
        throw error;
      }

      alert("✅ Configurações salvas com sucesso no banco de dados!");
    } catch (err: any) {
      console.error("Erro ao salvar:", err);
      alert(`❌ Erro ao salvar: ${err.message}\n(Verifique se as colunas JSON existem na tabela system_plans)`);
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
    async function fetchModules() {
      try {
        const { data, error } = await supabaseGlass.from('modules').select('*');
        if (error) throw error;
        
        if (data) {
          // Ordenar pelo campo "ordem", se existir. Se não, por nome.
          const sorted = data.sort((a, b) => {
            if (a.ordem !== undefined && b.ordem !== undefined) {
              return a.ordem - b.ordem;
            }
            return (a.nome || '').localeCompare(b.nome || '');
          });
          setModules(sorted);
        }
      } catch (err: any) {
        console.error('Erro ao buscar módulos:', err.message);
        setErrorMsg(`Erro Supabase: ${err.message}. (Verifique o terminal do VSCode e o Console do navegador)`);
      } finally {
        setLoading(false);
      }
    }

    fetchModules();
  }, []);

  const renderBasicModules = () => {
    const parents = modules.filter(m => !m.parent_slug);
    
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {parents.map(parent => {
          const children = modules.filter(m => m.parent_slug === parent.slug);
          const isParentSelected = selectedBasicModules.includes(parent.id);
          const isExpanded = expandedCards[parent.id] !== false; // Default to open if not set
          
          return (
            <div key={parent.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col transition-all hover:border-slate-300">
              <div className="flex items-center justify-between bg-slate-50 border-b border-slate-100 pr-3">
                <label className="flex flex-1 items-center gap-3 p-3 cursor-pointer hover:bg-slate-100 transition-colors">
                  <div className="relative flex items-center justify-center">
                    <input 
                      type="checkbox" 
                      className="peer sr-only" 
                      checked={isParentSelected}
                      onChange={() => toggleBasicModule(parent)}
                    />
                    <div className="w-5 h-5 border-2 border-slate-300 rounded bg-white peer-checked:bg-[#3b597b] peer-checked:border-[#3b597b] transition-colors flex items-center justify-center">
                      <Check size={14} className="text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <span className="font-bold text-slate-800 text-[13px] uppercase tracking-wide">{parent.nome}</span>
                </label>
                {children.length > 0 && (
                  <button 
                    onClick={(e) => toggleExpand(e, parent.id)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-200 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                )}
              </div>
              
              {children.length > 0 && isExpanded && (
                <div className="p-2 flex flex-col gap-0.5 bg-white">
                  {children.map(child => {
                    const isChildSelected = selectedBasicModules.includes(child.id);
                    return (
                      <label key={child.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors group">
                        <div className="relative flex items-center justify-center ml-1">
                          <input 
                            type="checkbox" 
                            className="peer sr-only" 
                            checked={isChildSelected}
                            onChange={() => toggleBasicModule(child)}
                          />
                          <div className="w-4 h-4 border-2 border-slate-300 rounded bg-white peer-checked:bg-[#6899c4] peer-checked:border-[#6899c4] transition-colors flex items-center justify-center">
                            <Check size={12} className="text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <span className="text-[13px] font-medium text-slate-600 group-hover:text-slate-900">{child.nome}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderOptionalModules = () => {
    const parents = modules.filter(m => !m.parent_slug);
    
    const cardsToRender = parents.map(parent => {
      const isParentSelected = selectedBasicModules.includes(parent.id);
      const children = modules.filter(m => m.parent_slug === parent.slug);
      const unselectedChildren = children.filter(c => !selectedBasicModules.includes(c.id));
      
      const isExpanded = expandedCards[`opt-${parent.id}`] !== false; // Default to open
      
      // Se o pai tá incluso E todos os filhos tão inclusos, não renderiza nada aqui
      if (isParentSelected && unselectedChildren.length === 0) return null;

      return (
        <div key={`opt-${parent.id}`} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/30 shadow-sm flex flex-col">
          
          {!isParentSelected && (
            <div className="flex items-center justify-between p-3 border-b border-slate-200 bg-white">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-[13px] uppercase tracking-wide">{parent.nome}</span>
                {unselectedChildren.length > 0 && (
                  <button 
                    onClick={(e) => toggleExpand(e, `opt-${parent.id}`)}
                    className="p-0.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                )}
              </div>
              <div className="relative w-28 shrink-0">
                <span className="absolute left-2.5 top-1.5 text-[11px] font-bold text-slate-400">R$</span>
                <input 
                  type="number" 
                  placeholder="0,00" 
                  value={optionalPrices[parent.id] || ''}
                  onChange={(e) => setOptionalPrices(prev => ({ ...prev, [parent.id]: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-xs font-medium rounded-md pl-7 pr-2 py-1.5 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b]" 
                />
              </div>
            </div>
          )}

          {unselectedChildren.length > 0 && isExpanded && (
            <div className="p-3 flex flex-col gap-2">
              {isParentSelected && (
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Submenus extras em {parent.nome}
                </div>
              )}
              {unselectedChildren.map(child => (
                <div key={`opt-child-${child.id}`} className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-100 shadow-sm">
                  <span className="text-[12px] font-medium text-slate-600 truncate mr-2">{child.nome}</span>
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-2 top-1 text-[10px] font-bold text-slate-400">R$</span>
                    <input 
                      type="number" 
                      placeholder="0,00" 
                      value={optionalPrices[child.id] || ''}
                      onChange={(e) => setOptionalPrices(prev => ({ ...prev, [child.id]: e.target.value }))}
                      className="w-full bg-white border border-slate-300 text-slate-900 text-[11px] font-medium rounded pl-6 pr-1 py-1 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b]" 
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }).filter(Boolean);

    if (cardsToRender.length === 0 && modules.length > 0) {
      return (
        <div className="col-span-full flex items-center justify-center py-6 text-emerald-600 text-sm border-2 border-dashed border-emerald-100 bg-emerald-50/50 rounded-lg">
          Todos os módulos e submenus já estão inclusos no plano básico!
        </div>
      );
    }

    return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{cardsToRender}</div>;
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 animate-in fade-in duration-500 pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Layers className="text-[#3b597b]" size={24} />
            Planos Vidraçarias
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure valores dos módulos, limites e adicionais exclusivos para o segmento de vidraçarias.
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
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Valor do Plano Básico</h2>
        </div>
        <div className="p-6">
          <div className="max-w-xs">
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Valor mensal do plano básico (R$)</label>
            <input 
              type="number" 
              placeholder="0,00"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
            />
          </div>
        </div>
      </div>

      {/* Box 2: Módulos do Plano Básico */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Módulos do Plano Básico</h2>
          <span className="text-[11px] font-semibold bg-[#6899c4]/10 text-[#6899c4] px-2 py-0.5 rounded-full">
            Selecione o que já vem incluso
          </span>
        </div>
        <div className="p-6 bg-slate-50/30">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm">Carregando módulos...</div>
          ) : modules.length === 0 && !errorMsg ? (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
              Nenhum módulo encontrado na tabela 'modules'.
            </div>
          ) : (
            renderBasicModules()
          )}
        </div>
      </div>

      {/* Box 3: Módulos Opcionais */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Módulos Opcionais (Venda Avulsa)</h2>
        </div>
        <div className="p-6 bg-slate-50/30">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm">Carregando módulos...</div>
          ) : modules.length === 0 && !errorMsg ? null : (
            renderOptionalModules()
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
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Limite de usuários (Incluso)</label>
              <input 
                type="number" 
                placeholder="Ex: 5"
                value={limits.usersIncluded}
                onChange={(e) => setLimits(prev => ({ ...prev, usersIncluded: e.target.value }))}
                className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Valor por usuário adicional (R$)</label>
              <input 
                type="number" 
                placeholder="0,00"
                value={limits.extraUserPrice}
                onChange={(e) => setLimits(prev => ({ ...prev, extraUserPrice: e.target.value }))}
                className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
              />
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
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Aparelhos conectados</label>
                <input 
                  type="number" 
                  placeholder="Ex: 1"
                  value={limits.wppDevices}
                  onChange={(e) => setLimits(prev => ({ ...prev, wppDevices: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Valor por aparelho extra (R$)</label>
                <input 
                  type="number" 
                  placeholder="0,00"
                  value={limits.extraDevicePrice}
                  onChange={(e) => setLimits(prev => ({ ...prev, extraDevicePrice: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Limite de mensagens</label>
                <input 
                  type="number" 
                  placeholder="Ex: 1000"
                  value={limits.wppMessages}
                  onChange={(e) => setLimits(prev => ({ ...prev, wppMessages: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Valor por mensagem extra (R$)</label>
                <input 
                  type="number" 
                  placeholder="0,00"
                  value={limits.extraMessagePrice}
                  onChange={(e) => setLimits(prev => ({ ...prev, extraMessagePrice: e.target.value }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20 focus:border-[#3b597b] transition-all"
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
