"use client";

import { useEffect, useId, useState } from 'react';
import { holdingAuthFetch } from '@/lib/holding-auth-fetch';
import type { ConfigNacional } from '@/services/nfse/emissao-nacional';
import { mesesAnteriores } from '@/services/nfse/simples-nacional';

type Apuracao = { anexo: string; faixa: number; percentual: number; rbt12: number; fs12: number; fatorR: number };

export default function NfseProducaoNacional() {
  const formId = useId();
  const [config, setConfig] = useState<ConfigNacional | null>(null);
  const [apuracao, setApuracao] = useState<Apuracao | null>(null);
  const [competencia, setCompetencia] = useState('');
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [busy, setBusy] = useState(false);
  function configurar() {
    const meses = mesesAnteriores(competencia);
    setConfig({
      enabled: false, enquadramentoConfirmado: false, serie: '1', municipioEmissao: '',
      codigoTributacaoNacional: '010501', codigoNbs: '111032200',
      historico: { inicioAtividade: '', apuracao: 'competencia', semFolha: false, semReceitasExternas: false,
        receitasExternas: {}, folha: {}, historicoConfirmadoAte: meses[meses.length - 1] },
    });
  }
  useEffect(() => {
    holdingAuthFetch('/api/system/nfse-nacional').then(async response => {
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Falha ao carregar configuração fiscal.');
      setConfig(json.config); setApuracao(json.apuracao); setCompetencia(json.competencia);
      if (json.apuracaoErro) setErro(json.apuracaoErro);
    }).catch(err => setErro(err instanceof Error ? err.message : 'Falha ao carregar configuração fiscal.'));
  }, []);
  async function salvar() {
    setBusy(true); setErro(''); setMensagem('');
    try {
      const response = await holdingAuthFetch('/api/system/nfse-nacional', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Falha ao salvar.');
      setConfig(json.config); setApuracao(json.apuracao); setMensagem('Configuração fiscal nacional salva.');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao salvar.');
    } finally { setBusy(false); }
  }
  const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return <section className="rounded-3xl border border-emerald-200 bg-white p-6 space-y-4">
    <h2 className="font-bold text-slate-800">Emissão nacional de produção — assinaturas</h2>
    <p className="text-sm text-slate-600">Competências desde 01/11/2026 usam o Emissor Nacional, nunca a IPM. Notas antigas continuam no fluxo municipal. Esta configuração cobre licenciamento de software, ME/EPP no Simples, ISS sem retenção, em 2026.</p>
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {!config && !erro && <p className="text-sm">Produção nacional ainda não configurada.
      {competencia && <button type="button" onClick={configurar} className="ml-2 underline">Configurar</button>}
    </p>}
    {config && <>
      <div className="flex items-center gap-2 text-sm font-bold">
        <input id={`${formId}-enabled`} type="checkbox" checked={config.enabled} disabled={!config.enquadramentoConfirmado} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />
        <label htmlFor={`${formId}-enabled`}>Produção nacional habilitada</label>
      </div>
      <p className="text-sm">Serviço: {config.codigoTributacaoNacional} · NBS: {config.codigoNbs} · Série: {config.serie} · Apuração: competência.</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <div><label className="block" htmlFor={`${formId}-inicio`}>Início da atividade</label><input id={`${formId}-inicio`} type="date" className="rounded border p-2" value={config.historico.inicioAtividade} onChange={e => setConfig({ ...config, historico: { ...config.historico, inicioAtividade: e.target.value } })} /></div>
        <div><label className="block" htmlFor={`${formId}-municipio`}>Município IBGE do emissor</label><input id={`${formId}-municipio`} inputMode="numeric" className="rounded border p-2" value={config.municipioEmissao} onChange={e => setConfig({ ...config, municipioEmissao: e.target.value })} /></div>
        <div><label className="block" htmlFor={`${formId}-serie`}>Série</label><input id={`${formId}-serie`} inputMode="numeric" className="rounded border p-2" value={config.serie} onChange={e => setConfig({ ...config, serie: e.target.value })} /></div>
      </div>
      {apuracao && <div className="rounded-xl bg-emerald-50 p-4 text-sm space-y-1">
        <p className="font-bold">Última simulação carregada/salva · {competencia} · Anexo {apuracao.anexo}, faixa {apuracao.faixa} · {apuracao.percentual}%</p>
        <p>Não é recalculada enquanto você edita. Não ativar sem confirmar o enquadramento.</p>
        <p>RBT12: {moeda(apuracao.rbt12)} · Folha/encargos pagos: {moeda(apuracao.fs12)} · Fator R: {(apuracao.fatorR * 100).toFixed(2)}%</p>
      </div>}
      <div className="flex items-start gap-2 text-sm">
        <input id={`${formId}-enquadramento`} type="checkbox" checked={config.enquadramentoConfirmado} onChange={e => setConfig({ ...config, enquadramentoConfirmado: e.target.checked, enabled: e.target.checked ? config.enabled : false })} />
        <label htmlFor={`${formId}-enquadramento`}>
        Confirmei que o licenciamento está sujeito ao fator R e que os dados de receita e folha estão corretos. Não marcar se houver divergência com o enquadramento do contador.
        </label>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input id={`${formId}-folha`} type="checkbox" checked={config.historico.semFolha} onChange={e => setConfig({ ...config, historico: { ...config.historico, semFolha: e.target.checked } })} />
        <label htmlFor={`${formId}-folha`}>
        Não há folha, pró-labore nem encargos pagos. Atualizar antes de emitir se isso mudar.
        </label>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <input id={`${formId}-externas`} type="checkbox" checked={!!config.historico.semReceitasExternas} onChange={e => setConfig({ ...config, historico: { ...config.historico, semReceitasExternas: e.target.checked } })} />
        <label htmlFor={`${formId}-externas`}>
        Todas as receitas de clientes estão nas notas deste sistema, sem receitas externas. Atualizar se isso mudar. Com esta declaração e sem folha, o histórico avança automaticamente a cada mês.
        </label>
      </div>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-bold">Histórico mensal — receitas externas e folha</summary>
        <p className="my-3 text-xs text-slate-600">As notas reais autorizadas no sistema entram automaticamente, sem testes ou canceladas. Informe abaixo somente receitas de clientes fora do sistema; aportes e empréstimos não entram. Se houver receita sem nota ou cancelamento que não extinguiu a receita, ajuste o histórico. Folha inclui salários, pró-labore e encargos efetivamente pagos conforme as regras do fator R.</p>
        <label className="block text-sm" htmlFor={`${formId}-historico`}>Histórico externo/folha conferido até</label>
        <input id={`${formId}-historico`} type="month" className="rounded border p-2" value={config.historico.historicoConfirmadoAte} onChange={e => setConfig({ ...config, historico: { ...config.historico, historicoConfirmadoAte: e.target.value } })} />
        <div className="grid gap-2">
          {mesesAnteriores(competencia).map(mes => <div key={mes} className="grid grid-cols-3 items-center gap-2 text-sm">
            <span>{mes}</span>
            <input aria-label={`Receita externa ${mes}`} type="number" min="0" step="0.01" disabled={config.historico.semReceitasExternas} className="min-w-0 rounded border p-2 disabled:opacity-50" value={config.historico.semReceitasExternas ? config.historico.receitasExternas[mes] ?? 0 : Number.isFinite(config.historico.receitasExternas[mes]) ? config.historico.receitasExternas[mes] : ''}
              onChange={e => setConfig({ ...config, historico: { ...config.historico, receitasExternas: { ...config.historico.receitasExternas, [mes]: e.target.value === '' ? NaN : Number(e.target.value) } } })} />
            <input aria-label={`Folha paga ${mes}`} type="number" min="0" step="0.01" disabled={config.historico.semFolha} className="min-w-0 rounded border p-2 disabled:opacity-50" value={config.historico.semFolha ? config.historico.folha[mes] ?? 0 : Number.isFinite(config.historico.folha[mes]) ? config.historico.folha[mes] : ''}
              onChange={e => setConfig({ ...config, historico: { ...config.historico, folha: { ...config.historico.folha, [mes]: e.target.value === '' ? NaN : Number(e.target.value) } } })} />
          </div>)}
        </div>
      </details>
      <p className="text-xs text-slate-600">O percentual é informação aproximada na NFS-e, não uma apuração ou envio do DAS/PGDAS-D. O cálculo usa os 12 meses anteriores, sem incluir o mês atual. Não há atualização automática de folhas/receitas externas. Excedentes ConsultFlex e competências de 2027 exigem parametrização própria.</p>
      <button type="button" disabled={busy} onClick={salvar} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar configuração nacional'}</button>
      {mensagem && <p role="status" className="text-sm text-emerald-700">{mensagem}</p>}
    </>}
  </section>;
}
