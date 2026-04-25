"use client";

import { useState, useEffect } from 'react';
import { 
  Receipt, 
  Shield, 
  Key, 
  Globe, 
  FileCheck, 
  Save, 
  Loader2, 
  AlertCircle,
  CheckCircle2,
  MapPin,
  Activity,
  Hash,
  Zap,
  Building,
  Image
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { ConfigTabs } from '@/components/ConfigTabs';

export default function NfseConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    environment: 'homologacao',
    auto_emit: false,
    municipal_code: '8303',
    cnae: '',
    tax_code: '',
    ipm_username: '',
    ipm_password: '',
    certificate_uploaded: false,
    passphrase: '',
    prestador_cnpj: '',
    razao_social: '',
    nome_fantasia: '',
    inscricao_municipal: '',
    logradouro: '',
    numero: '',
    bairro: '',
    cep: '',
    cidade: '',
    estado: '',
    telefone: '',
    email_contato: '',
    logo_base64: ''
  });

  const [files, setFiles] = useState<{ pfxBase64?: string }>({});

  useEffect(() => {
    async function fetchConfig() {
      setLoading(true);
      try {
        const res = await fetch('/api/system/nfse-config');
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            setConfig(prev => ({ ...prev, ...data }));
          }
        }
      } catch (err) {
        console.error('Erro ao carregar NFS-e:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFiles({ pfxBase64: reader.result as string });
        setConfig(prev => ({ ...prev, certificate_uploaded: true }));
      };
      reader.readAsDataURL(file);
    }
  };

  const maskCnpj = (value: string) => {
    return value
      .replace(/\D/g, '')
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
      .substring(0, 18);
  };

  const maskPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 10) {
      return numbers
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{4})(\d)/, '$1-$2')
        .substring(0, 14);
    }
    return numbers
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .substring(0, 15);
  };

  const handleCnpjInput = (value: string, field: string) => {
    setConfig({ ...config, [field]: maskCnpj(value) });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setConfig({ ...config, logo_base64: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...config,
        ...(files.pfxBase64 ? { pfxBase64: files.pfxBase64 } : {})
      };

      const res = await fetch('/api/system/nfse-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro ao salvar nas configurações');
      }

      alert('Configurações fiscais salvas com sucesso! ✅');
      setFiles({});
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="animate-spin mb-4" size={32} />
        <span className="uppercase tracking-widest text-xs">Carregando Servidor NFS...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <Receipt className="text-purple-600" size={24} />
            Configurações do Sistema
          </h1>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
            Gerencie as preferências globais e integrações da Holding.
          </p>
        </div>
      </div>

      <ConfigTabs />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Dados da Holding (Prestador) - AGORA NO TOPO E INTEIRO */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden md:col-span-2">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-[#3b597b] rounded-xl">
              <Building size={20} />
            </div>
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">Dados da Holding (791 Soluções)</h2>
          </div>
          <div className="p-8 space-y-8">
            <div className="flex flex-col md:flex-row gap-8 items-start border-b border-slate-50 pb-8">
              <div className="space-y-3">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest">Logo da Empresa</label>
                <div className="flex items-center gap-4">
                  <div className="h-24 w-24 rounded-2xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative group">
                    {config.logo_base64 ? (
                      <img src={config.logo_base64} alt="Logo" className="w-full h-full object-contain p-2" />
                    ) : (
                      <Image size={24} className="text-slate-300" />
                    )}
                    <label className="absolute inset-0 bg-slate-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <span className="text-[10px] text-white font-bold uppercase tracking-tighter">Alterar</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                    </label>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Formatos aceitos: PNG, JPG</p>
                    <p className="text-[9px] text-slate-300 uppercase leading-relaxed max-w-[150px]">Recomendado: Fundo transparente e proporção quadrada.</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                <div>
                  <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Razão Social</label>
                  <input 
                    type="text" 
                    value={config.razao_social}
                    onChange={(e) => setConfig({...config, razao_social: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Nome Fantasia</label>
                  <input 
                    type="text" 
                    value={config.nome_fantasia}
                    onChange={(e) => setConfig({...config, nome_fantasia: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Inscrição Municipal</label>
                <input 
                  type="text" 
                  value={config.inscricao_municipal}
                  onChange={(e) => setConfig({...config, inscricao_municipal: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">E-mail de Contato</label>
                <input 
                  type="email" 
                  value={config.email_contato}
                  onChange={(e) => setConfig({...config, email_contato: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Telefone</label>
                <input 
                  type="text" 
                  value={config.telefone}
                  onChange={(e) => setConfig({...config, telefone: maskPhone(e.target.value)})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-6 border-t border-slate-50 pt-6">
              <div className="md:col-span-1">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">CEP</label>
                <input 
                  type="text" 
                  value={config.cep}
                  onChange={(e) => setConfig({...config, cep: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Logradouro (Rua/Av)</label>
                <input 
                  type="text" 
                  value={config.logradouro}
                  onChange={(e) => setConfig({...config, logradouro: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Número</label>
                <input 
                  type="text" 
                  value={config.numero}
                  onChange={(e) => setConfig({...config, numero: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Bairro</label>
                <input 
                  type="text" 
                  value={config.bairro}
                  onChange={(e) => setConfig({...config, bairro: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Cidade</label>
                <input 
                  type="text" 
                  value={config.cidade}
                  onChange={(e) => setConfig({...config, cidade: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Estado (UF)</label>
                <input 
                  type="text" 
                  maxLength={2}
                  value={config.estado}
                  onChange={(e) => setConfig({...config, estado: e.target.value.toUpperCase()})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bloco Município */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:col-span-2">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="text-purple-500" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Município e Identificação</h2>
            </div>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Código Municipal (IBGE/TOM)</label>
                <input 
                  type="text" 
                  placeholder="Ex: 8303 (São José/SC)"
                  value={config.municipal_code}
                  onChange={(e) => setConfig({...config, municipal_code: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">CNAE Padrão (SaaS)</label>
                <input 
                  type="text" 
                  placeholder="Ex: 6202300"
                  value={config.cnae}
                  onChange={(e) => setConfig({...config, cnae: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Cód. Tributação Nacional</label>
                <input 
                  type="text" 
                  placeholder="Ex: 01.01.01"
                  value={config.tax_code}
                  onChange={(e) => setConfig({...config, tax_code: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
            </div>
            {config.municipal_code === '8303' && (
              <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl flex items-center gap-3">
                <Shield className="text-purple-400 shrink-0" size={16} />
                <p className="text-[11px] text-purple-700 leading-relaxed uppercase tracking-tight">
                  São José/SC detectado. O provedor **IPM Fiscal (Atende.Net)** será usado para emissão.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bloco Credenciais IPM */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:col-span-2">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="text-blue-500" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Acesso IPM Fiscal</h2>
            </div>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Usuário IPM (CNPJ)</label>
                <input 
                  type="text" 
                  placeholder="00.000.000/0001-00"
                  value={config.ipm_username}
                  onChange={(e) => handleCnpjInput(e.target.value, 'ipm_username')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Senha IPM</label>
                <input 
                  type="password" 
                  placeholder="••••••••"
                  value={config.ipm_password}
                  onChange={(e) => setConfig({...config, ipm_password: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">CNPJ do Prestador (Holding)</label>
                <input 
                  type="text" 
                  placeholder="00.000.000/0001-00"
                  value={config.prestador_cnpj}
                  onChange={(e) => handleCnpjInput(e.target.value, 'prestador_cnpj')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Cód. Tributário (Serviço)</label>
                <input 
                  type="text" 
                  placeholder="ex: 01.01.01"
                  value={config.tax_code}
                  onChange={(e) => setConfig({...config, tax_code: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bloco Certificado e Ambiente - LADO A LADO */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck className="text-emerald-500" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Certificado A1</h2>
            </div>
          </div>
          
          <div className="p-6 space-y-4">
            <div className="relative group">
              <input 
                type="file" 
                accept=".pfx,.p12"
                onChange={handleFileChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-xs pt-[13px] cursor-pointer focus:outline-none"
              />
              {config.certificate_uploaded && (
                <div className="absolute right-3 top-3 text-emerald-500 flex items-center gap-1">
                  <CheckCircle2 size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-tighter">Ativo</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-widest mb-2">Senha do Certificado</label>
              <input 
                type="password" 
                placeholder="Senha de exportação"
                value={config.passphrase}
                onChange={(e) => setConfig({...config, passphrase: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="text-blue-500" size={20} />
              <h2 className="text-sm text-slate-800 uppercase tracking-wider">Ambiente</h2>
            </div>
          </div>
          
          <div className="p-6 space-y-4">
            <select 
              value={config.environment}
              onChange={(e) => setConfig({...config, environment: e.target.value})}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 h-[44px] text-sm focus:outline-none appearance-none"
            >
              <option value="homologacao">Homologação (Testes)</option>
              <option value="producao">Produção (Real)</option>
            </select>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
               <div className="flex items-center gap-2">
                  <Zap className={config.auto_emit ? "text-amber-500" : "text-slate-300"} size={16} />
                  <span className="text-[11px] text-slate-600 uppercase font-bold tracking-tight">Emissão Automática</span>
               </div>
               <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer"
                  checked={config.auto_emit}
                  onChange={(e) => setConfig({...config, auto_emit: e.target.checked})}
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>

      </div>

      {/* Botão Salvar */}
      <div className="flex justify-end pt-4">
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-[#3b597b] text-white px-12 py-4 rounded-xl text-sm flex items-center gap-3 hover:bg-[#2e4763] transition-all uppercase tracking-[0.2em] font-bold shadow-lg shadow-blue-900/10 disabled:opacity-70"
        >
          {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
          {saving ? 'Salvando...' : 'Aplicar Configurações'}
        </button>
      </div>

    </div>
  );
}
