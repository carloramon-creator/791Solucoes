"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Pencil, Plus, Users } from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { validateHoldingCustomer, type HoldingCustomer, type HoldingCustomerInput } from '@/lib/holding-customers';
import {
  commercialButtonClass, commercialInputClass, commercialLabelClass, commercialSecondaryClass,
} from '@/components/HoldingCommercialFields';

const EMPTY: HoldingCustomerInput = {
  name: '', document: '', email: '', phone: '', postal_code: '', address: '',
  address_number: '', complement: '', district: '', city: '', state: '', active: true,
};
const fields: Array<{ key: Exclude<keyof HoldingCustomerInput, 'active'>; label: string; required?: boolean; max: number }> = [
  { key: 'name', label: 'Nome / razão social', required: true, max: 160 },
  { key: 'document', label: 'CPF / CNPJ', required: true, max: 20 },
  { key: 'email', label: 'E-mail', required: true, max: 254 },
  { key: 'phone', label: 'Telefone com DDD', max: 25 },
  { key: 'postal_code', label: 'CEP', max: 10 },
  { key: 'address', label: 'Endereço', max: 200 },
  { key: 'address_number', label: 'Número', max: 30 },
  { key: 'complement', label: 'Complemento', max: 100 },
  { key: 'district', label: 'Bairro', max: 100 },
  { key: 'city', label: 'Município', max: 100 },
  { key: 'state', label: 'UF', max: 2 },
];

export default function HoldingCustomersPage() {
  const [customers, setCustomers] = useState<HoldingCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<HoldingCustomerInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const load = useCallback((signal?: AbortSignal) => (
    holdingAuthFetch('/api/admin/holding-customers', { signal }).then(async (response) => {
      const payload: { customers?: HoldingCustomer[]; error?: string } = await response.json();
      if (!response.ok || !Array.isArray(payload.customers)) throw new Error(payload.error || 'Resposta inválida ao carregar clientes.');
      if (!signal?.aborted) setCustomers(payload.customers);
    }).catch((failure: unknown) => {
      if (!signal?.aborted) {
        console.error('[HOLDING CUSTOMERS] Falha ao carregar clientes.');
        setLoadError(failure instanceof Error ? failure.message : 'Falha ao carregar clientes.');
      }
    }).finally(() => { if (!signal?.aborted) setLoading(false); })
  ), []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const open = form !== null;
  useEffect(() => { if (open) nameInput.current?.focus(); }, [open, editingId]);

  function edit(customer?: HoldingCustomer) {
    setEditingId(customer?.id || null);
    setForm(customer ? { ...customer } : { ...EMPTY });
    setError(''); setMessage('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || busy.current) return;
    const validated = validateHoldingCustomer(form);
    if (!validated.ok) { setError(validated.error); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      const response = await holdingAuthFetch('/api/admin/holding-customers', {
        method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validated.data, ...(editingId ? { id: editingId } : {}) }),
      });
      const payload: { customer?: HoldingCustomer; error?: string } = await response.json();
      if (!response.ok || !payload.customer?.id) throw new Error(payload.error || 'O banco não confirmou o cadastro.');
      const customer = payload.customer;
      setCustomers((current) => [...current.filter((item) => item.id !== customer.id), customer]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setForm(null); setEditingId(null);
      setMessage('Cliente salvo somente na Holding. Nenhum cadastro foi criado no Glass ou no Barber.');
    } catch (failure) {
      console.error('[HOLDING CUSTOMERS] Falha ao salvar cliente.');
      setError(failure instanceof Error ? failure.message : 'Falha ao salvar cliente.');
    } finally { busy.current = false; setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800"><Users size={24} /> Clientes da Holding</h1>
          <p className="mt-1 text-sm text-slate-500">Cadastro próprio para projetos e serviços. Não cria tenant, usuário ou assinatura no Glass/Barber.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={commercialSecondaryClass} disabled={loading || open} onClick={() => {
            setLoading(true); setLoadError(''); void load();
          }}>Atualizar</button>
          <button type="button" className={commercialButtonClass} disabled={loading || Boolean(loadError) || open} onClick={() => edit()}><Plus size={16} /> Novo cliente</button>
        </div>
      </header>
      <p className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        Use um cadastro por CPF/CNPJ, mesmo que o cliente tenha vários websites. Complete o endereço fiscal desde já; a emissão de notas ainda não está habilitada.
        O cliente só será vinculado ao Asaas ao gerar cobranças. Dados já existentes no Asaas não serão sobrescritos automaticamente.
      </p>
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{loadError}</p>}
      {form && (
        <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-bold text-slate-800">{editingId ? 'Editar cliente' : 'Novo cliente'}</h2>
          <fieldset disabled={saving} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key} className={commercialLabelClass}>
                  <span>{field.label}{field.required ? ' *' : ''}</span>
                  <input ref={field.key === 'name' ? nameInput : undefined} className={commercialInputClass}
                    type={field.key === 'email' ? 'email' : 'text'} required={field.required} maxLength={field.max}
                    readOnly={field.key === 'document' && Boolean(editingId)} value={form[field.key]}
                    onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">O CPF/CNPJ não pode ser alterado após o cadastro. Edições não modificam os dados históricos de contratos existentes.</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Cliente ativo para novas contratações
            </label>
            {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className={commercialSecondaryClass} onClick={() => setForm(null)}>Cancelar</button>
              <button className={commercialButtonClass} type="submit">{saving && <Loader2 size={16} className="animate-spin" />} Salvar cliente</button>
            </div>
          </fieldset>
        </form>
      )}
      {loading ? <p role="status" className="py-8 text-center text-slate-500">Carregando clientes...</p> : !loadError && (
        customers.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {customers.map((customer) => (
              <article key={customer.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="font-bold text-slate-800">{customer.name}</h2>
                <p className="mt-2 text-sm text-slate-500">CPF/CNPJ: {customer.document}</p>
                <p className="text-sm text-slate-500">{customer.email}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">{customer.active ? 'Ativo' : 'Inativo'}</span>
                  <button type="button" disabled={open} className={commercialSecondaryClass} onClick={() => edit(customer)}><Pencil size={14} /> Editar</button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Nenhum cliente cadastrado. Comece por Novo cliente.</p>
      )}
    </div>
  );
}
