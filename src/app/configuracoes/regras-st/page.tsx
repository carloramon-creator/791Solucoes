"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, Scale, Trash2, X } from 'lucide-react';
import { ConfigTabs } from '@/components/ConfigTabs';
import { createSupabaseBrowser } from '@/lib/supabase-browser';

interface Regra {
  id: string;
  ncm_prefixo: string;
  cest: string | null;
  uf: string;
  sujeito_st: boolean;
  mva_original: number | null;
  fonte_legal: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  verificada: boolean;
  verificada_em: string | null;
  verificada_por: string | null;
  atualizada_por: string | null;
  observacao: string | null;
}

interface Formulario {
  id?: string;
  ncm_prefixo: string;
  cest: string;
  uf: string;
  sujeito_st: '' | 'true' | 'false';
  mva_original: string;
  fonte_legal: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  observacao: string;
}

const hoje = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const somarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const br = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const formatarNcm = (v: string) => (v.length > 4 ? `${v.slice(0, 4)}.${v.slice(4, 6)}${v.length > 6 ? `.${v.slice(6)}` : ''}` : v);
const VAZIO: Formulario = { ncm_prefixo: '', cest: '', uf: '', sujeito_st: '', mva_original: '', fonte_legal: '', vigencia_inicio: hoje(), vigencia_fim: '', observacao: '' };
const input = 'w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3b597b]/20';
const label = 'text-[10px] font-black text-slate-500 uppercase tracking-widest';

const emUso = (r: Regra, dia: string) => r.verificada && r.vigencia_inicio <= dia && (!r.vigencia_fim || r.vigencia_fim >= dia);

function situacao(r: Regra, dia: string) {
  if (r.vigencia_fim && r.vigencia_fim < dia) return { texto: 'Encerrada', cor: 'bg-slate-100 text-slate-500' };
  if (r.vigencia_inicio > dia) return { texto: 'Futura', cor: 'bg-sky-50 text-sky-700' };
  if (!r.verificada) return { texto: 'Não conferida', cor: 'bg-amber-50 text-amber-700' };
  return { texto: 'Em uso', cor: 'bg-emerald-50 text-emerald-700' };
}

export default function RegrasSTPage() {
  const authClient = useMemo(() => createSupabaseBrowser(), []);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [tenantsPorUf, setTenantsPorUf] = useState<Record<string, number>>({});
  const [ufs, setUfs] = useState<string[]>([]);
  const [filtroUf, setFiltroUf] = useState('');
  const [verEncerradas, setVerEncerradas] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState<Formulario | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const dia = hoje();

  const chamar = useCallback(async (metodo: string, corpo?: unknown, query = '') => {
    const { data } = await authClient.auth.getSession();
    const res = await fetch(`/api/admin/fiscal/regras-st${query}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Falha na operação.');
    return json;
  }, [authClient]);

  const carregar = useCallback(async () => {
    try {
      const json = await chamar('GET');
      setRegras(json.regras || []);
      setTenantsPorUf(json.tenantsPorUf || {});
      setUfs(json.ufs || []);
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }, [chamar]);

  useEffect(() => {
    void (async () => { await carregar(); })();
  }, [carregar]);

  const alertas = useMemo(() => {
    const lista: string[] = [];
    const limite = somarDias(dia, 60);
    for (const r of regras) {
      if (r.vigencia_fim && r.vigencia_fim >= dia && r.vigencia_fim <= limite) {
        lista.push(`${r.uf} · NCM ${formatarNcm(r.ncm_prefixo)}: vigência termina em ${br(r.vigencia_fim)}.`);
      }
    }
    for (const [uf, qtd] of Object.entries(tenantsPorUf)) {
      if (!regras.some((r) => r.uf === uf && emUso(r, dia))) {
        lista.push(`${uf}: ${qtd} vidraçaria(s) ativa(s) e nenhuma regra em uso. Nelas a ST depende do XML de compra ou do cadastro manual.`);
      }
    }
    return lista;
  }, [regras, tenantsPorUf, dia]);

  const visiveis = regras.filter((r) => (!filtroUf || r.uf === filtroUf) && (verEncerradas || !r.vigencia_fim || r.vigencia_fim >= dia));

  const abrirEdicao = (r: Regra) => {
    setErroForm('');
    setForm({
      id: r.id, ncm_prefixo: r.ncm_prefixo, cest: r.cest || '', uf: r.uf, sujeito_st: r.sujeito_st ? 'true' : 'false',
      mva_original: r.mva_original == null ? '' : String(r.mva_original), fonte_legal: r.fonte_legal,
      vigencia_inicio: r.vigencia_inicio, vigencia_fim: r.vigencia_fim || '', observacao: r.observacao || '',
    });
  };

  const salvar = async () => {
    if (!form) return;
    setSalvando(true);
    setErroForm('');
    const corpo = { ...form, sujeito_st: form.sujeito_st === '' ? null : form.sujeito_st === 'true', vigencia_fim: form.vigencia_fim || null };
    try {
      if (form.id) await chamar('PUT', { ...corpo, acao: 'editar' });
      else await chamar('POST', corpo);
      setForm(null);
      await carregar();
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const acao = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await carregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha na operação.');
    }
  };

  const verificar = (r: Regra) => {
    if (!confirm(`Confirmar que a regra ${r.uf} · NCM ${formatarNcm(r.ncm_prefixo)} foi conferida na fonte legal?\n\nA partir de agora ela passa a decidir a ST nas NF-e das vidraçarias de ${r.uf}.`)) return;
    void acao(() => chamar('PUT', { id: r.id, acao: 'verificar' }));
  };
  const desverificar = (r: Regra) => {
    if (!confirm('Retirar a conferência? A regra deixa de ser usada nas notas.')) return;
    void acao(() => chamar('PUT', { id: r.id, acao: 'desverificar' }));
  };
  const encerrar = (r: Regra) => {
    const fim = prompt('Último dia de vigência (AAAA-MM-DD):', dia);
    if (!fim) return;
    void acao(() => chamar('PUT', { id: r.id, acao: 'encerrar', vigencia_fim: fim }));
  };
  const apagar = (r: Regra) => {
    if (!confirm('Apagar esta regra não conferida?')) return;
    void acao(() => chamar('DELETE', undefined, `?id=${encodeURIComponent(r.id)}`));
  };

  const set = (campo: keyof Formulario, valor: string) => setForm((f) => (f ? { ...f, [campo]: valor } : f));

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 animate-in fade-in duration-500 pb-20">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight uppercase flex items-center gap-2">
          <Scale className="text-[#3b597b]" size={24} />
          Regras de Substituição Tributária (791glass)
        </h1>
        <p className="text-sm text-slate-500 mt-1 uppercase tracking-wider">
          Regras globais NCM × UF usadas na emissão de NF-e de todas as vidraçarias.
        </p>
      </div>

      <ConfigTabs />

      <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4 text-xs text-sky-900 space-y-1">
        <p><b>Como funciona:</b> a regra só entra em uso depois de <b>conferida</b>, dentro da vigência. Qualquer edição volta a regra para &quot;não conferida&quot;.</p>
        <p>Mudou a lei? <b>Encerre</b> a regra antiga e cadastre uma nova; as notas antigas continuam corretas. Prefixos de NCM valem para todos os NCMs que começam com eles (ex.: 7007 cobre 7007.19.00); o prefixo mais específico prevalece.</p>
      </div>

      {alertas.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-2"><AlertTriangle size={14} /> Atenção</div>
          {alertas.map((a) => <div key={a} className="text-xs text-amber-900">• {a}</div>)}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className={label}>Cobertura por UF (vidraçarias ativas · regras em uso)</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ufs.map((uf) => {
            const t = tenantsPorUf[uf] || 0;
            const r = regras.filter((x) => x.uf === uf && emUso(x, dia)).length;
            const cor = r > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : t > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-100 bg-slate-50 text-slate-400';
            return (
              <button key={uf} type="button" onClick={() => setFiltroUf(filtroUf === uf ? '' : uf)}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${cor} ${filtroUf === uf ? 'ring-2 ring-[#3b597b]' : ''}`}>
                {uf} <span className="font-normal">{t}·{r}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select className={`${input} w-40`} value={filtroUf} onChange={(e) => setFiltroUf(e.target.value)}>
            <option value="">Todas as UFs</option>
            {ufs.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={verEncerradas} onChange={(e) => setVerEncerradas(e.target.checked)} /> Mostrar encerradas
          </label>
        </div>
        <button type="button" onClick={() => { setErroForm(''); setForm({ ...VAZIO, uf: filtroUf }); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#3b597b] text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md">
          <Plus size={14} /> Nova regra
        </button>
      </div>

      {erro && <div className="text-sm text-red-600">{erro}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        {carregando ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">Nenhuma regra cadastrada{filtroUf ? ` para ${filtroUf}` : ''}.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left p-3">UF</th>
                <th className="text-left p-3">NCM</th>
                <th className="text-left p-3">ST</th>
                <th className="text-left p-3">MVA</th>
                <th className="text-left p-3">Vigência</th>
                <th className="text-left p-3">Fonte legal</th>
                <th className="text-left p-3">Situação</th>
                <th className="text-right p-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r) => {
                const s = situacao(r, dia);
                const encerrada = !!r.vigencia_fim && r.vigencia_fim < dia;
                return (
                  <tr key={r.id} className="border-t border-slate-50 align-top">
                    <td className="p-3 font-bold">{r.uf}</td>
                    <td className="p-3">{formatarNcm(r.ncm_prefixo)}{r.cest && <div className="text-slate-400">CEST {r.cest}</div>}</td>
                    <td className="p-3">{r.sujeito_st ? <b className="text-red-700">Com ST</b> : <span className="text-slate-600">Sem ST</span>}</td>
                    <td className="p-3">{r.mva_original != null ? `${r.mva_original}%` : '—'}</td>
                    <td className="p-3 whitespace-nowrap">{br(r.vigencia_inicio)} → {r.vigencia_fim ? br(r.vigencia_fim) : 'em aberto'}</td>
                    <td className="p-3 max-w-[260px]">{r.fonte_legal}{r.observacao && <div className="text-slate-400 mt-1">{r.observacao}</div>}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${s.cor}`}>{s.texto}</span>
                      {r.verificada && <div className="text-[10px] text-slate-400 mt-1">por {r.verificada_por || '—'} em {br(r.verificada_em)}</div>}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1 flex-wrap">
                        {!encerrada && !r.verificada && (
                          <button onClick={() => verificar(r)} className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold flex items-center gap-1"><CheckCircle2 size={12} /> Conferir</button>
                        )}
                        {!encerrada && r.verificada && (
                          <button onClick={() => desverificar(r)} className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-bold">Retirar conferência</button>
                        )}
                        {!encerrada && (
                          <button onClick={() => abrirEdicao(r)} title="Editar" className="p-1.5 rounded-lg border border-slate-200"><Pencil size={12} /></button>
                        )}
                        {!encerrada && !r.vigencia_fim && (
                          <button onClick={() => encerrar(r)} className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-bold">Encerrar</button>
                        )}
                        {!r.verificada && (
                          <button onClick={() => apagar(r)} title="Apagar" className="p-1.5 rounded-lg border border-red-100 text-red-600"><Trash2 size={12} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-700">{form.id ? 'Editar regra' : 'Nova regra de ST'}</h2>
              <button onClick={() => setForm(null)}><X size={18} /></button>
            </div>
            {form.id && <div className="text-[11px] text-amber-700">Ao salvar, a regra volta para &quot;não conferida&quot; e deixa de ser usada até nova conferência.</div>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className={label}>UF</div>
                <select className={input} value={form.uf} onChange={(e) => set('uf', e.target.value)}>
                  <option value="">Selecione…</option>
                  {ufs.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <div className={label}>NCM ou prefixo</div>
                <input className={input} value={form.ncm_prefixo} onChange={(e) => set('ncm_prefixo', e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="Ex.: 7007 ou 70071900" />
              </div>
              <div className="space-y-1">
                <div className={label}>CEST (opcional)</div>
                <input className={input} value={form.cest} onChange={(e) => set('cest', e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="7 dígitos" />
              </div>
              <div className="space-y-1">
                <div className={label}>Sujeito a ST?</div>
                <select className={input} value={form.sujeito_st} onChange={(e) => set('sujeito_st', e.target.value)}>
                  <option value="">Selecione…</option>
                  <option value="true">Sim — com ST</option>
                  <option value="false">Não — sem ST</option>
                </select>
              </div>
              <div className="space-y-1">
                <div className={label}>MVA original (%)</div>
                <input className={input} inputMode="decimal" value={form.mva_original} onChange={(e) => set('mva_original', e.target.value.replace(/[^0-9.,]/g, ''))} placeholder={form.sujeito_st === 'true' ? 'Obrigatória' : 'Opcional'} />
              </div>
              <div />
              <div className="space-y-1">
                <div className={label}>Início da vigência</div>
                <input type="date" className={input} value={form.vigencia_inicio} onChange={(e) => set('vigencia_inicio', e.target.value)} />
              </div>
              <div className="space-y-1">
                <div className={label}>Fim (opcional)</div>
                <input type="date" className={input} value={form.vigencia_fim} onChange={(e) => set('vigencia_fim', e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <div className={label}>Fonte legal</div>
              <input className={input} value={form.fonte_legal} onChange={(e) => set('fonte_legal', e.target.value)} placeholder="Ex.: RICMS/SC, Anexo 3, Seção XX, item YY (Decreto nº ...)" />
            </div>
            <div className="space-y-1">
              <div className={label}>Observação</div>
              <input className={input} value={form.observacao} onChange={(e) => set('observacao', e.target.value)} placeholder="Opcional" />
            </div>
            {erroForm && <div className="text-sm text-red-600">{erroForm}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setForm(null)} className="px-5 py-2.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase tracking-widest">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="px-5 py-2.5 bg-[#3b597b] text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60">
                {salvando ? 'Salvando…' : 'Salvar (não conferida)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
