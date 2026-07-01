'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  Key, 
  Copy, 
  Share2, 
  LogOut, 
  CheckCircle2, 
  Calendar, 
  Building2, 
  ExternalLink,
  Loader2,
  Users,
  TrendingUp,
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface SponsorToken {
  id: string;
  codigo: string;
  usado: boolean;
  data_ativacao: string | null;
  created_at: string;
  vidracaria_id: string | null;
  vidracaria_nome: string | null;
  vidracaria_email: string | null;
}

interface SponsorData {
  id: string;
  nome: string;
  razao_social: string;
  email: string;
  cpf_cnpj: string;
  telefone: string;
  total_licencas: number;
  valor_mensal: number;
  ciclo: string;
  status: string;
}

export default function SponsorPortal() {
  const params = useParams();
  const router = useRouter();
  const supabase = createSupabaseBrowser();
  const id = params?.id as string;

  const [sponsor, setSponsor] = useState<SponsorData | null>(null);
  const [tokens, setTokens] = useState<SponsorToken[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // States para Solicitar Cotas
  const [isQuotasModalOpen, setIsQuotasModalOpen] = useState(false);
  const [quotasAmount, setQuotasAmount] = useState<number | string>(5);
  const [quotasCycle, setQuotasCycle] = useState('MONTHLY');
  const [requestingQuotas, setRequestingQuotas] = useState(false);

  async function fetchPortalData() {
    if (!id) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      
      // 1. Buscar os detalhes do patrocinador pela API existente
      const res = await fetch(`/api/sponsors/${id}/details`);
      const details = await res.json();
      
      // 2. Buscar dados do próprio patrocinador na Holding
      const { data: sponsorData, error: sError } = await supabase
        .from('patrocinadores')
        .select('*')
        .eq('id', id)
        .single();

      if (sError) throw sError;

      setSponsor(sponsorData);
      if (details.success) {
        setTokens(details.tokens || []);
        setTemplates(details.templates || []);
      }
    } catch (err) {
      console.error('Erro ao carregar dados do portal:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPortalData();
  }, [id]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Erro ao deslogar:', err);
    }
    window.location.href = '/login';
  };

  const copyToClipboard = (text: string, tokenCode: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(tokenCode);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const getWhatsAppLink = (tokenCode: string) => {
    const text = `Olá! Aqui está o seu token de licença de acesso patrocinado pelo ${sponsor?.nome || 'nosso parceiro'} para o *791Glass*:

🔑 *TOKEN:* ${tokenCode}

Para ativar o patrocínio:
1. Acesse o sistema 791Glass.
2. Na área de assinaturas ou criação de conta, insira este token no campo de cupom/patrocínio.
3. Pronto! Seu plano básico de vidraçaria será liberado sem custos.`;

    return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  };

  const handleRequestQuotas = async () => {
    setRequestingQuotas(true);
    try {
      const res = await fetch('/api/payments/asaas/create-extra-quotas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sponsorId: id,
          quantity: Number(quotasAmount) || 1,
          cycle: quotasCycle
        })
      });
      const data = await res.json();
      if (data.success && data.invoiceUrl) {
        window.open(data.invoiceUrl, '_blank');
        setIsQuotasModalOpen(false);
      } else {
        alert('Erro ao gerar cobrança: ' + data.error);
      }
    } catch (err) {
      alert('Erro ao solicitar cotas.');
    } finally {
      setRequestingQuotas(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-50 gap-3">
        <Loader2 className="animate-spin text-blue-600" size={40} />
        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest animate-pulse">Carregando seu portal...</span>
      </div>
    );
  }

  if (!sponsor) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <Info size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-800">Patrocinador não encontrado</h2>
        <p className="text-sm text-slate-500 mt-2">Os dados deste portal não puderam ser carregados ou o acesso é inválido.</p>
        <button onClick={handleLogout} className="mt-6 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all">
          Voltar para o Login
        </button>
      </div>
    );
  }

  const activeTokens = tokens.filter(t => t.usado);
  const freeTokens = tokens.filter(t => !t.usado);
  const usagePercentage = Math.round((activeTokens.length / (sponsor.total_licencas || 1)) * 100);

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20">
      {/* Header Portal */}
      <div className="bg-[#1e293b] text-white py-8 px-6 lg:px-12 border-b border-slate-800 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/20 flex items-center justify-center border border-blue-400/20 text-blue-400 font-black text-2xl">
              {sponsor.nome.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight">{sponsor.nome}</h1>
                <span className="px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-emerald-400 text-[9px] font-black uppercase tracking-wider">Ativo</span>
              </div>
              <p className="text-slate-400 text-xs mt-1 font-medium">
                Portal de Licenciamento & Gestão de Tokens
              </p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all self-start md:self-auto"
          >
            <LogOut size={16} />
            Sair do Portal
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-12 mt-10 space-y-8">
        
        {/* Cards de Métricas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Licenças Utilizadas */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
            <div className="bg-blue-50 p-4 rounded-xl text-blue-600 shrink-0">
              <Users size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Licenças Ativas</p>
              <h3 className="text-2xl font-black text-slate-800 mt-1">
                {activeTokens.length} <span className="text-slate-300 text-lg font-medium">/ {sponsor.total_licencas}</span>
              </h3>
              <div className="mt-3">
                <div className="flex justify-between text-[9px] text-slate-400 font-bold mb-1">
                  <span>USO DO PLANO</span>
                  <span>{usagePercentage}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-1000"
                    style={{ width: `${usagePercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Plano e Faturamento */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
            <div className="bg-emerald-50 p-4 rounded-xl text-emerald-600 shrink-0">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plano Contratado</p>
              <h3 className="text-2xl font-black text-slate-800 mt-1">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sponsor.valor_mensal)}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight mt-1">
                Ciclo: {sponsor.ciclo === 'MONTHLY' ? 'Mensal' : sponsor.ciclo === 'SEMI_ANNUAL' ? 'Semestral' : sponsor.ciclo === 'YEARLY' ? 'Anual' : sponsor.ciclo}
              </p>
            </div>
          </div>

          {/* Card 3: Tokens Disponíveis */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
            <div className="bg-purple-50 p-4 rounded-xl text-purple-600 shrink-0">
              <Key size={24} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tokens Disponíveis</p>
              <h3 className="text-2xl font-black text-slate-800 mt-1">
                {freeTokens.length}
              </h3>
              <p className="text-[10px] text-purple-600 font-bold uppercase tracking-tight mt-1">
                Prontos para distribuição
              </p>
            </div>
          </div>
        </div>

        {/* Layout Principal em Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Tabela de Gerenciamento de Tokens */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                <Zap size={18} className="text-blue-500" />
                Meus Tokens de Licenciamento
              </h2>
              <button 
                onClick={fetchPortalData}
                className="text-xs text-blue-600 hover:text-blue-700 font-bold"
              >
                Atualizar Lista
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-5 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">#</th>
                      <th className="px-5 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Código do Token</th>
                      <th className="px-5 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Vidraçaria Vinculada</th>
                      <th className="px-5 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Ativado em</th>
                      <th className="px-5 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tokens.length > 0 ? (
                      tokens.map((t, idx) => (
                        <tr key={t.id} className={`transition-colors ${t.usado ? 'bg-emerald-50/5 hover:bg-emerald-50/10' : 'hover:bg-slate-50/50'}`}>
                          <td className="px-4 py-1.5">
                            <span className="text-[9px] font-black text-slate-400">#{idx + 1}</span>
                          </td>
                          <td className="px-4 py-1.5">
                            <span className="text-[10px] font-bold text-slate-700 font-mono tracking-tight bg-slate-100 px-2 py-0.5 rounded">
                              {t.codigo}
                            </span>
                          </td>
                          <td className="px-4 py-1.5">
                            {t.vidracaria_nome ? (
                              <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                <div className="flex flex-col">
                                  <span className="text-[11px] font-bold text-slate-700">{t.vidracaria_nome}</span>
                                  {t.vidracaria_email && (
                                    <span className="text-[8px] text-slate-400">{t.vidracaria_email}</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[9px] text-slate-300 italic">Disponível para parceiro</span>
                            )}
                          </td>
                          <td className="px-4 py-1.5 text-center">
                            {t.data_ativacao ? (
                              <span className="text-[9px] font-bold text-slate-500">
                                {new Date(t.data_ativacao).toLocaleDateString('pt-BR')}
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-1.5">
                            <div className="flex items-center justify-center gap-1.5">
                              {t.usado ? (
                                <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded-full">
                                  <CheckCircle2 size={8} /> ATIVO
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => copyToClipboard(t.codigo, t.codigo)}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                    title="Copiar Token"
                                  >
                                    <Copy size={14} />
                                  </button>
                                  <a
                                    href={getWhatsAppLink(t.codigo)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                    title="Enviar por WhatsApp"
                                  >
                                    <Share2 size={14} />
                                  </a>
                                </>
                              )}
                              {copiedToken === t.codigo && (
                                <span className="text-[8px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded animate-fade-in absolute mt-8">Copiado!</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-400 italic text-xs">
                          Nenhum token disponível neste plano.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Barra Lateral do Portal */}
          <div className="space-y-6">
            
            {/* Templates Compartilhados */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                <Building2 size={14} className="text-amber-500" />
                Templates Disponibilizados
              </h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Estes são os modelos e templates de projetos que você libera automaticamente para seus parceiros patrocinados:
              </p>
              
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {templates.length > 0 ? (
                  templates.map((tpl) => (
                    <div key={tpl.id} className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-100 transition-colors">
                      <span className="text-[11px] font-bold text-slate-600 truncate">{tpl.nome}</span>
                      <ExternalLink size={12} className="text-slate-300 shrink-0" />
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-slate-300 italic">Nenhum template cadastrado.</p>
                )}
              </div>
            </div>

            {/* Como usar / Manual do Portal */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                <ShieldCheck size={14} className="text-blue-500" />
                Como Distribuir Licenças
              </h3>
              <ol className="space-y-3 text-[11px] text-slate-600 font-medium">
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-[10px] shrink-0">1</span>
                  <span>Escolha um token marcado como <strong>disponível</strong> na tabela ao lado.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-[10px] shrink-0">2</span>
                  <span>Clique no ícone <Share2 className="inline-block text-emerald-500 mx-0.5" size={10} /> para enviar o token e as instruções direto pelo WhatsApp do parceiro.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-[10px] shrink-0">3</span>
                  <span>Quando o seu parceiro ativar o token no 791Glass dele, o sistema dele ficará com plano gratuito e o nome aparecerá aqui.</span>
                </li>
              </ol>
            </div>
            
            {/* Solicitar Mais Licenças */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 p-6 rounded-2xl border border-blue-100/50 space-y-3">
              <h4 className="text-[11px] font-black text-blue-700 uppercase tracking-wider">Precisa de mais licenças?</h4>
              <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                Você pode expandir seu plano de patrocínio a qualquer momento para gerar mais cotas de tokens. Entre em contato com o suporte da Holding.
              </p>
              <button
                onClick={() => setIsQuotasModalOpen(true)}
                className="w-full bg-[#3b597b] hover:bg-[#2e4762] text-white py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm mt-2"
              >
                Solicitar Mais Cotas
              </button>
            </div>

          </div>
        </div>

      </div>

      {isQuotasModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsQuotasModalOpen(false)} />
          <div className="relative bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#1e293b] px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-bold">Solicitar Mais Cotas</h3>
              <button onClick={() => setIsQuotasModalOpen(false)} className="text-slate-400 hover:text-white"><LogOut size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Quantidade de Cotas (Tokens)</label>
                <input 
                  type="number" min="1" 
                  value={quotasAmount} onChange={(e) => setQuotasAmount(e.target.value === '' ? '' : parseInt(e.target.value))}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-blue-500" 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Ciclo de Pagamento</label>
                <select 
                  value={quotasCycle} onChange={(e) => setQuotasCycle(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
                >
                  <option value="MONTHLY">Mensal</option>
                  <option value="QUARTERLY">Trimestral (5% Desc)</option>
                  <option value="SEMI_ANNUAL">Semestral (10% Desc)</option>
                  <option value="YEARLY">Anual (15% Desc)</option>
                </select>
              </div>
              
              {(() => {
                const amount = Number(quotasAmount) || 0;
                const baseValuePerQuota = sponsor ? (sponsor.valor_mensal / sponsor.total_licencas) || 0 : 0;
                const baseTotal = baseValuePerQuota * amount;
                
                let months = 1;
                let discountPercent = 0;
                let cycleName = 'Mensal';

                if (quotasCycle === 'QUARTERLY') {
                  months = 3;
                  discountPercent = 5;
                  cycleName = 'Trimestral';
                } else if (quotasCycle === 'SEMI_ANNUAL') {
                  months = 6;
                  discountPercent = 10;
                  cycleName = 'Semestral';
                } else if (quotasCycle === 'YEARLY') {
                  months = 12;
                  discountPercent = 15;
                  cycleName = 'Anual';
                }

                const subtotal = baseTotal * months;
                const discountAmount = subtotal * (discountPercent / 100);
                const totalValue = subtotal - discountAmount;

                return (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Valor Total Estimado ({cycleName})</span>
                    <span className="text-2xl font-black text-[#3b597b]">
                       {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalValue)}
                    </span>
                    {discountPercent > 0 && (
                      <span className="text-[10px] font-bold text-emerald-500 mt-1 bg-emerald-50 px-2 py-0.5 rounded-full">
                        -{discountPercent}% de desconto aplicado
                      </span>
                    )}
                    <span className="text-[9px] text-slate-400 mt-2 text-center">
                      Cálculo: {quotasAmount} cotas x {months} mes(es) <br/> Base por cota: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(baseValuePerQuota)}
                    </span>
                  </div>
                );
              })()}

              <button 
                disabled={requestingQuotas}
                onClick={handleRequestQuotas}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow flex justify-center items-center"
              >
                {requestingQuotas ? <Loader2 size={20} className="animate-spin" /> : 'Confirmar e Pagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
