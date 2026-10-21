"use client";

import { useEffect, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Loader2, Printer, RefreshCw } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import type { DocumentoOficial } from '@/services/nfse/documento-oficial';
import { grupoCampoOficial, rotuloCampoOficial } from '@/services/nfse/campos-oficiais';

interface Invoice {
  status: string;
  access_link?: string;
  metadata?: {
    nfse_oficial_xml?: string;
    documento_oficial?: DocumentoOficial;
    danfse?: { retorno?: { link?: string; situacao?: string } };
  };
}

export default function InvoicePdfPage() {
  const { id } = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  async function carregar() {
    const res = await holdingAuthFetch(`/api/system/invoices/${id}`);
    const json = await res.json();
    if (!res.ok || !json.invoice) throw new Error(json.error || 'Nota não encontrada.');
    setInvoice(json.invoice);
  }

  useEffect(() => {
    let active = true;
    holdingAuthFetch(`/api/system/invoices/${id}`)
      .then(async res => {
        const json = await res.json();
        if (!res.ok || !json.invoice) throw new Error(json.error || 'Nota não encontrada.');
        if (active) setInvoice(json.invoice);
      })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar nota.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  async function atualizar() {
    setUpdating(true); setError('');
    try {
      const res = await holdingAuthFetch(`/api/system/invoices/${id}/oficial`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha ao consultar prefeitura.');
      await carregar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao consultar prefeitura.');
    } finally {
      setUpdating(false);
    }
  }

  const meta = invoice?.metadata;
  const documento = meta?.documento_oficial;
  const candidato = meta?.danfse?.retorno?.link || invoice?.access_link || '';
  const link = /^https?:\/\//i.test(candidato) ? candidato : '';
  const cancelada = invoice?.status === 'cancelled' || /cancel/i.test(meta?.danfse?.retorno?.situacao || '');
  const grupos = new Map<string, { caminho: string; valor: string }[]>();
  for (const campo of documento?.campos || []) {
    const grupo = grupoCampoOficial(campo.caminho);
    grupos.set(grupo, [...(grupos.get(grupo) || []), campo]);
  }

  function baixarXml() {
    if (!meta?.nfse_oficial_xml) return;
    const url = URL.createObjectURL(new Blob([meta.nfse_oficial_xml], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = `nfse-oficial-${id}.xml`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div>;
  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-5xl space-y-5">
        <nav className="flex flex-wrap items-center gap-4 text-sm font-semibold print:hidden">
          <button onClick={() => router.back()} className="flex items-center gap-2"><ArrowLeft size={16} /> Voltar</button>
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-emerald-700"><ExternalLink size={16} /> Original oficial · imprimir / baixar no portal</a>}
          <button onClick={atualizar} disabled={updating} className="flex items-center gap-2 disabled:opacity-50"><RefreshCw size={16} /> {updating ? 'Consultando…' : 'Consultar documento oficial'}</button>
          {meta?.nfse_oficial_xml && <button onClick={baixarXml} className="flex items-center gap-2"><Download size={16} /> XML oficial</button>}
          {documento && <button onClick={() => window.print()} className="flex items-center gap-2"><Printer size={16} /> Imprimir representação</button>}
        </nav>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
          <header className="border-b border-slate-200 bg-slate-900 p-6 text-white print:bg-white print:text-black">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-400 print:text-black">791 Soluções · Holding → cliente</p>
            <h1 className="mt-2 text-2xl font-bold">Nota fiscal de serviço</h1>
            <p className="mt-2 text-sm">Representação do sistema — não substitui o documento oficial.</p>
            <p className="mt-1 text-xs">Valores e campos transcritos do XML oficial, sem cálculos ou preenchimentos presumidos.</p>
          </header>
          {cancelada && <div className="border-b border-red-300 bg-red-50 p-4 font-bold text-red-700"><strong className="block text-xl">CANCELADA</strong>NFS-e cancelada na prefeitura — sem validade fiscal</div>}
          {!documento && <div className="p-6 text-amber-800">
            O XML oficial completo ainda não foi recuperado. Consulte o original no portal ou use “Consultar documento oficial”.
            Dados enviados na emissão não serão usados para preencher esta representação.
          </div>}
          {Array.from(grupos, ([grupo, campos]) => (
            <section key={grupo} className="border-b border-slate-200 p-5 last:border-0">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-700">{grupo}</h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
                {campos.map(c => <div key={c.caminho} className="min-w-0 rounded-lg bg-slate-50 p-3 print:bg-white">
                  <dt title={c.caminho} className="text-xs text-slate-500">{rotuloCampoOficial(c.caminho)}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-900">{c.valor}</dd>
                </div>)}
              </dl>
            </section>
          ))}
          {documento && <footer className="p-5 text-xs text-slate-500">Campos ausentes no XML não são convertidos em zero. As referências técnicas identificam exatamente a origem de cada informação.</footer>}
        </article>
      </div>
      <style jsx global>{`@media print { @page { size: A4; margin: 12mm; } section, dl > div { break-inside: avoid; } }`}</style>
    </main>
  );
}
