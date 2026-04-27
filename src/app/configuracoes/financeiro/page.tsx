"use client";

import { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Key, 
  FileCode, 
  CreditCard, 
  QrCode, 
  Save, 
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
  Database,
  Globe,
  Wallet
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { ConfigTabs } from '@/components/ConfigTabs';

export default function FinanceiroConfigPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [success, setSuccess] = useState(false);

  // Estados das chaves
  const [config, setConfig] = useState({
    asaasApiKey: '',
    asaasWalletId: '',
    asaasEnv: 'sandbox',
    interClientId: '',
    interClientSecret: '',
    interCertCrt: '',
    interCertKey: '',
    interCertCa: '',
    interPixKey: '',
    interAccountNumber: '',
    // Supabase Connections
    glassUrl: '',
    glassServiceKey: '',
    barberUrl: '',
    barberServiceKey: ''
  });

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/system/finance-config');
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            setConfig(prev => ({ ...prev, ...data }));
          }
        }
      } catch (err) {
        console.error('Erro ao carregar configurações financeiras:', err);
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch('/api/system/finance-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro ao salvar configurações');
      }
      
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        router.push('/configuracoes');
      }, 1500);
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterWebhook = async () => {
    if (!config.interCertCrt || !config.interCertKey) {
      alert('Por favor, preencha o Certificado (.crt) e a Chave Privada (.key) para registrar o webhook.');
      return;
    }

    setRegisteringWebhook(true);
    try {
      const endpoint = `${window.location.origin}/api/payments/inter/register-webhook`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interClientId: config.interClientId,
          interClientSecret: config.interClientSecret,
          interCertCrt: config.interCertCrt,
          interCertKey: config.interCertKey,
          interCertCa: config.interCertCa,
          interPixKey: config.interPixKey,
          interAccountNumber: config.interAccountNumber
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ${response.status}: ${errorText || 'Servidor não respondeu corretamente'}`);
      }

      const result = await response.json();
      
      if (result.success) {
        alert('Webhook registrado com sucesso no Banco Inter! ✅');
      } else {
        throw new Error(result.error || 'O Banco Inter recusou o registro. Verifique os certificados.');
      }
    } catch (err: any) {
      console.error('Erro detalhado:', err);
      alert('Falha no Registro: ' + (err.message || 'Verifique sua conexão e os certificados.'));
    } finally {
      setRegisteringWebhook(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="animate-spin mb-2" size={32} />
        <span className="text-sm uppercase tracking-widest">Carregando credenciais...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <ShieldCheck className="text-[#3b597b]" size={24} />
          Configurações do Sistema
        </h1>
        <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
          Gerencie as preferências globais e integrações da Holding.
        </p>
      </div>

      <ConfigTabs />

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Bloco ASAAS */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="text-[#3b597b]" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Gateway ASAAS</h2>
            </div>
            <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded uppercase tracking-tighter">CARTÕES</span>
          </div>
          
          <div className="p-6 space-y-6 flex-1">
            <div className="bg-blue-50/50 border border-blue-100 p-3 rounded-lg flex items-start gap-3">
              <Info className="text-blue-400 shrink-0 mt-0.5" size={16} />
              <p className="text-[11px] text-blue-700 leading-relaxed uppercase tracking-tight">
                Processamento de Cartão de Crédito e Débito com recorrência automática.
              </p>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Ambiente</label>
              <select 
                value={config.asaasEnv}
                onChange={(e) => setConfig({...config, asaasEnv: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
              >
                <option value="sandbox">Sandbox (Testes)</option>
                <option value="production">Produção (Real)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">API Key (Asaas)</label>
              <div className="relative">
                <span className="absolute left-3 top-3.5 text-slate-400">
                  <Key size={14} />
                </span>
                <input 
                  type="password" 
                  placeholder="$a_..."
                  value={config.asaasApiKey}
                  onChange={(e) => setConfig({...config, asaasApiKey: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Wallet ID (Asaas)</label>
              <div className="relative">
                <span className="absolute left-3 top-3.5 text-slate-400">
                  <Wallet size={14} />
                </span>
                <input 
                  type="text" 
                  placeholder="ID da carteira..."
                  value={config.asaasWalletId}
                  onChange={(e) => setConfig({...config, asaasWalletId: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bloco BANCO INTER */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="text-orange-500" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Banco Inter API</h2>
            </div>
            <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded uppercase tracking-tighter">PIX / BOLETO</span>
          </div>
          
          <div className="p-6 space-y-6 flex-1 text-slate-900">
            <div className="bg-orange-50/50 border border-orange-100 p-3 rounded-lg flex items-start gap-3">
              <Info className="text-orange-400 shrink-0 mt-0.5" size={16} />
              <p className="text-[11px] text-orange-700 leading-relaxed uppercase tracking-tight">
                Taxas reduzidas em PIX e Boletos. Requer Certificado Digital (.crt e .key).
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Client ID</label>
                <input 
                  type="text" 
                  placeholder="ID da sua aplicação no Inter"
                  value={config.interClientId}
                  onChange={(e) => setConfig({...config, interClientId: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Client Secret</label>
                <input 
                  type="password" 
                  placeholder="Secret da sua aplicação"
                  value={config.interClientSecret}
                  onChange={(e) => setConfig({...config, interClientSecret: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Chave Pix (Chave Aleatória)</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <QrCode size={14} />
                  </span>
                  <input 
                    type="text" 
                    placeholder="286e799c-..."
                    value={config.interPixKey}
                    onChange={(e) => setConfig({...config, interPixKey: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Conta Corrente (S/ Dígito - Obrigatório V3)</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <Building size={14} />
                  </span>
                  <input 
                    type="text" 
                    placeholder="Sua conta..."
                    value={config.interAccountNumber || ''}
                    onChange={(e) => setConfig({...config, interAccountNumber: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-100 mt-2">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] text-slate-500 uppercase tracking-widest ml-1">Certificado (.CRT)</label>
                    <textarea 
                      rows={5}
                      placeholder="-----BEGIN CERTIFICATE-----"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 resize-none"
                      value={config.interCertCrt}
                      onChange={(e) => setConfig({...config, interCertCrt: e.target.value})}
                    ></textarea>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] text-slate-500 uppercase tracking-widest ml-1">Chave Privada (.KEY)</label>
                    <textarea 
                      rows={5}
                      placeholder="-----BEGIN PRIVATE KEY-----"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 resize-none"
                      value={config.interCertKey}
                      onChange={(e) => setConfig({...config, interCertKey: e.target.value})}
                    ></textarea>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] text-amber-600 uppercase tracking-widest ml-1">Certificado Webhook (CA.CRT)</label>
                    <textarea 
                      rows={5}
                      placeholder="-----BEGIN CERTIFICATE-----"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 border-amber-100 resize-none"
                      value={config.interCertCa}
                      onChange={(e) => setConfig({...config, interCertCa: e.target.value})}
                    ></textarea>
                  </div>
               </div>

               <div className="pt-4 border-t border-slate-50">
                  <button 
                    type="button"
                    disabled={registeringWebhook}
                    onClick={handleRegisterWebhook}
                    className="flex items-center gap-2 px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all uppercase text-[10px] tracking-widest border border-slate-200 shadow-sm disabled:opacity-70"
                  >
                    {registeringWebhook ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    {registeringWebhook ? 'Registrando...' : 'Registrar Webhook no Inter'}
                  </button>
               </div>
            </div>
          </div>
        </div>

        {/* Bloco SUPABASE CONNECTIONS */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="text-[#3b597b]" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Ecossistema Supabase</h2>
            </div>
            <span className="text-[10px] bg-[#3b597b]/10 text-[#3b597b] px-2 py-0.5 rounded uppercase tracking-tighter">INFRAESTRUTURA</span>
          </div>
          
          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* GLASS DB */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-6 w-6 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 text-[10px]">G</div>
                <h3 className="text-xs text-slate-700 uppercase tracking-widest">791GLASS (PRODUÇÃO)</h3>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Supabase URL</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <Globe size={14} />
                  </span>
                  <input 
                    type="text" 
                    placeholder="https://your-project.supabase.co"
                    value={config.glassUrl}
                    onChange={(e) => setConfig({...config, glassUrl: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Service Role Key</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <ShieldCheck size={14} />
                  </span>
                  <input 
                    type="password" 
                    placeholder="eyJhbGciOiJIUzI1NiI..."
                    value={config.glassServiceKey}
                    onChange={(e) => setConfig({...config, glassServiceKey: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* BARBER DB */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-6 w-6 rounded-full bg-orange-50 flex items-center justify-center text-orange-500 text-[10px]">B</div>
                <h3 className="text-xs text-slate-700 uppercase tracking-widest">791BARBER (ESTÁVEL)</h3>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Supabase URL</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <Globe size={14} />
                  </span>
                  <input 
                    type="text" 
                    placeholder="https://your-project.supabase.co"
                    value={config.barberUrl}
                    onChange={(e) => setConfig({...config, barberUrl: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">Service Role Key</label>
                <div className="relative">
                  <span className="absolute left-3 top-3.5 text-slate-400">
                    <ShieldCheck size={14} />
                  </span>
                  <input 
                    type="password" 
                    placeholder="eyJhbGciOiJIUzI1NiI..."
                    value={config.barberServiceKey}
                    onChange={(e) => setConfig({...config, barberServiceKey: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 h-[44px] text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Botão de Ação */}
        <div className="md:col-span-2 flex items-center justify-end gap-4 pt-4 border-t border-slate-100">
          {success && (
            <span className="text-emerald-600 text-sm flex items-center gap-2 animate-in fade-in slide-in-from-right-4 uppercase tracking-widest">
              <CheckCircle2 size={18} /> Salvo com sucesso!
            </span>
          )}
          <button 
            type="submit"
            disabled={saving}
            className="bg-[#3b597b] hover:bg-[#2e4763] text-white px-8 py-3 rounded-xl text-sm font-bold flex items-center gap-3 transition-all shadow-lg active:scale-[0.98] disabled:opacity-70 uppercase tracking-widest"
          >
            {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
            Salvar Credenciais
          </button>
        </div>

      </form>

      {/* Alerta de Segurança */}
      <div className="bg-slate-800 rounded-2xl p-6 text-white flex items-start gap-4">
        <div className="bg-white/10 p-3 rounded-xl shrink-0">
          <AlertCircle className="text-white" size={24} />
        </div>
        <div>
          <h3 className="text-lg uppercase tracking-tight">Segurança e Criptografia</h3>
          <p className="text-slate-400 text-xs mt-1 leading-relaxed uppercase tracking-wider">
            Suas chaves de API e certificados são criptografados em repouso e nunca são expostos no front-end para usuários comuns.
          </p>
        </div>
      </div>

    </div>
  );
}
