"use client";

import { useEffect, useState } from 'react';
import { supabaseGlass } from '@/lib/supabase-glass';
import { supabase } from '@/lib/supabase';
import { Building2, Search, Settings, Activity, Users, MessageCircle, Save, ChevronDown, ChevronRight, Loader2, Check } from 'lucide-react';

interface Vidracaria {
  id: string;
  nome: string;
  modulos_ativos?: string[];
  status?: string;
  limite_usuarios?: number;
  limite_mensagens_whatsapp?: number;
  limite_usuarios_whats?: number;
  created_at?: string;
}

interface Module {
  id: string;
  nome: string;
  ordem?: number;
  slug?: string;
  parent_slug?: string;
}

export default function GlassClientsPage() {
  const [vidracarias, setVidracarias] = useState<Vidracaria[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [systemPlan, setSystemPlan] = useState<any>(null); // Guardará os módulos inclusos por padrão
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sponsorMap, setSponsorMap] = useState<Record<string, string>>({});
  
  // Modal State
  const [selectedVidracaria, setSelectedVidracaria] = useState<Vidracaria | null>(null);
  const [modalModules, setModalModules] = useState<string[]>([]);
  const [modalUsers, setModalUsers] = useState<number>(0);
  const [modalWpp, setModalWpp] = useState<number>(0);
  const [modalWppUsers, setModalWppUsers] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        // 1. Busca vidraçarias (791glass)
        const { data: vData, error: vError } = await supabaseGlass
          .from('vidracarias')
          .select('*')
          .order('nome');
        if (vError) throw vError;

        // 2. Busca módulos (791glass)
        const { data: mData, error: mError } = await supabaseGlass
          .from('modules')
          .select('*')
          .order('nome'); // depois podemos ordenar por 'ordem'
        if (mError) throw mError;
        
        let sortedModules = mData || [];
        sortedModules.sort((a, b) => {
          if (a.ordem !== undefined && b.ordem !== undefined) return a.ordem - b.ordem;
          return (a.nome || '').localeCompare(b.nome || '');
        });

        // 3. Busca o plano Master (Holding 791 Soluções) para saber o que é "Incluso"
        const { data: pData } = await supabase
          .from('system_plans')
          .select('*')
          .eq('sistema', '791glass')
          .single();

        setVidracarias(vData || []);
        setModules(sortedModules);
        if (pData) setSystemPlan(pData);

        // 4. Buscar Patrocinadores e Vínculos (Holding) para o selo
        const { data: sData } = await supabase
          .from('patrocinadores')
          .select('id, nome');
        
        const { data: vDataHold } = await supabase
          .from('vouchers')
          .select('patrocinador_id, usado_por_vidracaria_id')
          .not('usado_por_vidracaria_id', 'is', null);

        const map: Record<string, string> = {};
        vDataHold?.forEach(v => {
          const sponsor = sData?.find(s => s.id === v.patrocinador_id);
          if (sponsor) map[v.usado_por_vidracaria_id] = sponsor.nome;
        });
        setSponsorMap(map);
      } catch (err: any) {
        console.error("Erro ao buscar dados:", err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const filteredVidracarias = vidracarias.filter(v => 
    (v.nome || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openModal = (vid: Vidracaria) => {
    setSelectedVidracaria(vid);
    setModalModules(vid.modulos_ativos || []);
    
    // Se o cliente tiver limites próprios, usa eles. Senão, puxa o limite padrão do plano master
    const defaultUsers = systemPlan?.system_limits?.usersIncluded ? Number(systemPlan.system_limits.usersIncluded) : 5;
    const defaultWpp = systemPlan?.system_limits?.wppMessages ? Number(systemPlan.system_limits.wppMessages) : 1000;
    const defaultWppUsers = systemPlan?.system_limits?.wppDevices ? Number(systemPlan.system_limits.wppDevices) : 1;
    
    setModalUsers(vid.limite_usuarios ?? defaultUsers);
    setModalWpp(vid.limite_mensagens_whatsapp ?? defaultWpp);
    setModalWppUsers(vid.limite_usuarios_whats ?? defaultWppUsers);
  };

  const handleSaveModal = async () => {
    if (!selectedVidracaria) return;
    setSaving(true);

    try {
      // EFEITO REVERSO: Salvando direto no banco da Vidraçaria (791glass)
      const { error } = await supabaseGlass
        .from('vidracarias')
        .update({
          modulos_ativos: modalModules,
          limite_usuarios: modalUsers,
          limite_mensagens_whatsapp: modalWpp,
          limite_usuarios_whats: modalWppUsers
        })
        .eq('id', selectedVidracaria.id);

      if (error) throw error;

      // Atualiza a lista local na tela para não precisar recarregar a página
      setVidracarias(prev => prev.map(v => 
        v.id === selectedVidracaria.id 
          ? { ...v, modulos_ativos: modalModules, limite_usuarios: modalUsers, limite_mensagens_whatsapp: modalWpp, limite_usuarios_whats: modalWppUsers }
          : v
      ));

      alert('Configurações da vidraçaria atualizadas com sucesso!');
      setSelectedVidracaria(null); // Fecha o modal
    } catch (err: any) {
      console.error(err);
      alert('Erro ao salvar as configurações: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleModule = (mod: Module) => {
    setModalModules(prev => {
      const isSelected = prev.includes(mod.id) || !!(mod.slug && prev.includes(mod.slug));
      let newSelection = [...prev];

      if (isSelected) {
        newSelection = newSelection.filter(val => val !== mod.id && val !== mod.slug);
        if (!mod.parent_slug) { // se desmarcou o pai, desmarca os filhos
          const children = modules.filter(m => m.parent_slug === mod.slug);
          children.forEach(c => {
            newSelection = newSelection.filter(val => val !== c.id && val !== c.slug);
          });
        }
      } else {
        // FORÇA SALVAR COMO SLUG!
        if (mod.slug) newSelection.push(mod.slug);
        
        if (!mod.parent_slug) { // se marcou o pai, marca os filhos
          const children = modules.filter(m => m.parent_slug === mod.slug);
          children.forEach(c => {
            if (c.slug && !newSelection.includes(c.slug)) {
              newSelection.push(c.slug);
            }
          });
        } else {
          // opcional: auto-marcar pai se marcar filho
          const parent = modules.find(m => m.slug === mod.parent_slug);
          if (parent && parent.slug && !newSelection.includes(parent.slug)) {
            newSelection.push(parent.slug);
          }
        }
      }
      return newSelection;
    });
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Building2 className="text-[#3b597b]" size={24} />
            Gestão de Vidraçarias
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Administre os clientes do 791glass, gerencie planos e libere módulos em tempo real.
          </p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-3">
        <Search className="text-slate-400" size={20} />
        <input 
          type="text" 
          placeholder="Buscar por nome da vidraçaria..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-transparent border-none focus:outline-none text-slate-700 text-sm font-medium"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider font-bold text-slate-500">
                <th className="p-4 pl-6">Vidraçaria</th>
                <th className="p-4">Status</th>
                <th className="p-4">Módulos Ativos</th>
                <th className="p-4">Limites</th>
                <th className="p-4 pr-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400 text-sm">Carregando clientes do 791glass...</td>
                </tr>
              ) : filteredVidracarias.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400 text-sm">Nenhuma vidraçaria encontrada.</td>
                </tr>
              ) : (
                filteredVidracarias.map((vid) => (
                  <tr key={vid.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="p-4 pl-6">
                      <div className="font-bold text-slate-800 text-[13px] uppercase">{vid.nome}</div>
                      <div className="text-[11px] text-slate-500 font-medium mt-0.5">Cadastrado em: {vid.created_at ? new Date(vid.created_at).toLocaleDateString() : 'N/A'}</div>
                      {sponsorMap[vid.id] && (
                        <div className="text-[10px] text-red-600 font-black uppercase mt-1">
                          Patrocinado por {sponsorMap[vid.id]}
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase bg-emerald-100 text-emerald-700">
                        <Activity size={10} /> Ativo
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1.5 max-w-[250px]">
                        {vid.modulos_ativos && vid.modulos_ativos.length > 0 ? (() => {
                          // Transforma tudo em nomes bonitos e remove duplicados (caso o array tenha ID e Slug da mesma coisa)
                          const names = vid.modulos_ativos.map(val => {
                            const mod = modules.find(m => m.id === val || m.slug === val);
                            if (mod) return mod.nome;
                            // Se for um slug solto que não está na tabela de módulos (ex: "admin")
                            return String(val).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                          });
                          
                          const uniqueNames = Array.from(new Set(names));

                          return (
                            <>
                              {uniqueNames.slice(0, 3).map((name, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-600 truncate max-w-[120px]" title={name}>
                                  {name}
                                </span>
                              ))}
                              {uniqueNames.length > 3 && (
                                <span className="px-2 py-0.5 bg-[#3b597b]/10 border border-[#3b597b]/20 text-[#3b597b] rounded text-[10px] font-bold cursor-help" title={uniqueNames.slice(3).join(', ')}>
                                  +{uniqueNames.length - 3}
                                </span>
                              )}
                            </>
                          );
                        })() : (
                          <span className="text-[11px] text-slate-400 italic font-medium">Plano Básico Padrão</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-4 text-slate-500">
                        <div className="flex items-center gap-1.5" title="Limite de Usuários">
                          <Users size={14} />
                          <span className="text-[11px] font-bold">{vid.limite_usuarios || (systemPlan?.system_limits?.usersIncluded || 0)}</span>
                        </div>
                        <div className="flex items-center gap-1.5" title="Mensagens WhatsApp">
                          <MessageCircle size={14} />
                          <span className="text-[11px] font-bold">{vid.limite_mensagens_whatsapp || (systemPlan?.system_limits?.wppMessages || 0)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <button 
                        onClick={() => openModal(vid)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                      >
                        <Settings size={14} className="text-[#3b597b]" />
                        Configurar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedVidracaria && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[700px] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Configurações da Vidraçaria</h2>
                <p className="text-[13px] text-slate-500 font-medium mt-1">
                  Ajustando acessos para <span className="font-bold text-[#3b597b]">{selectedVidracaria.nome}</span>
                </p>
              </div>
              <button 
                onClick={() => setSelectedVidracaria(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
              >
                X
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              
              <div className="flex flex-col gap-4">
                {/* Usuários do Sistema */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between sm:justify-start sm:gap-6">
                  <label className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Total de Usuários (Acessos)</label>
                  <input 
                    type="number" 
                    value={modalUsers}
                    onChange={(e) => setModalUsers(Number(e.target.value))}
                    className="w-24 bg-white border border-slate-300 text-slate-900 text-sm font-bold rounded-md px-3 py-1.5 focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b]" 
                  />
                </div>

                {/* WhatsApp */}
                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex flex-col gap-4">
                  <h3 className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                    <MessageCircle size={14} /> Integração WhatsApp
                  </h3>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-3">
                      <label className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Aparelhos Conectados</label>
                      <input 
                        type="number" 
                        value={modalWppUsers}
                        onChange={(e) => setModalWppUsers(Number(e.target.value))}
                        className="w-20 bg-white border border-emerald-200 text-slate-900 text-sm font-bold rounded-md px-3 py-1.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" 
                      />
                    </div>
                    <div className="w-px h-8 bg-emerald-200 hidden sm:block"></div>
                    <div className="flex items-center gap-3">
                      <label className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Limite de Msgs</label>
                      <input 
                        type="number" 
                        value={modalWpp}
                        onChange={(e) => setModalWpp(Number(e.target.value))}
                        className="w-24 bg-white border border-emerald-200 text-slate-900 text-sm font-bold rounded-md px-3 py-1.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" 
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Módulos do Sistema Ativos</h3>
                
                <div className="space-y-3">
                  {modules.filter(m => !m.parent_slug).map(parent => {
                    const children = modules.filter(m => m.parent_slug === parent.slug);
                    const isExpanded = expandedCards[parent.id] !== false;
                    const isParentChecked = modalModules.includes(parent.id) || !!(parent.slug && modalModules.includes(parent.slug));

                    return (
                      <div key={parent.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm transition-all hover:border-slate-300">
                        <div className="flex items-center justify-between p-3 bg-slate-50/50 border-b border-slate-100">
                          <label className="flex items-center gap-3 flex-1 cursor-pointer">
                            <div className="relative flex items-center justify-center">
                              <input 
                                type="checkbox" 
                                className="peer sr-only"
                                checked={isParentChecked}
                                onChange={() => toggleModule(parent)}
                              />
                              <div className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                                isParentChecked
                                  ? 'bg-[#3b597b] border-[#3b597b]' 
                                  : 'bg-white border-slate-300 peer-hover:border-[#3b597b]'
                              }`}>
                                {isParentChecked && <Check size={14} className="text-white" />}
                              </div>
                            </div>
                            <span className="text-[13px] font-bold text-slate-800 uppercase tracking-wide">{parent.nome}</span>
                          </label>
                          
                          <div className="flex items-center gap-2">
                            {children.length > 0 && (
                              <button 
                                onClick={(e) => toggleExpand(e, parent.id)}
                                className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition-colors"
                              >
                                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                              </button>
                            )}
                          </div>
                        </div>

                        {children.length > 0 && isExpanded && (
                          <div className="p-2 flex flex-col gap-1 bg-white">
                            {children.map(child => {
                              const isChildChecked = modalModules.includes(child.id) || !!(child.slug && modalModules.includes(child.slug));
                              
                              return (
                                <label key={child.id} className="flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer hover:bg-slate-50">
                                  <div className="flex items-center gap-3">
                                    <div className="relative flex items-center justify-center ml-1">
                                      <input 
                                        type="checkbox" 
                                        className="peer sr-only"
                                        checked={isChildChecked}
                                        onChange={() => toggleModule(child)}
                                      />
                                      <div className={`w-4 h-4 border-2 rounded flex items-center justify-center transition-colors ${
                                        isChildChecked
                                          ? 'bg-[#6899c4] border-[#6899c4]' 
                                          : 'bg-white border-slate-300 peer-hover:border-[#6899c4]'
                                      }`}>
                                        {isChildChecked && <Check size={12} className="text-white" />}
                                      </div>
                                    </div>
                                    <span className="text-[12px] font-medium text-slate-600">{child.nome}</span>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 shrink-0">
              <button 
                onClick={() => setSelectedVidracaria(null)}
                disabled={saving}
                className="px-5 py-2 bg-white border border-slate-200 text-slate-700 rounded-md text-sm font-bold hover:bg-slate-100 transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveModal}
                disabled={saving}
                className={`px-5 py-2 text-white rounded-md text-sm font-bold transition-colors shadow-sm flex items-center gap-2 ${saving ? 'bg-slate-400 cursor-not-allowed' : 'bg-[#3b597b] hover:bg-[#2e4763]'}`}
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? 'Salvando...' : 'Salvar Modificações'}
              </button>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
