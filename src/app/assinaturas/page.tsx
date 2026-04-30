"use client";

import { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  Filter, 
  CreditCard, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  ExternalLink,
  RefreshCw,
  MoreVertical,
  Building2,
  Settings,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Check,
  FileCheck,
  Loader2
} from 'lucide-react';

import { supabaseGlass } from '@/lib/supabase-glass';
import { supabase } from '@/lib/supabase';

// Tipagem baseada na tabela vidracarias do Glass
interface Vidracaria {
  id: string;
  nome: string;
  slug: string;
  email: string;
  plan: string;
  ativa: boolean;
  status_assinatura: string;
  vencimento_assinatura?: string;
  created_at: string;
  phone?: string;
  modulos_ativos?: string[];
  limite_usuarios?: number;
  limite_mensagens_whatsapp?: number;
  limite_usuarios_whats?: number;
  patrocinador_id?: string;
  ciclo_pagamento?: 'monthly' | 'semiannual' | 'annual';
}

interface Module {
  id: string;
  nome: string;
  ordem?: number;
  slug?: string;
  parent_slug?: string;
}

import { useParams, useRouter } from 'next/navigation';

export default function AssinaturasPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<Vidracaria[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [sponsorMap, setSponsorMap] = useState<Record<string, string>>({});
  
  // Configuração de Módulos e Limites
  const [modules, setModules] = useState<Module[]>([]);
  const [systemPlan, setSystemPlan] = useState<any>(null);
  const [selectedVidracaria, setSelectedVidracaria] = useState<Vidracaria | null>(null);
  const [modalModules, setModalModules] = useState<string[]>([]);
  const [modalUsers, setModalUsers] = useState<number>(0);
  const [modalWpp, setModalWpp] = useState<number>(0);
  const [modalWppUsers, setModalWppUsers] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  
  // Estado para Emissão de Nota
  const [isEmitModalOpen, setIsEmitModalOpen] = useState(false);
  const [vidracariaToEmit, setVidracariaToEmit] = useState<Vidracaria | null>(null);
  const [emitData, setEmitData] = useState({ valor: '', descricao: '' });
  const [isEmitting, setIsEmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { data: vData, error: vError } = await supabaseGlass
          .from('vidracarias')
          .select('*')
          .order('nome');
        
        if (vError) throw vError;
        setTenants(vData || []);

        const { data: mData } = await supabaseGlass
          .from('modules')
          .select('*')
          .order('ordem');
        setModules(mData || []);

        const { data: pData } = await supabase
          .from('system_plans')
          .select('*')
          .eq('sistema', '791glass')
          .single();
        if (pData) setSystemPlan(pData);
        
        // 4. Buscar Patrocinadores e Vínculos (Holding)
        const { data: sData } = await supabase
          .from('patrocinadores')
          .select('id, nome');
        setSponsors(sData || []);

        const { data: vDataHold } = await supabase
          .from('vouchers')
          .select('patrocinador_id, usado_por_vidracaria_id')
          .not('usado_por_vidracaria_id', 'is', null);

        // Criar mapa de VidracariaID -> Nome do Patrocinador
        const map: Record<string, string> = {};
        vDataHold?.forEach(v => {
          const sponsor = sData?.find(s => s.id === v.patrocinador_id);
          if (sponsor) map[v.usado_por_vidracaria_id] = sponsor.nome;
        });
        setSponsorMap(map);

      } catch (err: any) {
        console.error('Erro ao buscar dados:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getStatusBadge = (isAtiva: boolean) => {
    if (isAtiva) {
      return <span className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-1 rounded-full flex items-center gap-1 uppercase tracking-wide"><CheckCircle2 size={10} /> ATIVA</span>;
    }
    return <span className="bg-red-100 text-red-700 text-[10px] px-2 py-1 rounded-full flex items-center gap-1 uppercase tracking-wide"><AlertCircle size={10} /> INATIVA</span>;
  };

  const openModal = (vid: Vidracaria) => {
    setSelectedVidracaria(vid);
    setModalModules(vid.modulos_ativos || []);
    
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

      setTenants(prev => prev.map(v => 
        v.id === selectedVidracaria.id 
          ? { ...v, modulos_ativos: modalModules, limite_usuarios: modalUsers, limite_mensagens_whatsapp: modalWpp, limite_usuarios_whats: modalWppUsers }
          : v
      ));

      setSelectedVidracaria(null);
    } catch (err: any) {
      console.error(err);
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEmitInvoice = async () => {
    if (!vidracariaToEmit || !emitData.valor) return;
    setIsEmitting(true);
    try {
      const res = await fetch('/api/notas-fiscais/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vidracaria_id: vidracariaToEmit.id,
          valor: parseFloat(emitData.valor),
          descricao: emitData.descricao
        })
      });

      const result = await res.json();
      console.log('[NFSe] Resultado:', result);

      if (result.success) {
        alert('Nota Fiscal emitida com sucesso! ✅');
        setIsEmitModalOpen(false);
      } else {
        throw new Error(result.error || result.message || 'Erro desconhecido na emissão');
      }
    } catch (err: any) {
      alert('Erro na emissão: ' + err.message);
    } finally {
      setIsEmitting(false);
    }
  };

  const toggleModule = (mod: Module) => {
    setModalModules(prev => {
      const isSelected = prev.includes(mod.id) || !!(mod.slug && prev.includes(mod.slug));
      let newSelection = [...prev];

      if (isSelected) {
        newSelection = newSelection.filter(val => val !== mod.id && val !== mod.slug);
        if (!mod.parent_slug) {
          const children = modules.filter(m => m.parent_slug === mod.slug);
          children.forEach(c => {
            newSelection = newSelection.filter(val => val !== c.id && val !== c.slug);
          });
        }
      } else {
        if (mod.slug) newSelection.push(mod.slug);
        if (!mod.parent_slug) {
          const children = modules.filter(m => m.parent_slug === mod.slug);
          children.forEach(c => {
            if (c.slug && !newSelection.includes(c.slug)) {
              newSelection.push(c.slug);
            }
          });
        } else {
          const parent = modules.find(m => m.slug === mod.parent_slug);
          if (parent && parent.slug && !newSelection.includes(parent.slug)) {
            newSelection.push(parent.slug);
          }
        }
      }
      return newSelection;
    });
  };

  const filteredTenants = tenants.filter(v => 
    (v.nome || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.slug || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Users className="text-[#3b597b]" size={24} />
            Gestão de Assinaturas (Glass)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Monitoramento centralizado de todas as vidraçarias cadastradas no SaaS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => window.location.reload()}
            className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <RefreshCw size={16} /> Sincronizar Agora
          </button>
        </div>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por vidraçaria, email ou slug..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-100 rounded-lg pl-10 pr-4 h-[40px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10"
          />
        </div>
      </div>

      {/* Tabela de Assinaturas */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-500">
                <th className="px-6 py-4 text-[11px] uppercase tracking-widest">Vidraçaria / Cliente</th>
                <th className="px-6 py-4 text-[11px] uppercase tracking-widest">Plano / Módulos</th>
                <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-center">Status</th>
                <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-center">Assinatura</th>
                <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-center">Usuários</th>
                <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-right pr-8">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                    Carregando base de dados do Glass...
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((tenant) => {
                  // Cálculo do Valor Mensal
                  let valorTotal = Number(systemPlan?.base_price || 0);
                  const basicIds = systemPlan?.included_modules || [];
                  
                  // Módulos Opcionais: Filtramos o que não é básico
                  const optionals = (tenant.modulos_ativos || []).filter(modRef => {
                    const mod = modules.find(m => m.id === modRef || m.slug === modRef);
                    if (!mod) return false;
                    // Se o módulo (ID ou Slug) está na lista de inclusos, não é opcional
                    return !basicIds.includes(mod.id) && !basicIds.includes(mod.slug || '');
                  });

                  // Soma o preço de cada opcional usando a tabela de preços
                  optionals.forEach(modRef => {
                    const mod = modules.find(m => m.id === modRef || m.slug === modRef);
                    if (mod) {
                      const price = Number(systemPlan?.optional_modules_pricing?.[mod.id] || systemPlan?.optional_modules_pricing?.[mod.slug || ''] || 0);
                      valorTotal += price;
                    }
                  });

                  const baseUsers = Number(systemPlan?.system_limits?.usersIncluded || 0);
                  const extraUsers = Math.max(0, Number(tenant.limite_usuarios || 0) - baseUsers);
                  valorTotal += extraUsers * Number(systemPlan?.system_limits?.extraUserPrice || 0);
                  const baseWpp = Number(systemPlan?.system_limits?.wppDevices || 0);
                  const extraWpp = Math.max(0, Number(tenant.limite_usuarios_whats || 0) - baseWpp);
                  valorTotal += extraWpp * Number(systemPlan?.system_limits?.extraDevicePrice || 0);

                  // Aplicar Desconto do Ciclo (Apenas uma vez!)
                  if (tenant.ciclo_pagamento === 'semiannual') {
                    const discount = Number(systemPlan?.discount_semestral || 5);
                    valorTotal = valorTotal * (1 - discount / 100);
                  } else if (tenant.ciclo_pagamento === 'annual') {
                    const discount = Number(systemPlan?.discount_anual || 15);
                    valorTotal = valorTotal * (1 - discount / 100);
                  }

                  return (
                    <tr key={tenant.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 text-slate-700">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-[#3b597b]">
                            <Building2 size={20} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium flex items-center gap-2">
                              {tenant.nome}
                              <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 rounded uppercase tracking-tighter">
                                /{tenant.slug}
                              </span>
                            </span>
                            <span className="text-xs text-slate-500">{tenant.email || 'E-mail não cadastrado'}</span>
                            {sponsorMap[tenant.id] && (
                              <span className="text-[10px] text-red-600 font-black uppercase mt-0.5">
                                Patrocinado por {sponsorMap[tenant.id]}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                           <div className="flex items-center gap-2 mb-1">
                              <span className="text-[12px] font-bold text-slate-700 uppercase tracking-tight">Plano Básico</span>
                           </div>
                           <div className="flex flex-wrap gap-1">
                              {(tenant.modulos_ativos || []).length > 0 ? tenant.modulos_ativos?.map(modRef => {
                                const mod = modules.find(m => m.slug === modRef || m.id === modRef);
                                if (!mod || mod.parent_slug === 'configuracoes') return null;
                                
                                // Se o módulo é básico, não mostramos como tag de adicional
                                const isBasic = basicIds.includes(mod.id) || basicIds.includes(mod.slug || '');
                                if (isBasic) return null;

                                return (
                                  <span key={modRef} className="text-[9px] font-medium text-[#3b597b] bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-tighter border border-blue-100">
                                    + {mod.nome}
                                  </span>
                                );
                              }) : <span className="text-[10px] text-slate-300 font-medium uppercase tracking-widest italic">Sem adicionais</span>}
                           </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center">
                          {getStatusBadge(tenant.ativa)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-bold text-slate-700">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorTotal)}
                          </span>
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">
                            {tenant.ciclo_pagamento === 'annual' ? 'Anual' : tenant.ciclo_pagamento === 'semiannual' ? 'Semestral' : 'Mensal'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-4">
                            <div className="flex flex-col items-center">
                              <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest leading-none mb-1">SIS</span>
                              <span className="text-[13px] font-medium text-slate-700">{tenant.limite_usuarios}</span>
                            </div>
                            <div className="w-px h-6 bg-slate-100" />
                            <div className="flex flex-col items-center">
                              <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest leading-none mb-1">WPP</span>
                              <span className="text-[13px] font-medium text-slate-700">{tenant.limite_usuarios_whats}</span>
                            </div>
                         </div>
                      </td>
                    <td className="px-6 py-4 text-right pr-8">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => {
                            setVidracariaToEmit(tenant);
                            
                            // Cálculo dinâmico do valor baseado no plano e módulos
                            let valorTotal = systemPlan?.base_price || 0;
                            
                            // Opcionais
                            const basicIds = systemPlan?.included_modules || [];
                            const optionals = (tenant.modulos_ativos || []).filter(mId => !basicIds.includes(mId));
                            optionals.forEach(modId => {
                              valorTotal += (systemPlan?.optional_modules_pricing?.[modId] || 0);
                            });

                            // Usuários Extras
                            const currentUsersLimit = tenant?.limite_usuarios || 0;
                            const baseUsers = systemPlan?.system_limits?.usersIncluded || 5;
                            const extraUsers = Math.max(0, currentUsersLimit - baseUsers);
                            valorTotal += extraUsers * (systemPlan?.system_limits?.extraUserPrice || 0);

                            // WhatsApp Extras
                            const baseWpp = systemPlan?.system_limits?.wppDevices || 1;
                            const extraWpp = Math.max(0, (tenant.limite_usuarios_whats || 0) - baseWpp);
                            valorTotal += extraWpp * (systemPlan?.system_limits?.extraDevicePrice || 0);

                            // Aplicar Desconto do Ciclo
                            if (tenant.ciclo_pagamento === 'semiannual') {
                              const discount = Number(systemPlan?.discount_semestral || 5);
                              valorTotal = valorTotal * (1 - discount / 100);
                            } else if (tenant.ciclo_pagamento === 'annual') {
                              const discount = Number(systemPlan?.discount_anual || 15);
                              valorTotal = valorTotal * (1 - discount / 100);
                            }

                            // Descrição enxuta: apenas módulos pai que NÃO estão na base
                            const modNames = (tenant.modulos_ativos || [])
                              .map(idOrSlug => modules.find(m => m.id === idOrSlug || m.slug === idOrSlug))
                              .filter(m => {
                                if (!m || m.parent_slug) return false;
                                // Se o ID ou Slug do módulo estiver na lista da base, removemos da descrição
                                return !basicIds.includes(m.id) && !basicIds.includes(m.slug || '');
                              })
                              .map(m => m?.nome);

                            // Remover duplicatas de nomes
                            const uniqueModNames = Array.from(new Set(modNames));
                            
                            let desc = `Mensalidade 791Glass - Plano Base`;
                            if (uniqueModNames.length > 0) desc += ` + Adicionais (${uniqueModNames.join(', ')})`;
                            if (extraUsers > 0) desc += ` + ${extraUsers} Usuários Extras`;
                            if (extraWpp > 0) desc += ` + ${extraWpp} Aparelhos Extras`;

                            setEmitData({ 
                              valor: valorTotal.toFixed(2),
                              descricao: desc
                            });
                            setIsEmitModalOpen(true);
                          }}
                          className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all" 
                          title="Emitir Nota Fiscal"
                        >
                          <FileCheck size={18} />
                        </button>
                         <button 
                           onClick={() => router.push(`/assinaturas/${tenant.id}/configurar`)}
                           className="p-2 text-slate-400 hover:text-[#3b597b] hover:bg-slate-100 rounded-lg transition-all" 
                           title="Configurar Plano e Módulos"
                         >
                           <Settings size={18} />
                         </button>
                         <button className="p-2 text-slate-400 hover:text-[#3b597b] hover:bg-slate-100 rounded-lg transition-all" title="Financeiro">
                           <CreditCard size={18} />
                         </button>
                       </div>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Emissão de Nota Fiscal */}
      {isEmitModalOpen && vidracariaToEmit && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                  <FileCheck size={20} />
                </div>
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Emitir NFS-e</h2>
              </div>
              <button onClick={() => setIsEmitModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="p-8 space-y-6">
              <p className="text-xs text-slate-500 uppercase font-bold tracking-widest text-center">
                Confirmar dados para <span className="text-purple-600">{vidracariaToEmit.nome}</span>
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2">Valor da Nota (R$)</label>
                  <input 
                    type="number" 
                    value={emitData.valor}
                    onChange={(e) => setEmitData({...emitData, valor: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-[48px] text-sm font-bold text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2">Discriminação do Serviço</label>
                  <textarea 
                    value={emitData.descricao}
                    onChange={(e) => setEmitData({...emitData, descricao: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600 focus:outline-none min-h-[100px]"
                  />
                </div>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex gap-3">
                <AlertCircle size={18} className="text-amber-500 shrink-0" />
                <p className="text-[10px] text-amber-700 uppercase leading-relaxed font-bold">
                  Atenção: Esta ação enviará os dados para a prefeitura em modo {vidracariaToEmit.ativa ? 'Produção' : 'Homologação'}.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/30 flex gap-3">
              <button 
                onClick={() => setIsEmitModalOpen(false)}
                className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600"
              >Cancelar</button>
              <button 
                onClick={handleEmitInvoice}
                disabled={isEmitting}
                className="flex-[2] bg-purple-600 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-purple-900/20 flex items-center justify-center gap-2 hover:bg-purple-700 disabled:opacity-50"
              >
                {isEmitting ? <Loader2 size={16} className="animate-spin" /> : <FileCheck size={16} />}
                {isEmitting ? 'Transmitindo...' : 'Emitir Agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configuração de Módulos (Migrado do 791glass) */}
      {selectedVidracaria && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[700px] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Configurar Acessos</h2>
                <p className="text-[13px] text-slate-500 font-medium mt-1 text-slate-500">
                  Ajustando módulos para <span className="text-[#3b597b]">{selectedVidracaria.nome}</span>
                </p>
              </div>
              <button 
                onClick={() => setSelectedVidracaria(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 text-slate-900">
              <div className="flex flex-col gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                  <label className="text-[12px] text-slate-700 uppercase tracking-wide">Total de Usuários</label>
                  <input 
                    type="number" 
                    value={modalUsers}
                    onChange={(e) => setModalUsers(Number(e.target.value))}
                    className="w-24 bg-white border border-slate-300 rounded-md px-3 h-[40px] focus:outline-none focus:border-[#3b597b] focus:ring-1 focus:ring-[#3b597b]" 
                  />
                </div>

                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex flex-col gap-4 text-slate-900">
                  <h3 className="text-[11px] text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                    <MessageCircle size={14} /> Integração WhatsApp
                  </h3>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-3">
                      <label className="text-[12px] text-slate-700 uppercase tracking-wide">Aparelhos</label>
                      <input 
                        type="number" 
                        value={modalWppUsers}
                        onChange={(e) => setModalWppUsers(Number(e.target.value))}
                        className="w-20 bg-white border border-emerald-200 rounded-md px-3 h-[40px] focus:outline-none focus:border-emerald-500" 
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-[12px] text-slate-700 uppercase tracking-wide">Limite Msgs</label>
                      <input 
                        type="number" 
                        value={modalWpp}
                        onChange={(e) => setModalWpp(Number(e.target.value))}
                        className="w-24 bg-white border border-emerald-200 rounded-md px-3 h-[40px] focus:outline-none focus:border-emerald-500" 
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-[11px] text-slate-400 uppercase tracking-wider mb-3">Módulos Ativos</h3>
                <div className="space-y-3">
                  {modules.filter(m => !m.parent_slug).map(parent => {
                    const children = modules.filter(m => m.parent_slug === parent.slug);
                    const isExpanded = expandedCards[parent.id] !== false;
                    const isParentChecked = modalModules.includes(parent.id) || !!(parent.slug && modalModules.includes(parent.slug));

                    return (
                      <div key={parent.id} className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between p-3 bg-slate-50/50 border-b border-slate-100">
                          <label className="flex items-center gap-3 flex-1 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={isParentChecked}
                              onChange={() => toggleModule(parent)}
                              className="w-4 h-4 rounded border-slate-300 text-[#3b597b]"
                            />
                            <span className="text-[13px] uppercase tracking-wide">{parent.nome}</span>
                          </label>
                          {children.length > 0 && (
                            <button onClick={() => setExpandedCards(prev => ({ ...prev, [parent.id]: !isExpanded }))}>
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </button>
                          )}
                        </div>

                        {children.length > 0 && isExpanded && (
                          <div className="p-2 grid grid-cols-2 gap-1 bg-white">
                            {children.map(child => {
                              const isChildChecked = modalModules.includes(child.id) || !!(child.slug && modalModules.includes(child.slug));
                              return (
                                <label key={child.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={isChildChecked}
                                    onChange={() => toggleModule(child)}
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-[#3b597b]"
                                  />
                                  <span className="text-[12px] text-slate-600">{child.nome}</span>
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
              <button onClick={() => setSelectedVidracaria(null)} className="px-5 py-2 text-sm text-slate-500 uppercase">Cancelar</button>
              <button 
                onClick={handleSaveModal}
                disabled={saving}
                className="bg-[#3b597b] text-white px-6 py-2 rounded-lg text-sm flex items-center gap-2"
              >
                {saving ? <RefreshCw className="animate-spin" size={16} /> : <Check size={16} />}
                SALVAR ALTERAÇÕES
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
