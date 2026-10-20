"use client";

import { useEffect, useState } from 'react';
import { Loader2, Printer, ArrowLeft, ExternalLink } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { lerRetornoIpm, type DanfseSnapshot, type DanfseEndereco } from '@/services/nfse/danfse-snapshot';

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
    danfse?: DanfseSnapshot;
  };
}

const VAZIO = '—';

export default function InvoicePdfPage() {
  const { id } = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchInvoice() {
    try {
      setError(null);

      const res = await holdingAuthFetch(`/api/system/invoices/${id}`);
      const data = await res.json();

      if (!res.ok || !data.success || !data.invoice) {
        throw new Error(data.error || 'Nota não encontrada');
      }

      setInvoice(data.invoice);
    } catch (err) {
      console.error('Erro nota:', err);
      setError((err as Error).message || 'Nota não encontrada');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchInvoice();
    holdingAuthFetch('/api/system/nfse-config')
      .then(res => (res.ok ? res.json() : null))
      .then(data => setLogo(typeof data?.logo_base64 === 'string' && data.logo_base64 ? data.logo_base64 : null))
      .catch(err => console.error('Erro logo:', err));
  }, [id]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const maskDocument = (doc: string | null = '') => {
    const clean = (doc || '').replace(/\D/g, '');
    if (clean.length === 11) return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (clean.length === 14) return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return clean || VAZIO;
  };

  const maskPhone = (phone: string | null = '') => {
    const clean = (phone || '').replace(/\D/g, '');
    if (clean.length === 11) return clean.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    if (clean.length === 10) return clean.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    return phone || VAZIO;
  };

  const maskCEP = (cep: string | null = '') => {
    const clean = (cep || '').replace(/\D/g, '');
    if (clean.length === 8) return clean.replace(/(\d{5})(\d{3})/, "$1-$2");
    return cep || VAZIO;
  };

  const linhaEndereco = (e: DanfseEndereco | null | undefined) => {
    if (!e) return VAZIO;
    const rua = [e.logradouro, e.numero].filter(Boolean).join(', ');
    return [rua, e.bairro].filter(Boolean).join(' - ') || VAZIO;
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="animate-spin text-purple-600" size={40} />
    </div>
  );
  
  if (error || !invoice) return <div className="p-10 text-center">{error || 'Nota não encontrada'}</div>;

  // Tudo vem do retrato gravado na emissão; nada é lido do cadastro atual.
  const snap = invoice.metadata?.danfse;
  const retorno = snap?.retorno || lerRetornoIpm(invoice.metadata?.xml, invoice.access_link);
  const linkOficial = retorno.link || invoice.access_link || '';
  const codVerificacao = retorno.codigo_verificacao || linkOficial.split('/').pop() || 'AGUARDANDO';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(linkOficial)}`;
  const barcodeText = retorno.chave_acesso_nacional || codVerificacao.padEnd(44, '0').substring(0, 44);
  const cancelada = /cancel/i.test(retorno.situacao || '') || invoice.status === 'cancelled';
  const barcodeUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${barcodeText}&scale=3&height=12&rotate=N&includetext=false`;
  const dataEmissao = retorno.data || new Date(invoice.created_at).toLocaleDateString('pt-BR');
  const numeroNfse = retorno.numero || (invoice.invoice_number.startsWith('HOLD') ? 'PENDENTE' : invoice.invoice_number);

  const p = snap?.prestador;
  const emitente = {
    nome: p?.razao_social || VAZIO,
    cnpj: maskDocument(p?.cnpj),
    im: p?.inscricao_municipal || VAZIO,
    endereco: linhaEndereco(p?.endereco),
    cidade: p?.endereco?.cidade || VAZIO,
    uf: p?.endereco?.uf || VAZIO,
    cep: maskCEP(p?.endereco?.cep),
    fone: maskPhone(p?.telefone),
  };

  const t = snap?.tomador;
  const tomador = {
    nome: t?.razao_social || invoice.client_name || VAZIO,
    fantasia: t?.nome_fantasia || null,
    fone: t?.telefone ? maskPhone(t.telefone) : null,
    doc: maskDocument(t?.documento || invoice.client_document),
    im: t?.inscricao_municipal || VAZIO,
    email: t?.email || VAZIO,
    endereco: linhaEndereco(t?.endereco),
    cidade: t?.endereco?.cidade || VAZIO,
    uf: t?.endereco?.uf || VAZIO,
    cep: maskCEP(t?.endereco?.cep),
  };

  const valor = snap?.servico?.valor ?? invoice.value;
  const aliquota = snap?.servico?.aliquota ?? null;
  const discriminacao = snap?.servico?.discriminacao
    || 'Discriminação não registrada no sistema na época da emissão. Consulte a nota oficial pelo link de autenticidade.';

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 print:bg-white print:p-0">
      
      {/* Ações */}
      <div className="max-w-[820px] mx-auto mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold uppercase text-[10px]">
          <ArrowLeft size={14} /> Voltar
        </button>
        {linkOficial && (
          <a href={linkOficial} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-purple-700 font-bold uppercase text-[10px]">
            <ExternalLink size={14} /> Nota oficial na prefeitura
          </a>
        )}
        <button onClick={() => window.print()} className="bg-purple-600 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg">
          <Printer size={16} className="inline mr-2" /> Imprimir DANFSe
        </button>
      </div>

      {(!snap || snap.origem === 'retroativo') && (
        <div className="max-w-[820px] mx-auto mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 print:hidden">
          Nota emitida antes do registro completo dos dados. Campos não guardados na emissão aparecem como “{VAZIO}”; a versão válida é a nota oficial na prefeitura.
        </div>
      )}

      {snap?.origem === 'oficial_prefeitura' && (
        <div className="max-w-[820px] mx-auto mb-4 rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs text-sky-800 print:hidden">
          Dados copiados do XML oficial desta NFS-e no portal da prefeitura.
        </div>
      )}

      {/* DANFSe Container */}
      <div id="print-area" className="relative w-[19.2cm] min-h-[27.5cm] mx-auto bg-white p-[0.7cm] print:p-[0.7cm] border border-black text-[7.5px] leading-tight flex flex-col gap-1 box-border shadow-2xl print:shadow-none">

        {cancelada && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
              <span className="-rotate-[30deg] text-[110px] font-black tracking-widest text-red-600/20">CANCELADA</span>
            </div>
            <div className="border-2 border-red-600 bg-red-50 p-1 text-center text-[10px] font-black uppercase tracking-widest text-red-700">
              NFS-e cancelada na prefeitura — sem validade fiscal
            </div>
          </>
        )}
        
        {/* Topo */}
        <div className="flex border border-black">
          <div className="w-[15%] flex items-center justify-center p-1 border-r border-black">
             {logo ? (
               <img src={logo} alt="Logo" className="h-[40px] w-auto object-contain" />
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
             <div className="flex justify-between border-b border-black/10"><span>Nº NFS-e</span><span className="font-bold">{numeroNfse}</span></div>
             <div className="flex justify-between border-b border-black/10"><span>SÉRIE</span><span className="font-bold">{retorno.serie || VAZIO}</span></div>
             <div className="flex justify-between border-b border-black/10"><span>EMISSÃO</span><span className="font-bold">{dataEmissao}{retorno.hora ? ` ${retorno.hora}` : ''}</span></div>
             <div className="flex justify-between"><span>SITUAÇÃO</span><span className={`font-bold uppercase ${cancelada ? 'text-red-600' : ''}`}>{cancelada ? 'Cancelada' : retorno.situacao || VAZIO}</span></div>
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
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Nº da NFS-e</p><p className="text-[10px] font-black">{numeroNfse}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Competência</p><p className="font-bold">{dataEmissao}</p></div>
            <div className="p-1 col-span-2"><p className="text-[6px] text-slate-500 font-bold uppercase">Código de Verificação</p><p className="font-bold uppercase tracking-widest">{codVerificacao}</p></div>
        </div>

        {/* Prestador */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Prestador do Serviço</div>
        <div className="grid grid-cols-6 border-x border-b border-black">
            <div className="col-span-3 p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Razão Social</p><p className="text-[9px] font-black uppercase">{emitente.nome}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CNPJ/CPF</p><p className="font-bold">{emitente.cnpj}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">I.M.</p><p className="font-bold">{emitente.im}</p></div>
            <div className="p-1 text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">Telefone</p><p className="font-bold">{emitente.fone}</p></div>
            <div className="col-span-4 p-1 border-r border-t border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Endereço</p><p className="font-medium uppercase">{emitente.endereco}</p></div>
            <div className="p-1 border-r border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">Município / UF</p><p className="font-bold uppercase">{emitente.cidade} - {emitente.uf}</p></div>
            <div className="p-1 border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CEP</p><p className="font-black">{emitente.cep}</p></div>
        </div>

        {/* Tomador */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Tomador do Serviço</div>
        <div className="grid grid-cols-6 border-x border-b border-black">
            <div className="col-span-3 p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Razão Social / Nome</p><p className="text-[9px] font-black uppercase">{tomador.nome}</p>{(tomador.fantasia || tomador.fone) && <p className="text-[7px] font-medium uppercase">{[tomador.fantasia, tomador.fone && `Fone ${tomador.fone}`].filter(Boolean).join(' · ')}</p>}</div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CNPJ/CPF</p><p className="font-bold">{tomador.doc}</p></div>
            <div className="p-1 border-r border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">E-mail</p><p className="font-bold break-all">{tomador.email}</p></div>
            <div className="p-1 text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">I. Municipal</p><p className="font-bold">{tomador.im}</p></div>
            <div className="col-span-4 p-1 border-r border-t border-black"><p className="text-[6px] text-slate-500 font-bold uppercase">Endereço</p><p className="font-medium uppercase">{tomador.endereco}</p></div>
            <div className="p-1 border-r border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">Município / UF</p><p className="font-bold uppercase">{tomador.cidade} - {tomador.uf}</p></div>
            <div className="p-1 border-t border-black text-center"><p className="text-[6px] text-slate-500 font-bold uppercase">CEP</p><p className="font-black">{tomador.cep}</p></div>
        </div>

        {/* Serviço */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Discriminação do Serviço</div>
        <div className="border-x border-b border-black p-2 min-h-[100px] bg-white">
            <p className="text-[8px] leading-relaxed uppercase font-medium">
                {discriminacao}
            </p>
        </div>

        {/* Tributação Municipal */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Tributação Municipal</div>
        <div className="grid grid-cols-4 border-x border-b border-black text-center">
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold">VALOR DO SERVIÇO</p><p className="font-black text-[9px]">{formatCurrency(valor)}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold">BC ISSQN</p><p className="font-black text-[9px]">{formatCurrency(valor)}</p></div>
            <div className="p-1 border-r border-black"><p className="text-[6px] text-slate-500 font-bold">ALÍQUOTA (%)</p><p className="font-black text-[9px]">{aliquota === null ? VAZIO : `${aliquota.toFixed(2).replace('.', ',')}%`}</p></div>
            <div className="p-1"><p className="text-[6px] text-slate-500 font-bold">VALOR ISSQN</p><p className="font-black text-[9px]">{aliquota === null ? VAZIO : formatCurrency(Math.round(valor * aliquota) / 100)}</p></div>
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

        {/* Líquido */}
        <div className="bg-slate-900 text-white flex justify-between items-center p-2 border-x border-b border-black mt-1">
            <span className="font-black uppercase tracking-widest text-[9px]">Valor Líquido da NFS-e</span>
            <span className="text-[16px] font-black">{formatCurrency(valor)}</span>
        </div>

        {/* Complementares */}
        <div className="bg-slate-100 border border-black font-black uppercase p-0.5 px-2">Informações Complementares</div>
        <div className="border-x border-b border-black p-2 text-[7px] leading-tight text-slate-600">
            <p>Empresa optante pelo Simples Nacional.</p>
            {snap?.servico?.codigo && <p className="mt-1 font-bold text-slate-900">Item da lista de serviços: {snap.servico.codigo}</p>}
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
