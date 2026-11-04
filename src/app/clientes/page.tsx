"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Pencil, Plus, Users } from 'lucide-react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import { validDocument, maskCustomerDocument, maskCustomerPhone, maskCustomerCep, readHoldingCustomerLookup, validateHoldingCustomer, type HoldingCustomer, type HoldingCustomerInput } from '@/lib/holding-customers';
import {
  commercialButtonClass, commercialInputClass, commercialLabelClass, commercialSecondaryClass,
} from '@/components/HoldingCommercialFields';

const EMPTY: HoldingCustomerInput = {
  name: '', document: '', email: '', phone: '', postal_code: '', address: '',
  address_number: '', complement: '', district: '', city: '', state: '', active: true,
};
const fields: Array<{ key: Exclude<keyof HoldingCustomerInput, 'active'>; label: string; required?: boolean; max: number }> = [
  { key: 'document', label: 'CPF / CNPJ', required: true, max: 20 },
  { key: 'name', label: 'Nome / razão social', required: true, max: 160 },
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
  const [lookingUp, setLookingUp] = useState(false);
  const busy = useRef(false);
  const lookupVersion = useRef(0);
  const automaticLookup = useRef({ document: '', cep: '' });
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
    lookupVersion.current++;
    automaticLookup.current = { document: customer?.document || '', cep: customer?.postal_code || '' };
    setEditingId(customer?.id || null);
    setForm(customer ? { ...customer } : { ...EMPTY });
    setError(''); setMessage('');
  }
  useEffect(() => () => { lookupVersion.current++; }, []);

  async function lookup(kind: 'document' | 'cep', automatic = false) {
    if (!form || busy.current) return;
    const digits = (kind === 'document' ? form.document : form.postal_code).replace(/\D/g, '');
    if (automatic && (automaticLookup.current[kind] === digits || !digits)) return;
    if (automatic && (kind === 'document' ? !validDocument(digits) : digits.length !== 8)) return;
    automaticLookup.current[kind] = digits;
    setError(''); setMessage('');
    if (kind === 'document') {
      if (!validDocument(digits)) { setError('Informe um CPF ou CNPJ válido antes de consultar.'); return; }
      const existing = customers.find((customer) => customer.document === digits && customer.id !== editingId);
      if (existing) { edit(existing); setMessage('Cliente já cadastrado na Holding. Cadastro aberto para edição, sem duplicar.'); return; }
      if (digits.length === 11) {
        setMessage('CPF com dígitos verificadores válidos. Não há serviço autorizado de consulta de nome/situação do CPF configurado; informe o nome manualmente. Nenhum CPF foi enviado a terceiros.');
        return;
      }
    } else if (digits.length !== 8) { setError('Informe um CEP com 8 dígitos.'); return; }
    if (!automatic && !window.confirm(kind === 'document'
      ? 'Consultar este CNPJ na BrasilAPI e preencher razão social e dados cadastrais? Os campos retornados substituirão os atuais. Confira os dados antes de salvar.'
      : 'Consultar este CEP no ViaCEP e preencher endereço, bairro, município e UF? Confira os dados antes de salvar. Número e complemento serão preservados.')) return;
    const snapshot = { ...form };
    const version = ++lookupVersion.current;
    busy.current = true; setLookingUp(true);
    try {
      const response = await holdingAuthFetch('/api/admin/holding-customers/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ kind: kind === 'document' ? 'cnpj' : 'cep', value: digits }),
      });
      const payload = await readHoldingCustomerLookup(response);
      if (version !== lookupVersion.current) return;
      const values = payload.fields;
      setForm((current) => {
        if (!current) return current;
        if (current.document.replace(/\D/g, '') !== snapshot.document.replace(/\D/g, '')
          || current.postal_code.replace(/\D/g, '') !== snapshot.postal_code.replace(/\D/g, '')) return current;
        const next = { ...current };
        for (const key of ['name', 'email', 'phone', 'postal_code', 'address', 'address_number', 'complement', 'district', 'city', 'state'] as const) {
          if (current[key] === snapshot[key] && (!automatic || !current[key] || key === 'postal_code')
            && typeof values[key] === 'string' && (kind === 'cep' || values[key])) next[key] = values[key];
        }
        return next;
      });
      setMessage(`Dados retornados por ${payload.source}. Confira todos os campos antes de salvar. A consulta não comprova regularidade fiscal.`);
    } catch (failure) {
      if (version === lookupVersion.current) {
        console.error('[HOLDING CUSTOMERS] Falha na consulta cadastral.', {
          type: failure instanceof Error ? failure.name : 'unknown',
        });
        const browserFailure = failure instanceof Error && (
          failure instanceof TypeError || failure instanceof SyntaxError || failure instanceof DOMException
        );
        setError(browserFailure
          ? 'Não foi possível concluir a consulta no navegador. Confira sua conexão, atualize a página e tente novamente. Seus campos foram preservados; você também pode preencher manualmente.'
          : failure instanceof Error ? failure.message : 'Consulta indisponível. Preencha manualmente.');
      }
    } finally {
      if (version === lookupVersion.current) { busy.current = false; setLookingUp(false); }
    }
  }

  async function remove(customer: HoldingCustomer) {
    if (busy.current || !window.confirm(`Excluir o cliente ${customer.name} da Holding?\n\nSó será permitido se não houver nenhum projeto ou assinatura contratado. O cadastro no Asaas não será excluído.`)) return;
    busy.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const response = await holdingAuthFetch('/api/admin/holding-customers', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: customer.id }),
      });
      const payload: { deleted?: boolean; error?: string } = await response.json();
      if (!response.ok || payload.deleted !== true) throw new Error(payload.error || 'O banco não confirmou a exclusão.');
      setCustomers((current) => current.filter((row) => row.id !== customer.id));
      setMessage('Cliente excluído somente da Holding. Nenhum cadastro foi apagado no Asaas, Glass ou Barber.');
    } catch (failure) {
      console.error('[HOLDING CUSTOMERS] Falha ao excluir cliente.');
      setError(failure instanceof Error ? failure.message : 'Não foi possível excluir o cliente.');
    } finally { busy.current = false; setSaving(false); }
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
          <button type="button" className={commercialSecondaryClass} disabled={loading || open || saving} onClick={() => {
            setLoading(true); setLoadError(''); void load();
          }}>Atualizar</button>
          <button type="button" className={commercialButtonClass} disabled={loading || Boolean(loadError) || open || saving} onClick={() => edit()}><Plus size={16} /> Novo cliente</button>
        </div>
      </header>
      <p className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        Ao sair do campo CNPJ ou CEP, consultamos BrasilAPI ou ViaCEP e preenchemos campos vazios. CPF novo: informe o nome manualmente; CPF já cadastrado abre o cliente da Holding.
        O cliente só será vinculado ao Asaas ao gerar cobranças. Dados já existentes no Asaas não serão sobrescritos automaticamente.
      </p>
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
      {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{loadError}</p>}
      {error && !form && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {form && (
        <form onSubmit={save} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-bold text-slate-800">{editingId ? 'Editar cliente' : 'Novo cliente'}</h2>
          <fieldset disabled={saving} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key} className={commercialLabelClass}>
                  <label htmlFor={`customer-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>
                  <input id={`customer-${field.key}`} ref={field.key === 'name' ? nameInput : undefined} className={commercialInputClass}
                    type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'} required={field.required} maxLength={field.max}
                    inputMode={['document', 'postal_code', 'phone'].includes(field.key) ? 'tel' : field.key === 'email' ? 'email' : undefined}
                    autoCapitalize={field.key === 'email' ? 'none' : undefined} spellCheck={field.key === 'email' ? false : undefined}
                    readOnly={field.key === 'document' && Boolean(editingId)}
                    value={field.key === 'document' ? maskCustomerDocument(form.document)
                      : field.key === 'phone' ? maskCustomerPhone(form.phone) : field.key === 'postal_code' ? maskCustomerCep(form.postal_code) : form[field.key]}
                    onBlur={(event) => {
                      if (event.relatedTarget?.tagName === 'BUTTON') return;
                      if (field.key === 'document' && !editingId) void lookup('document', true);
                      if (field.key === 'postal_code') void lookup('cep', true);
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (field.key === 'document' || field.key === 'postal_code') {
                        lookupVersion.current++;
                        automaticLookup.current[field.key === 'document' ? 'document' : 'cep'] = '';
                        if (lookingUp) { busy.current = false; setLookingUp(false); }
                      }
                      setForm({ ...form, [field.key]: field.key === 'document' ? maskCustomerDocument(value)
                        : field.key === 'phone' ? maskCustomerPhone(value) : field.key === 'postal_code' ? maskCustomerCep(value)
                          : field.key === 'state' ? value.toUpperCase() : value });
                    }} />
                  {(field.key === 'document' || field.key === 'postal_code') && <button type="button" disabled={lookingUp} className={commercialSecondaryClass}
                    onClick={() => void lookup(field.key === 'document' ? 'document' : 'cep')}>
                    {lookingUp ? 'Consultando...' : field.key === 'document' ? 'Consultar CPF / CNPJ' : 'Consultar CEP'}
                  </button>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">Consulta automática não substitui campos já preenchidos. Use os botões para consultar novamente. CPF valida os dígitos, mas não consulta nome em bases externas. O CPF/CNPJ não pode ser alterado após o cadastro; edições não modificam contratos existentes.</p>
            {lookingUp && <p role="status" className="text-sm text-slate-600">Consultando cadastro... Você pode continuar preenchendo os outros campos.</p>}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Cliente ativo para novas contratações
            </label>
            {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className={commercialSecondaryClass} onClick={() => {
                lookupVersion.current++; busy.current = false; setLookingUp(false); setForm(null);
              }}>Cancelar</button>
              <button className={commercialButtonClass} disabled={lookingUp} type="submit">{saving && <Loader2 size={16} className="animate-spin" />} Salvar cliente</button>
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
                <p className="mt-2 text-sm text-slate-500">CPF/CNPJ: {maskCustomerDocument(customer.document)}</p>
                <p className="text-sm text-slate-500">{customer.email}</p>
                {customer.phone && <p className="text-sm text-slate-500">{maskCustomerPhone(customer.phone)}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600">{customer.active ? 'Ativo' : 'Inativo'}</span>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={open || saving} className={commercialSecondaryClass} onClick={() => edit(customer)}><Pencil size={14} /> Editar</button>
                    <button type="button" disabled={open || saving} className={commercialSecondaryClass} onClick={() => void remove(customer)}>Excluir</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">Nenhum cliente cadastrado. Comece por Novo cliente.</p>
      )}
    </div>
  );
}
