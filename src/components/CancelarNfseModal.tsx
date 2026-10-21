"use client";

import { useState } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import {
  DOCUMENTOS_FORA_DO_PRAZO, MOTIVOS_CANCELAMENTO, PRAZO_CANCELAMENTO_DIAS, URL_CANCELAMENTO_PREFEITURA,
  calcularPrazoCancelamento, validarPedidoCancelamento, type MotivoCancelamento,
} from '@/services/nfse/cancelamento';

interface Props {
  titulo: string;
  endpoint: string;
  emitidaEm: string | null;
  nacional: boolean;
  onClose: () => void;
  onCancelada: () => void;
}

export default function CancelarNfseModal({ titulo, endpoint, emitidaEm, nacional, onClose, onCancelada }: Props) {
  const [motivo, setMotivo] = useState<MotivoCancelamento | 0>(0);
  const [justificativa, setJustificativa] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const prazo = emitidaEm ? calcularPrazoCancelamento(emitidaEm) : null;
  const invalido = validarPedidoCancelamento(motivo, justificativa);
  const tamanho = justificativa.trim().length;

  async function cancelar() {
    if (invalido || !confirmado) return;
    setBusy(true); setErro('');
    try {
      const res = await holdingAuthFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo, justificativa: justificativa.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Falha no cancelamento.');
      onCancelada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no cancelamento.');
    } finally {
      setBusy(false);
    }
  }

  const foraDoPrazo = (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
      <p className="font-bold">Fora do prazo do sistema, o cancelamento é por processo na Prefeitura de São José:</p>
      <ul className="list-disc pl-5 space-y-0.5">{DOCUMENTOS_FORA_DO_PRAZO.map(d => <li key={d}>{d}</li>)}</ul>
      <a href={URL_CANCELAMENTO_PREFEITURA} target="_blank" rel="noopener noreferrer" className="underline font-bold">Orientações oficiais da prefeitura</a>
    </div>
  );

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="cancelar-nfse-titulo">
    <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-auto">
      <h2 id="cancelar-nfse-titulo" className="text-lg font-bold text-slate-800">Cancelar {titulo}</h2>
      <p className="text-xs text-slate-500">
        Uso exclusivo após avaliar o pedido de estorno ou cancelamento da assinatura. Não gera estorno no Asaas.
      </p>

      {prazo && <p className={`text-xs font-semibold ${prazo.dentroDoPrazo ? 'text-emerald-700' : 'text-red-700'}`}>
        Emitida há {prazo.diasDesdeEmissao} dia(s). {prazo.dentroDoPrazo
          ? `Dentro do prazo de ${PRAZO_CANCELAMENTO_DIAS} dias (até ${new Date(prazo.limite).toLocaleString('pt-BR')}).`
          : `Passou do prazo de ${PRAZO_CANCELAMENTO_DIAS} dias; o Emissor Nacional pode recusar.`}
      </p>}

      {!nacional ? <>
        <p className="text-sm text-slate-700">
          Esta nota foi emitida pela IPM (sistema atual da prefeitura), sem chave do Emissor Nacional.
          Cancele no portal da prefeitura (até {PRAZO_CANCELAMENTO_DIAS} dias da emissão) e depois clique em
          &quot;Sincronizar&quot; nesta tela para a situação ser atualizada aqui.
        </p>
        {foraDoPrazo}
      </> : <>
        <label className="block text-xs font-semibold text-slate-600">
          Motivo
          <select value={motivo} onChange={e => setMotivo(Number(e.target.value) as MotivoCancelamento | 0)}
            className="mt-1 block w-full rounded-lg border border-slate-300 p-3 text-sm">
            <option value={0}>Selecione…</option>
            {Object.entries(MOTIVOS_CANCELAMENTO).map(([codigo, nome]) => <option key={codigo} value={codigo}>{codigo} — {nome}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Justificativa (vai para o fisco)
          <textarea value={justificativa} maxLength={255} rows={4} onChange={e => setJustificativa(e.target.value)}
            placeholder="Ex.: Cancelamento da assinatura solicitado pelo cliente em 20/10, estorno aprovado pela 791."
            className="mt-1 block w-full rounded-lg border border-slate-300 p-3 text-sm" />
          <span className={`block text-right text-[11px] ${tamanho >= 15 ? 'text-slate-400' : 'text-red-600'}`}>{tamanho}/255 (mínimo 15)</span>
        </label>
        {prazo && !prazo.dentroDoPrazo && foraDoPrazo}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} className="mt-1" />
          Entendo que o cancelamento é definitivo e é registrado no Emissor Nacional.
        </label>
      </>}

      {erro && <p role="alert" className="text-sm text-red-700 break-words">{erro}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-50">Fechar</button>
        {nacional && <button type="button" onClick={cancelar} disabled={busy || !!invalido || !confirmado}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? 'Cancelando…' : 'Cancelar NFS-e'}
        </button>}
      </div>
    </div>
  </div>;
}
