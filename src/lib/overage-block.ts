import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, 'public', any, any, any>;

type OverageMetadata = {
  tenant_id?: unknown;
  ref_month?: unknown;
  due_date?: unknown;
  values?: Record<string, unknown> | null;
};

const amount = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

/** O que a cobrança de excedente bloqueia se vencer sem pagamento: só os módulos que foram cobrados. */
export function overageBlockTargets(metadata: OverageMetadata) {
  const values = metadata?.values || {};
  return {
    whatsapp: amount(values.messages) + amount(values.marketingMessages) + amount(values.whatsappUsers) > 0,
    consultflex: amount(values.consultflexTotal) + amount(values.consultflexBasic) + amount(values.consultflexComplete) > 0,
  };
}

/** Registra no glass a regra de bloqueio de uma cobrança de excedente emitida (boleto gerado). */
export async function registerOverageBlockRule(params: {
  glassSupabase: AnyClient;
  recordId: string;
  metadata: OverageMetadata;
  value: number;
}) {
  const { glassSupabase, recordId, metadata, value } = params;
  const tenantId = String(metadata?.tenant_id || '');
  const dueDate = String(metadata?.due_date || '');
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;

  const targets = overageBlockTargets(metadata);
  const { error } = await glassSupabase.from('billing_bloqueios_excedente').upsert({
    finance_record_id: recordId,
    vidracaria_id: tenantId,
    ref_month: String(metadata?.ref_month || '') || null,
    valor: Number(value.toFixed(2)),
    vencimento: dueDate,
    bloqueia_whatsapp: targets.whatsapp,
    bloqueia_consultflex: targets.consultflex,
  }, { onConflict: 'finance_record_id' });
  if (error) throw new Error(`Falha ao registrar regra de bloqueio: ${error.message}`);
}

/** Baixa (paga ou abonada): libera o bloqueio da cobrança e devolve os módulos removidos. */
export async function releaseOverageBlock(params: {
  glassSupabase: AnyClient;
  recordId: string;
  status: 'paid' | 'cancelled';
}) {
  const { glassSupabase, recordId, status } = params;
  const { data, error } = await glassSupabase.rpc('resolver_bloqueio_excedente', {
    p_finance_record_id: recordId,
    p_status: status,
  });
  if (error) throw new Error(`Falha ao liberar bloqueio: ${error.message}`);
  return Array.isArray(data) ? data.map(String) : [];
}
