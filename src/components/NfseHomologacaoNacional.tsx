"use client";

import { useState } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import CancelarNfseModal from '@/components/CancelarNfseModal';

const campos = [
  ['vidracaria_id', 'ID do tenant (791glass)', 'text'],
  ['numero', 'Número da DPS de teste (1 a 15 dígitos)', 'text'],
  ['serie', 'Série nacional da DPS (0 a 89999)', 'text'],
  ['competencia', 'Competência', 'date'],
  ['municipioEmissao', 'Município de emissão — IBGE (7 dígitos)', 'text'],
  ['municipioPrestacao', 'Município da prestação — IBGE (7 dígitos)', 'text'],
  ['codigoTributacaoNacional', 'Tributação nacional (6 dígitos; confirmar no catálogo)', 'text'],
  ['codigoTributacaoMunicipal', 'Tributação municipal (3 dígitos, se exigida)', 'text'],
  ['codigoNbs', 'NBS (9 dígitos, obrigatória com IBS/CBS)', 'text'],
  ['valor', 'Valor do serviço (R$)', 'number'],
  ['percentualTributosSimples', 'Tributos aproximados do Simples (%) — contador', 'number'],
  ['descricao', 'Descrição do serviço', 'text'],
] as const;

export default function NfseHomologacaoNacional({ cnpj }: { cnpj: string }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState('');
  const [cancelarId, setCancelarId] = useState<string | null>(null);

  function idDps() {
    if (!/^\d{7}$/.test(form.municipioEmissao || '') || !/^\d{1,5}$/.test(form.serie || '') || !/^[1-9]\d{0,14}$/.test(form.numero || '')) {
      throw new Error('Informe município de emissão, série e número da DPS para localizar o teste.');
    }
    return `DPS${form.municipioEmissao}2${cnpj.replace(/\D/g, '')}${form.serie.padStart(5, '0')}${form.numero.padStart(15, '0')}`;
  }

  async function testar(enviar: boolean) {
    if (enviar && !window.confirm('Enviar uma DPS à produção restrita nacional? É um teste sem validade fiscal. Não reenvie uma operação de resultado incerto.')) return;
    setBusy(true); setErro(''); setResultado('');
    try {
      const response = await holdingAuthFetch('/api/notas-fiscais/homologacao-nacional', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          valor: form.valor === undefined || form.valor === '' ? null : Number(form.valor),
          percentualTributosSimples: form.percentualTributosSimples === undefined || form.percentualTributosSimples === '' ? null : Number(form.percentualTributosSimples),
          regimeConfirmado: confirmado, confirmarHomologacao: enviar,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Falha no teste nacional.');
      setResultado(json.xml || JSON.stringify(json, null, 2));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha no teste nacional.');
    } finally {
      setBusy(false);
    }
  }

  async function consultarSalvo() {
    setBusy(true); setErro(''); setResultado('');
    try {
      const id = idDps();
      const response = await holdingAuthFetch(`/api/notas-fiscais/homologacao-nacional?id=${id}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Falha ao recuperar teste.');
      setResultado(JSON.stringify(json, null, 2));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao recuperar teste.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-3xl border border-sky-200 bg-white p-6 space-y-4">
    <h2 className="font-bold text-slate-800">Emissor Nacional — homologação da holding</h2>
    <p className="text-sm text-slate-600">
      Preparação para 01/11/2026. Não altera a emissão IPM nem ativa produção.
      Este teste cobre somente ME/EPP no Simples, tributos no regime único, sem regime especial, serviço tributável sem retenção em 2026.
      Confirme parâmetros municipais, código de serviço, NBS e percentual com o contador.
    </p>
    <a className="text-sm text-sky-700 underline" href="https://www.producaorestrita.nfse.gov.br/EmissorNacional" target="_blank" rel="noopener noreferrer">Abrir ambiente oficial de testes</a>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {campos.map(([nome, label, tipo]) => <label key={nome} className="text-xs font-semibold text-slate-600">
        {label}
        <input type={tipo} step={tipo === 'number' ? '0.01' : undefined} value={form[nome] || ''}
          onChange={e => setForm(p => ({ ...p, [nome]: e.target.value }))}
          className="mt-1 block w-full rounded-lg border border-slate-300 p-3 text-sm" />
      </label>)}
    </div>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} className="mt-1" />
      Confirmei com o contador o regime ME/EPP, ISS no Simples, sem regime especial e operação tributável sem retenção.
    </label>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy || !confirmado} onClick={() => testar(false)} className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-50">Pré-visualizar DPS (não envia)</button>
      <button type="button" disabled={busy || !confirmado} onClick={() => testar(true)} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Enviar teste nacional</button>
      <button type="button" disabled={busy} onClick={consultarSalvo} className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-50">Consultar resultado salvo</button>
      <button type="button" disabled={busy} onClick={() => {
        try { setErro(''); setCancelarId(idDps()); } catch (err) { setErro(err instanceof Error ? err.message : 'Dados inválidos.'); }
      }} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50">Cancelar teste autorizado</button>
    </div>
    {busy && <p className="text-sm">Processando…</p>}
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {cancelarId && <CancelarNfseModal
      titulo={`teste ${cancelarId}`}
      endpoint={`/api/notas-fiscais/homologacao-nacional/cancelar?id=${cancelarId}`}
      emitidaEm={null} nacional
      onClose={() => setCancelarId(null)}
      onCancelada={() => { setCancelarId(null); setResultado('Teste cancelado no Emissor Nacional (produção restrita). Use "Consultar resultado salvo" para ver o evento.'); }}
    />}
    {resultado && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-4 text-xs">{resultado}</pre>}
  </section>;
}
