"use client";

import { useState, useEffect } from 'react';
import { 
  FileCheck, 
  Search, 
  Download, 
  ExternalLink, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Filter,
  Loader2,
  RefreshCw,
  Settings
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface Invoice {
  id: string;
  invoice_number: string;
  status: 'authorized' | 'rejected' | 'pending' | 'cancelled';
  client_name: string;
  value: number;
  created_at: string;
  access_link: string;
  error_message?: string;
  metadata?: {
    xml?: string;
    vidracaria_id?: string;
  };
}

export default function NotasFiscaisPage() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'authorized' | 'rejected'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices();
  }, []);

  async function fetchInvoices() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('system_invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (dbError) throw dbError;
      if (data) setInvoices(data);
    } catch (err: any) {
      console.error('Erro ao carregar notas:', err);
      setError(err.message || 'Erro ao conectar com o banco de dados.');
    } finally {
      setLoading(false);
    }
  }

  const filteredInvoices = invoices.filter(inv => {
    const matchesFilter = filter === 'all' || inv.status === filter;
    const matchesSearch = (inv.client_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
                         (inv.invoice_number?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const downloadXml = (xml: string, filename: string) => {
    if (!xml) return;
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.xml`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-slate-800 tracking-tight uppercase flex items-center gap-2">
            <FileCheck className="text-purple-600" size={24} />
            Gestão de Notas Fiscais
          </h1>
          <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
            Monitoramento de NFS-e emitidas pelo servidor 791.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/configuracoes/nfs">
            <button className="bg-white border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-slate-50 transition-all uppercase tracking-widest shadow-sm">
              <Settings size={14} /> Configurar Servidor
            </button>
          </Link>
          <button 
            onClick={fetchInvoices}
            className="bg-[#3b597b] text-white px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-[#2e4763] transition-all uppercase tracking-widest shadow-lg shadow-blue-900/10"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <button 
            onClick={async () => {
              console.log('--- DIAGNÓSTICO SUPABASE ---');
              console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
              const { data, error, count } = await supabase.from('system_invoices').select('*', { count: 'exact' });
              console.log('Resultado:', { data, error, count });
              alert(error ? `Erro: ${error.message}` : `Sucesso! Encontradas ${data?.length || 0} notas.`);
            }}
            className="bg-amber-500 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-amber-600 transition-all uppercase tracking-widest shadow-lg shadow-amber-900/10"
          >
            Diagnóstico
          </button>
        </div>
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-6 py-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300">
          <AlertCircle size={20} />
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase tracking-widest">Erro de Conexão</span>
            <span className="text-[11px] font-bold opacity-80">{error}</span>
          </div>
        </div>
      )}

      {/* Tabela de Notas */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/30">
          <div className="flex items-center gap-2">
             <button 
                onClick={() => setFilter('all')}
                className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'all' ? 'bg-[#3b597b] text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
             >Todas</button>
             <button 
                onClick={() => setFilter('authorized')}
                className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'authorized' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
             >Autorizadas</button>
             <button 
                onClick={() => setFilter('rejected')}
                className={`text-[10px] px-4 py-1.5 rounded-full uppercase tracking-widest font-bold transition-all ${filter === 'rejected' ? 'bg-red-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
             >Rejeitadas</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Número ou Cliente..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl pl-9 pr-4 h-[38px] text-xs focus:outline-none focus:ring-2 focus:ring-[#3b597b]/10 w-full md:w-64 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-medium border-b border-slate-50 bg-slate-50/50">
                <th className="px-8 py-4">Data / Hora</th>
                <th className="px-8 py-4">Nota / Cliente</th>
                <th className="px-8 py-4">Status</th>
                <th className="px-8 py-4 text-right pr-8">Valor</th>
                <th className="px-8 py-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-slate-400">
                    <Loader2 className="animate-spin mx-auto mb-3" size={28} />
                    <span className="uppercase tracking-[0.2em] text-[10px] font-bold">Consultando Servidor de Notas...</span>
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                    Nenhuma nota fiscal encontrada.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition-all group">
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-[12px] text-slate-700">{new Date(inv.created_at).toLocaleDateString('pt-BR')}</span>
                        <span className="text-[10px] text-slate-400 font-medium">{new Date(inv.created_at).toLocaleTimeString('pt-BR')}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-[13px] text-slate-800 uppercase tracking-tight">
                          {inv.invoice_number.startsWith('HOLD') ? `IDENTIFICADOR: ${inv.invoice_number.replace('HOLD-', '')}` : `NF-e Nº ${inv.invoice_number}`}
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">{inv.client_name}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`text-[12px] uppercase tracking-tighter px-3 py-1.5 rounded-full flex items-center gap-1.5 w-fit ${
                        inv.status === 'authorized' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 
                        inv.status === 'rejected' ? 'bg-red-50 text-red-600 border border-red-100' : 
                        'bg-amber-50 text-amber-600 border border-amber-100'
                      }`}>
                        {inv.status === 'authorized' ? <CheckCircle2 size={12} /> : 
                         inv.status === 'rejected' ? <AlertCircle size={12} /> : 
                         <Clock size={12} />}
                        {inv.status === 'authorized' ? 'Autorizada' : 
                         inv.status === 'rejected' ? 'Rejeitada' : 
                         'Em Processamento'}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right pr-8 text-sm text-slate-700">
                      {formatCurrency(inv.value)}
                    </td>
                    <td className="px-8 py-5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {inv.status === 'authorized' && (
                          <Link 
                            href={`/notas-fiscais/${inv.id}/pdf`}
                            className="p-2 bg-slate-100 text-purple-600 rounded-lg hover:bg-slate-200 transition-all shadow-sm"
                            title="Ver PDF Próprio"
                          >
                            <FileCheck size={14} />
                          </Link>
                        )}
                        {inv.access_link && (
                          <a 
                            href={inv.access_link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all shadow-sm"
                            title="Ver no Portal da Prefeitura"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        {inv.metadata?.xml && (
                          <button 
                            onClick={() => downloadXml(inv.metadata?.xml || '', `NFSe-${inv.invoice_number}`)}
                            className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all shadow-sm" 
                            title="Download XML"
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
