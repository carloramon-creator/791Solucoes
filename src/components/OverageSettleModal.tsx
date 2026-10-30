"use client";

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';

type Mode = 'received' | 'waived';

interface BankAccountOption {
  id: string;
  name: string;
  bank_name?: string;
}

interface Props {
  recordId: string;
  titulo: string;
  tenantName?: string | null;
  valor: number;
  onClose: () => void;
  onDone: (warnings: string[]) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

/** Baixa de cobrança de excedente: recebido por fora (baixa o boleto e emite NFS-e) ou abono (cancela o boleto). */
export default function OverageSettleModal({ recordId, titulo, tenantName, valor, onClose, onDone }: Props) {
  const [mode, setMode] = useState<Mode>('received');
  const [paidAmount, setPaidAmount] = useState(String(Number(valor || 0).toFixed(2)));
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [bankAccountId, setBankAccountId] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let active = true;
    holdingAuthFetch('/api/system/bank-accounts', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => { if (active && json?.success) setAccounts(json.accounts || []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const valorRecebido = Number(String(paidAmount).replace(',', '.'));
  const podeConfirmar = mode === 'waived'
    ? note.trim().length >= 3
    : Number.isFinite(valorRecebido) && valorRecebido > 0;

  async function confirmar() {
    if (!podeConfirmar || busy) return;
    const pergunta = mode === 'waived'
      ? `Abonar ${formatCurrency(valor)}? O boleto será cancelado no Asaas e o valor não entra como receita.`
      : `Confirmar recebimento por fora de ${formatCurrency(valorRecebido)}? O boleto será baixado no Asaas e a NFS-e emitida.`;
    if (!window.confirm(pergunta)) return;

    setBusy(true);
    setErro('');
    try {
      const res = await holdingAuthFetch('/api/admin/overage-settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          mode,
          note: note.trim() || null,
          ...(mode === 'received' ? { paidAmount: valorRecebido, paymentMethod, bankAccountId: bankAccountId || null } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Falha ao dar baixa.');
      onDone(Array.isArray(json.warnings) ? json.warnings : []);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao dar baixa.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'w-full h-[38px] rounded-lg border border-slate-200 px-3 text-sm';

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">Baixar cobrança de excedente</h3>
          <button onClick={onClose} disabled={busy} aria-label="Fechar" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-800">{titulo}</p>
            {tenantName && <p className="mt-0.5 text-xs text-slate-500">{tenantName}</p>}
            <p className="mt-1 text-xs text-slate-500">Valor da cobrança: {formatCurrency(valor)}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'received', label: 'Recebido por fora', hint: 'Pix/transferência direto. Baixa o boleto e emite NFS-e.' },
              { value: 'waived', label: 'Abonar', hint: 'Perdoa a cobrança. Cancela o boleto, sem receita e sem NFS-e.' },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={`rounded-xl border p-3 text-left transition ${mode === option.value
                  ? option.value === 'waived' ? 'border-slate-500 bg-slate-100' : 'border-emerald-500 bg-emerald-50'
                  : 'border-slate-200 hover:border-slate-300'}`}
              >
                <span className="block text-sm font-bold text-slate-800">{option.label}</span>
                <span className="mt-1 block text-[11px] leading-snug text-slate-500">{option.hint}</span>
              </button>
            ))}
          </div>

          {mode === 'received' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Valor recebido</span>
                <input type="number" step="0.01" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} className={inputClass} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-slate-600">Forma</span>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
                  <option value="Pix">Pix</option>
                  <option value="Transferência">Transferência</option>
                  <option value="Dinheiro">Dinheiro</option>
                  <option value="Boleto">Boleto</option>
                </select>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-xs font-semibold text-slate-600">Conta de recebimento</span>
                <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={inputClass}>
                  <option value="">Não informar</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}{account.bank_name ? ` - ${account.bank_name}` : ''}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600">
              {mode === 'waived' ? 'Motivo do abono (obrigatório)' : 'Observação'}
            </span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>

          {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} disabled={busy} className="h-[38px] rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-600">Cancelar</button>
          <button
            onClick={confirmar}
            disabled={!podeConfirmar || busy}
            className={`inline-flex h-[38px] items-center gap-2 rounded-lg px-4 text-sm font-bold text-white disabled:opacity-50 ${mode === 'waived' ? 'bg-slate-700 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === 'waived' ? 'Abonar cobrança' : 'Confirmar recebimento'}
          </button>
        </div>
      </div>
    </div>
  );
}
