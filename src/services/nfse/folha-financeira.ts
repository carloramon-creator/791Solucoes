import type { SupabaseClient } from '@supabase/supabase-js';
import { mesesAnteriores } from './simples-nacional';

function objeto(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function folhaFinanceira(supabase: SupabaseClient, competencia: string, categoriaId: string) {
  const { data: categorias, error } = await supabase.from('system_finance_categories').select('id, parent_id, type, name');
  if (error) throw new Error(`Falha ao ler a classe da folha: ${error.message}`);
  const raiz = categorias?.find(c => c.id === categoriaId);
  if (!raiz || raiz.parent_id || raiz.type !== 'expense') throw new Error('A classe principal da folha não existe ou não é uma despesa.');
  const ids = new Set<string>([categoriaId]);
  for (let tamanho = 0; tamanho !== ids.size;) {
    tamanho = ids.size;
    for (const c of categorias || []) if (ids.has(c.parent_id)) {
      if (c.type !== 'expense') throw new Error('Subclasse da folha com tipo fiscal incompatível.');
      ids.add(c.id);
    }
  }
  const meses = mesesAnteriores(competencia);
  const centavos = Object.fromEntries(meses.map(m => [m, 0]));
  const lancamentos: { id: string; mes: string; valor: number; categoria: string }[] = [];
  const transacoes = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error: readError } = await supabase.from('system_finance_records')
      .select('id, type, status, value, category, metadata').eq('type', 'expense').eq('status', 'paid')
      .order('id', { ascending: true }).range(offset, offset + 499);
    if (readError) throw new Error(`Falha ao ler pagamentos da folha: ${readError.message}`);
    for (const record of data || []) {
      if (record.type !== 'expense' || record.status !== 'paid') continue;
      const meta = objeto(record.metadata);
      const categoria = typeof meta.category_subcategory_id === 'string' ? meta.category_subcategory_id : meta.category_parent_id;
      const porNome = !categoria && categorias?.filter(c => c.name === record.category);
      if (porNome && porNome.length > 1 && porNome.some(c => ids.has(c.id))) throw new Error(`Categoria ambígua no lançamento ${record.id}; selecione a classe/subclasse.`);
      if (!ids.has(String(categoria || (porNome && porNome[0]?.id)))) continue;
      const settlement = objeto(meta.settlement);
      const raw = meta.fator_r_data_pagamento || settlement.settled_at;
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) || !Number.isFinite(Date.parse(raw))
        || (/^\d{4}-\d{2}-\d{2}$/.test(raw) && new Date(raw).toISOString().slice(0, 10) !== raw)) {
        throw new Error(`Informe a data real do pagamento da folha no lançamento ${record.id}.`);
      }
      const partes = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(raw));
      const mes = raw.length === 10 ? raw.slice(0, 7)
        : `${partes.find(p => p.type === 'year')?.value}-${partes.find(p => p.type === 'month')?.value}`;
      if (!Object.hasOwn(centavos, mes)) continue;
      const valor = typeof record.value === 'number' ? record.value : typeof record.value === 'string' && record.value.trim() ? Number(record.value) : NaN;
      if (!Number.isFinite(valor) || valor <= 0 || Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001) throw new Error(`Valor inválido na folha: ${record.id}.`);
      const tx = typeof meta.bank_tx_id === 'string' ? `${meta.provider || meta.bank_link_provider}:${meta.bank_tx_id}` : '';
      if (tx && transacoes.has(tx)) throw new Error(`Pagamento bancário duplicado na folha: ${record.id}. Reconcilie antes de emitir.`);
      if (tx) transacoes.add(tx);
      centavos[mes] += Math.round(valor * 100);
      lancamentos.push({ id: record.id, mes, valor, categoria: String(categoria || (porNome && porNome[0]?.id)) });
    }
    if (!data || data.length < 500) break;
  }
  return { categoriaId, categoriaNome: raiz.name, meses: Object.fromEntries(meses.map(m => [m, centavos[m] / 100])), lancamentos };
}
