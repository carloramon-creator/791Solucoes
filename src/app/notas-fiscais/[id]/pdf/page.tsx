"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { supabaseGlass } from '@/lib/supabase-glass';
import { Loader2, Printer, ArrowLeft } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  client_name: string;
  client_document: string;
  value: number;
  created_at: string;
  access_link: string;
  metadata: {
    xml?: string;
    vidracaria_id?: string;
  };
}

export default function InvoicePdfPage() {
  const { id } = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [vidracaria, setVidracaria] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoice();
    fetch('/api/system/nfse-config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Erro config:', err));
  }, [id]);

  useEffect(() => {
    if (invoice?.metadata?.vidracaria_id) {
      supabaseGlass
        .from('vidracarias')
        .select('*')
        .eq('id', invoice.metadata.vidracaria_id)
        .single()
        .then(({ data }) => {
          if (data) setVidracaria(data);
        });
    }
  }, [invoice]);

  async function fetchInvoice() {
    try {
      const { data, error } = await supabase
        .from('system_invoices')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      setInvoice(data);
    } catch (err) {
      console.error('Erro nota:', err);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const maskDocument = (doc: string = '') => {
    const clean = doc.replace(/\D/g, '');
    if (clean.length === 11) return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (clean.length === 14) return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return clean;
  };

  const maskPhone = (phone: string = '') => {
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11) return clean.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    if (clean.length === 10) return clean.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    return phone;
  };

  const maskCEP = (cep: string = '') => {
    const clean = cep.replace(/\D/g, '');
    if (clean.length === 8) return clean.replace(/(\d{5})(\d{3})/, "$1-$2");
    return cep;
  };

  const extractFromXml = (tag: string, parentTag?: string) => {
    if (!invoice?.metadata.xml) return '';
    let xmlContent = invoice.metadata.xml;

    if (parentTag) {
      const parentRegex = new RegExp(`<${parentTag}[^>]*>(.*?)<\/${parentTag}>`, 'is');
      const parentMatch = xmlContent.match(parentRegex);
      if (parentMatch) xmlContent = parentMatch[1];
      else if (parentTag === 'tomador') return '';
    }

    const regex = new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 'is');
    const match = xmlContent.match(regex);
    const result = match ? match[1].trim() : '';

    if ((tag === 'cidade' || tag === 'uf' || tag === 'estado' || tag === 'municipio') && result.length > 25) return '';
    return result;
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="animate-spin text-purple-600" size={40} />
    </div>
  );
  
  if (!invoice) return <div className="p-10 text-center">Nota não encontrada</div>;

  const codVerificacao = invoice.access_link?.split('/').pop() || 'AGUARDANDO';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(invoice.access_link || '')}`;
  const barcodeText = codVerificacao.padEnd(44, '0').substring(0, 44);
  const barcodeUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${barcodeText}&scale=3&height=12&rotate=N&includetext=false`;

  // Dados do Emitente (Configuração do Sistema)
  const emitente = {
    nome: config?.razao_social || '791 SOLUÇÕES TECNOLÓGICAS LTDA',
    cnpj: maskDocument(config?.prestador_cnpj || config?.cnpj) || '07.515.863/0001-40',
    im: config?.inscricao_municipal || '144897',
    endereco: `${config?.logradouro || 'RUA ADHEMAR DA SILVA'}, ${config?.numero || '1118'}`,
    bairro: config?.bairro || 'KOCHELOSKI',
    cidade: config?.cidade || 'SÃO JOSÉ',
    uf: config?.estado || config?.uf || 'SC',
    cep: maskCEP(config?.cep) || '88101-091',
    fone: maskPhone(config?.telefone) || '(48) 3034-7791'
  };

  // Tomador PRIORIZANDO os dados do banco 791glass (vidracaria)
  const tomador = {
    nome: vidracaria?.nome || extractFromXml('nome_razao_social', 'tomador') || extractFromXml('razao_social', 'tomador') || invoice.client_name,
    doc: maskDocument(vidracaria?.cnpj || extractFromXml('cpfcnpj', 'tomador') || extractFromXml('documento', 'tomador') || invoice.client_document),
    im: vidracaria?.inscricao_municipal || extractFromXml('inscricao_municipal', 'tomador') || '-',
    ie: vidracaria?.inscricao_estadual || extractFromXml('inscricao_estadual', 'tomador') || '-',
    endereco: vidracaria ? `${vidracaria.endereco}${vidracaria.numero ? ', ' + vidracaria.numero : ''}` : (extractFromXml('logradouro', 'tomador') || extractFromXml('endereco', 'tomador') || 'Endereço não informado'),
    bairro: vidracaria?.bairro || extractFromXml('bairro', 'tomador') || '-',
    cidade: vidracaria?.cidade || extractFromXml('cidade', 'tomador') || '-',
    uf: vidracaria?.estado || extractFromXml('uf', 'tomador') || extractFromXml('estado', 'tomador') || '-',
    cep: maskCEP(vidracaria?.cep || extractFromXml('cep', 'tomador')) || '-',
    fone: maskPhone(vidracaria?.phone || extractFromXml('telefone', 'tomador')) || '-'
  };

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 print:bg-white print:p-0">
      
      {/* Ações */}
      <div className="max-w-[820px] mx-auto mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px]">
          <ArrowLeft size={14} /> Voltar
        </button>
        <button onClick={() => window.print()} className="bg-purple-600 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">
          <Printer size={16} className="inline mr-2" /> Imprimir DANFSe
        </button>
      </div>

      {/* DANFSe Container */}
      <div id="print-area" className="w-[19.2cm] min-h-[27.5cm] mx-auto bg-white p-[0.7cm] print:p-[0.7cm] border border-black text-[7.5px] leading-tight flex flex-col gap-1 box-border shadow-2xl print:shadow-none">
        
        {/* Topo */}
        <div className="flex border border-black">
          <div className="w-[15%] flex items-center justify-center p-1 border-r border-black">
             {config?.logo_base64 ? (
               <img src={config.logo_base64} alt="Logo" className="h-[40px] w-auto object-contain" />
             ) : (
               <div className="text-[10px] font-black text-center leading-none">791<br/>SOLUÇÕES</div>
             )}
          </div>
          <div className="w-[50%] text-center flex flex-col justify-center border-r border-black">
            <h1 className="text-[14px] font-black uppercase">DANFSe v1.0</h1>
            <p className="text-[8px] font-bold text-slate-500">Documento Auxiliar da Nota Fiscal de Serviço eletrônica</p>
          </div>
          <div className="w-[15%] flex flex-col items-center justify-center p-1 border-r border-black">
             <img src={qrCodeUrl} alt="QR" className="w-10 h-10" />
             <p className="text-[4px] mt-0.5 font-bold uppercase">Autenticidade</p>
          </div>
          <div className="w-[20%] p-1 flex flex-col justify-center bg-slate-50/20">
             <div className="flex justify-between border-b border-black/10"><span>Nº DPS</span><span className="font-bold">1</span></div>
             <div className="flex justify-between border-b border-black/10"><span>SÉRIE</span><span className="font-bold">70000</span></div>
             <div className="flex justify-between"><span>EMISSÃO</span><span className="font-bold">{new Date(invoice.created_at).toLocaleDateString('pt-BR')}</span></div>
          </div>
        </div>

        {/* Chave */}
        <div className="flex border-x border-b border-black items-center">
            <div className="flex-1 p-1">
                <p className="text-[6px] text-slate-500 font-bold uppercase">Chave de Acesso da NFS-e</p>
                <p className="text-[9px] font-mono tracking-widest text-slate-800 font-bold">{barcodeText}</p>
            </div>
            <div className="w-[35%] flex items-center justify-center p-1 border-l border-black/10 bg-white">
                <img src={barcodeUrl} alt="Barcode" className="h-7 w-full object-contain" />
            </div>
        </div>

        {/* Info Nota */}
        <div className="grid grid-cols-4 border-x border-b border-black text-center">
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Nº da NFS-e</p><p className="text-[10px] font-black">{invoice.invoice_number.startsWith('HOLD') ? 'PENDENTE' : invoice.invoice_number}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Competência</p><p className="font-bold">{new Date(invoice.created_at).toLocaleDateString('pt-BR')}</p></div>
            <div className="p-1 col-span-2"><p className="text-[6px] text-slate-500 font-bold uppercase">Código de Verificação</p><p className="font-bold uppercase tracking-widest">{codVerificacao}</p></div>
        </div>

        {/* Prestador */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Prestador do Serviço</div>
        <div className="grid grid-cols-6 border-x border-b border-black">
            <div className="col-span-3 p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Razão Social</p><p className="text-[9px] font-black uppercase">{emitente.nome}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CNPJ/CPF</p><p className="font-bold">{emitente.cnpj}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">I.M.</p><p className="font-bold">{emitente.im}</p></div>
            <div className="p-1 text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">Telefone</p><p className="font-bold">{emitente.fone}</p></div>
            <div className="col-span-4 p-1 border-r border-t border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Endereço</p><p className="font-medium uppercase">{emitente.endereco} - {emitente.bairro}</p></div>
            <div className="p-1 border-r border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">Município / UF</p><p className="font-bold uppercase">{emitente.cidade} - {emitente.uf}</p></div>
            <div className="p-1 border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CEP</p><p className="font-black">{emitente.cep}</p></div>
        </div>

        {/* Tomador */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Tomador do Serviço</div>
        <div className="grid grid-cols-6 border-x border-b border-black">
            <div className="col-span-3 p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Razão Social / Nome</p><p className="text-[9px] font-black uppercase">{tomador.nome}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CNPJ/CPF</p><p className="font-bold">{tomador.doc}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">I. Estadual</p><p className="font-bold">{tomador.ie}</p></div>
            <div className="p-1 text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">I. Municipal</p><p className="font-bold">{tomador.im}</p></div>
            <div className="col-span-4 p-1 border-r border-t border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Endereço</p><p className="font-medium uppercase">{tomador.endereco} - {tomador.bairro}</p></div>
            <div className="p-1 border-r border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">Município / UF</p><p className="font-bold uppercase">{tomador.cidade} - {tomador.uf}</p></div>
            <div className="p-1 border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CEP</p><p className="font-black">{tomador.cep}</p></div>
        </div>

        {/* Serviço */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Discriminação do Serviço</div>
        <div className="border-x border-b border-black p-2 min-h-[100px] bg-white">
            <p className="text-[8px] leading-relaxed uppercase font-medium">
                {extractFromXml('descritivo') || "Licenciamento de Software e Serviços de Tecnologia - Sistema 791Glass. Referente à assinatura mensal de serviços digitais."}
            </p>
        </div>

        {/* Tributação Municipal */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Tributação Municipal</div>
        <div className="grid grid-cols-4 border-x border-b border-black text-center">
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold">VALOR DO SERVIÇO</p><p className="font-black text-[9px]">{formatCurrency(invoice.value)}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold">BC ISSQN</p><p className="font-black text-[9px]">{formatCurrency(invoice.value)}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold">ALÍQUOTA (%)</p><p className="font-black text-[9px]">2,01%</p></div>
            <div className="p-1"><p className="text-[6px] text-slate-500 font-bold">VALOR ISSQN</p><p className="font-black text-[9px]">R$ {(invoice.value * 0.0201).toFixed(2)}</p></div>
        </div>

        {/* Retenções Federais */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Retenções Federais</div>
        <div className="grid grid-cols-5 border-x border-b border-black text-center">
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold">PIS</p><p>R$ 0,00</p></div>
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold">COFINS</p><p>R$ 0,00</p></div>
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold">INSS</p><p>R$ 0,00</p></div>
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold">IRRF</p><p>R$ 0,00</p></div>
            <div className="p-1"><p className="text-[5px] font-bold">CSLL</p><p>R$ 0,00</p></div>
        </div>

        {/* Reforma Tributária */}
        <div className="bg-slate-50 border-x border-b border-black font-black uppercase p-0.5 px-2 italic text-slate-400">Reforma Tributária (IBS / CBS)</div>
        <div className="grid grid-cols-4 border-x border-b border-black text-center bg-slate-50/30">
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold uppercase text-slate-500">IBS Estadual</p><p className="font-black">R$ {(invoice.value * 0.001).toFixed(3)}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold uppercase text-slate-500">CBS Federal</p><p className="font-black">R$ {(invoice.value * 0.009).toFixed(3)}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[5px] font-bold uppercase text-slate-500">BC Consolidada</p><p className="font-black">{formatCurrency(invoice.value)}</p></div>
            <div className="p-1"><p className="text-[5px] font-bold uppercase text-slate-500">Total IBS/CBS</p><p className="font-black text-purple-700">R$ {(invoice.value * 0.01).toFixed(3)}</p></div>
        </div>

        {/* Líquido */}
        <div className="bg-slate-900 text-white flex justify-between items-center p-2 border-x border-b border-black mt-1">
            <span className="font-black uppercase tracking-widest text-[9px]">Valor Líquido da NFS-e</span>
            <span className="text-[16px] font-black">{formatCurrency(invoice.value)}</span>
        </div>

        {/* Complementares */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Informações Complementares</div>
        <div className="border-x border-b border-black p-2 text-[7px] leading-tight text-slate-600">
            <p>Empresa optante pelo Simples Nacional. Tributos aproximados: R$ 0,00 (IBPT).</p>
            <p className="mt-1 font-bold text-slate-900">NBS: 1.2205.11.00 - LICENCIAMENTO DE PROGRAMAS DE COMPUTADOR NÃO CUSTOMIZÁVEIS</p>
        </div>

        <div className="mt-auto flex justify-between border-t border-slate-200 py-1">
            <span className="text-[6px] text-slate-400 italic uppercase">Gerado via 791 Glass System em {new Date().toLocaleString('pt-BR')}</span>
            <span className="text-[6px] font-black text-slate-400">PÁGINA 1 DE 1</span>
        </div>
      </div>

      <style jsx global>{`
        @page { size: A4; margin: 0; }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            height: 100% !important;
            overflow: hidden !important;
          }
          body { visibility: hidden; background: white !important; }
          #print-area {
            visibility: visible !important;
            position: fixed !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            top: 0 !important;
            width: 19.2cm !important;
            height: 29.7cm !important;
            margin: 0 !important;
            padding: 0.7cm !important;
            border: none !important;
            box-shadow: none !important;
            display: flex !important;
            flex-direction: column !important;
          }
          #print-area * { visibility: visible !important; }
          .print-hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
