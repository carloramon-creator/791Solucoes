"use client";

import { useEffect, useState } from 'react';
import { AlertCircle, Globe, Loader2 } from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';

export default function WebsitesPage() {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function openWebsites() {
      try {
        const response = await holdingAuthFetch('/api/admin/websites/access', { signal: controller.signal });
        const payload: { url?: string; error?: string } = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Não foi possível acessar a plataforma.');
        if (payload.url !== 'https://websites.791solucoes.com.br/painel') {
          throw new Error('O servidor não confirmou o destino da plataforma.');
        }
        if (!controller.signal.aborted) window.location.replace(payload.url);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('[WEBSITES ACCESS] Falha ao abrir plataforma.', error);
        setError(error instanceof Error ? error.message : 'Não foi possível acessar a plataforma.');
      }
    }
    void openWebsites();
    return () => controller.abort();
  }, [attempt]);

  return <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-8">
    <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-800"><Globe size={24} />791 Websites</h1>
    {error ? <>
      <p role="alert" className="my-6 flex items-start gap-2 text-sm text-red-700"><AlertCircle className="shrink-0" size={18} />{error}</p>
      <button type="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}
        className="rounded-md bg-[#3b597b] px-4 py-3 text-sm font-semibold text-white">Tentar novamente</button>
    </> : <p role="status" className="my-6 flex items-center gap-2 text-sm text-slate-600"><Loader2 size={18} className="animate-spin" />Verificando permissão e abrindo a plataforma…</p>}
  </section>;
}
