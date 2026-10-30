import { supabaseServer } from '@/lib/supabase-server';
import { getAsaasClient, todayBrt } from '@/lib/glass-tenant-billing';
import { fetchInterTransactions } from '@/lib/inter-statement';

export const UNCLASSIFIED_CATEGORY = 'A classificar';

type BankAccountRow = {
  id: string;
  name: string;
  provider: string | null;
  sync_enabled: boolean;
  sync_start_date: string | null;
};

type NormalizedTx = {
  externalId: string;
  date: string;
  amount: number;
  type: string;
  description: string;
  counterparty: string | null;
  referenceId: string | null;
  balanceAfter: number | null;
  raw: unknown;
};

type Rule = {
  id: string;
  pattern: string;
  record_type: 'revenue' | 'expense';
  category_id: string | null;
  category_name: string;
  bank_account_id: string | null;
  hits: number;
};

type CategoryRow = { id: string; name: string; type: string; parent_id: string | null };

export type AccountSyncResult = {
  accountId: string;
  account: string;
  provider: string;
  imported: number;
  reconciled: number;
  autoClassified: number;
  pendingSettlement: number;
  providerBalance: number | null;
  skipped?: string;
  error?: string;
};

const SAFE_ID = /^[A-Za-z0-9_\-:.]{1,120}$/;

export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sugestão de padrão para regra: favorecido, ou o trecho da descrição antes do " - ". */
export function suggestRulePattern(description: string, counterparty?: string | null) {
  if (counterparty && counterparty.trim().length >= 3) return counterparty.trim().slice(0, 80);
  return String(description || '').split(' - ')[0].trim().slice(0, 80);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function matchRule(rules: Rule[], accountId: string, recordType: 'revenue' | 'expense', text: string) {
  const haystack = normalizeText(text);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (rule.record_type !== recordType) continue;
    if (rule.bank_account_id && rule.bank_account_id !== accountId) continue;
    const needle = normalizeText(rule.pattern);
    if (!needle || !haystack.includes(needle)) continue;
    if (!best || needle.length > normalizeText(best.pattern).length) best = rule;
  }
  return best;
}

export function categoryMetadata(category: CategoryRow | null, categories: CategoryRow[]) {
  if (!category) return {};
  const parent = category.parent_id ? categories.find((c) => c.id === category.parent_id) || null : null;
  return {
    category_parent_id: parent ? parent.id : category.id,
    category_parent_name: parent ? parent.name : category.name,
    category_subcategory_id: parent ? category.id : null,
    category_subcategory_name: parent ? category.name : null,
  };
}

async function fetchAsaasTransactions(startDate: string, finishDate: string) {
  const asaas = await getAsaasClient();
  if (!asaas) throw new Error('Chave da API do Asaas não configurada.');
  const out: NormalizedTx[] = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const { data, hasMore } = await asaas.listFinancialTransactions({ startDate, finishDate, offset, limit: 100 });
    for (const t of data) {
      out.push({
        externalId: t.id,
        date: t.date,
        amount: Math.round(Number(t.value) * 100) / 100,
        type: t.type,
        description: String(t.description || t.type),
        counterparty: null,
        referenceId: t.paymentId || t.transferId || null,
        balanceAfter: Number.isFinite(Number(t.balance)) ? Number(t.balance) : null,
        raw: t,
      });
    }
    if (!hasMore || data.length === 0) break;
    offset += data.length;
  }
  let balance: number | null = null;
  try {
    const value = await asaas.getBalance();
    balance = Number.isFinite(value) ? value : null;
  } catch {
    balance = null;
  }
  return { transactions: out, balance };
}

/** Procura o lançamento já criado pelo webhook (mensalidade/excedente/avulsa) para não duplicar. */
async function findReconcilableRecord(tx: NormalizedTx, provider: string) {
  if (provider !== 'asaas' || tx.amount <= 0 || !tx.referenceId || !SAFE_ID.test(tx.referenceId)) return null;
  if (!tx.referenceId.startsWith('pay_')) return null;
  const { data } = await supabaseServer
    .from('system_finance_records')
    .select('id, status, metadata, bank_account_id')
    .eq('type', 'revenue')
    .or(`metadata->>asaas_payment_id.eq.${tx.referenceId},metadata->>id.eq.${tx.referenceId}`)
    .limit(1);
  return data?.[0] || null;
}

async function syncAccount(account: BankAccountRow, rules: Rule[], categories: CategoryRow[]): Promise<AccountSyncResult> {
  const provider = String(account.provider || '');
  const result: AccountSyncResult = {
    accountId: account.id, account: account.name, provider,
    imported: 0, reconciled: 0, autoClassified: 0, pendingSettlement: 0, providerBalance: null,
  };

  if (provider !== 'asaas' && provider !== 'inter') {
    result.skipped = 'Extrato deste banco ainda não habilitado.';
    return result;
  }

  // Trava por conta: evita que o cron e o botão "Sincronizar" importem ao mesmo tempo.
  const nowIso = new Date().toISOString();
  const { data: locked } = await supabaseServer
    .from('system_bank_accounts')
    .update({ sync_lock_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
    .eq('id', account.id)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${nowIso}`)
    .select('id');
  if (!locked?.length) {
    result.skipped = 'Sincronização já em andamento.';
    return result;
  }

  try {
    const startFloor = account.sync_start_date || todayBrt();
    const { data: lastTx } = await supabaseServer
      .from('system_bank_transactions')
      .select('tx_date')
      .eq('bank_account_id', account.id)
      .order('tx_date', { ascending: false })
      .limit(1);
    const lastDate = lastTx?.[0]?.tx_date as string | undefined;
    const lookback = lastDate ? addDays(lastDate, -3) : startFloor;
    const startDate = lookback < startFloor ? startFloor : lookback;
    const finishDate = todayBrt();

    const { transactions, balance } = provider === 'inter'
      ? await fetchInterTransactions(startDate, finishDate)
      : await fetchAsaasTransactions(startDate, finishDate);
    result.providerBalance = balance;

    const { data: existing } = await supabaseServer
      .from('system_bank_transactions')
      .select('external_id')
      .eq('bank_account_id', account.id)
      .gte('tx_date', startDate);
    const known = new Set((existing || []).map((row) => String(row.external_id)));

    for (const tx of transactions) {
      if (known.has(tx.externalId) || tx.amount === 0) continue;

      const { data: inserted, error: insertError } = await supabaseServer
        .from('system_bank_transactions')
        .upsert({
          bank_account_id: account.id,
          provider,
          external_id: tx.externalId,
          tx_date: tx.date,
          amount: tx.amount,
          tx_type: tx.type,
          description: tx.description,
          counterparty: tx.counterparty,
          reference_id: tx.referenceId,
          balance_after: tx.balanceAfter,
          raw: tx.raw,
        }, { onConflict: 'bank_account_id,external_id', ignoreDuplicates: true })
        .select('id');
      if (insertError) throw new Error(insertError.message);
      const txId = inserted?.[0]?.id as string | undefined;
      if (!txId) continue;
      result.imported++;

      const match = await findReconcilableRecord(tx, provider);
      if (match) {
        const metadata = (match.metadata && typeof match.metadata === 'object') ? match.metadata as Record<string, unknown> : {};
        await supabaseServer
          .from('system_finance_records')
          .update({
            bank_account_id: match.bank_account_id || account.id,
            metadata: { ...metadata, bank_tx_id: txId, bank_confirmed_at: tx.date },
          })
          .eq('id', match.id);
        const status = match.status === 'paid' ? 'conciliado' : 'pendente_baixa';
        await supabaseServer.from('system_bank_transactions')
          .update({ finance_record_id: match.id, status, updated_at: new Date().toISOString() })
          .eq('id', txId);
        if (status === 'conciliado') result.reconciled++; else result.pendingSettlement++;
        continue;
      }

      const recordType: 'revenue' | 'expense' = tx.amount > 0 ? 'revenue' : 'expense';
      const rule = matchRule(rules, account.id, recordType, `${tx.description} ${tx.counterparty || ''}`);
      const category = rule?.category_id ? categories.find((c) => c.id === rule.category_id) || null : null;

      const { data: record, error: recordError } = await supabaseServer
        .from('system_finance_records')
        .insert({
          type: recordType,
          value: Math.abs(tx.amount),
          description: tx.description.slice(0, 300),
          payment_method: 'Transferencia',
          bank_account_id: account.id,
          category: rule ? rule.category_name : UNCLASSIFIED_CATEGORY,
          status: 'paid',
          created_at: `${tx.date}T12:00:00-03:00`,
          metadata: {
            source: 'bank_import',
            provider,
            bank_tx_id: txId,
            external_id: tx.externalId,
            bank_tx_type: tx.type,
            counterparty: tx.counterparty,
            reference_id: tx.referenceId,
            needs_classification: !rule,
            ...(rule ? { classified_by_rule: rule.id, ...categoryMetadata(category, categories) } : {}),
          },
        })
        .select('id')
        .single();
      if (recordError || !record) throw new Error(recordError?.message || 'Falha ao criar lançamento.');

      await supabaseServer.from('system_bank_transactions')
        .update({ finance_record_id: record.id, status: rule ? 'classificado' : 'a_classificar', updated_at: new Date().toISOString() })
        .eq('id', txId);

      if (rule) {
        result.autoClassified++;
        rule.hits += 1;
        await supabaseServer.from('system_bank_classification_rules').update({ hits: rule.hits }).eq('id', rule.id);
      }
    }

    await supabaseServer.from('system_bank_accounts').update({
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      provider_balance: balance,
      provider_balance_at: balance === null ? null : new Date().toISOString(),
      sync_lock_until: null,
    }).eq('id', account.id);
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Falha ao sincronizar.';
    await supabaseServer.from('system_bank_accounts')
      .update({ last_sync_error: result.error.slice(0, 500), sync_lock_until: null })
      .eq('id', account.id);
  }

  return result;
}

export async function syncBankAccounts(options: { accountId?: string } = {}) {
  let query = supabaseServer
    .from('system_bank_accounts')
    .select('id, name, provider, sync_enabled, sync_start_date')
    .eq('sync_enabled', true)
    .not('provider', 'is', null);
  if (options.accountId) query = query.eq('id', options.accountId);
  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);
  if (!accounts?.length) return [];

  const [{ data: rules }, { data: categories }] = await Promise.all([
    supabaseServer.from('system_bank_classification_rules').select('id, pattern, record_type, category_id, category_name, bank_account_id, hits'),
    supabaseServer.from('system_finance_categories').select('id, name, type, parent_id'),
  ]);

  const results: AccountSyncResult[] = [];
  for (const account of accounts as BankAccountRow[]) {
    results.push(await syncAccount(account, (rules || []) as Rule[], (categories || []) as CategoryRow[]));
  }
  return results;
}

/**
 * Classifica um lançamento importado. Com createRule, grava a regra e aplica a todos os pendentes
 * semelhantes (mesmo tipo e padrão) que ainda estão "A classificar".
 */
export async function classifyImportedRecord(input: {
  recordId: string;
  categoryId: string;
  createRule?: boolean;
  pattern?: string;
  ruleScopeAccount?: boolean;
  userEmail?: string | null;
}) {
  const { data: categories } = await supabaseServer.from('system_finance_categories').select('id, name, type, parent_id');
  const allCategories = (categories || []) as CategoryRow[];
  const category = allCategories.find((c) => c.id === input.categoryId) || null;
  if (!category) throw new Error('Categoria não encontrada.');

  const { data: record } = await supabaseServer
    .from('system_finance_records')
    .select('id, type, description, metadata, bank_account_id')
    .eq('id', input.recordId)
    .single();
  if (!record) throw new Error('Lançamento não encontrado.');
  if (record.type !== category.type) throw new Error('A categoria escolhida não é do mesmo tipo (receita/despesa) do lançamento.');

  const applyTo = async (target: { id: string; metadata: unknown }, ruleId?: string) => {
    const metadata = (target.metadata && typeof target.metadata === 'object') ? target.metadata as Record<string, unknown> : {};
    await supabaseServer.from('system_finance_records').update({
      category: category.name,
      metadata: {
        ...metadata,
        needs_classification: false,
        classified_at: new Date().toISOString(),
        classified_by: input.userEmail || null,
        ...(ruleId ? { classified_by_rule: ruleId } : {}),
        ...categoryMetadata(category, allCategories),
      },
    }).eq('id', target.id);
    if (metadata.bank_tx_id) {
      await supabaseServer.from('system_bank_transactions')
        .update({ status: 'classificado', updated_at: new Date().toISOString() })
        .eq('id', String(metadata.bank_tx_id));
    }
  };

  await applyTo(record);

  let similarApplied = 0;
  if (input.createRule) {
    const pattern = String(input.pattern || '').trim().slice(0, 80);
    if (normalizeText(pattern).length < 3) throw new Error('O padrão da regra precisa ter pelo menos 3 caracteres.');
    const scopeAccount = input.ruleScopeAccount ? record.bank_account_id || null : null;

    const { data: existingRule } = await supabaseServer
      .from('system_bank_classification_rules')
      .select('id')
      .eq('pattern', pattern)
      .eq('record_type', record.type)
      .is('bank_account_id', scopeAccount)
      .maybeSingle();
    let ruleId = existingRule?.id as string | undefined;
    if (ruleId) {
      await supabaseServer.from('system_bank_classification_rules')
        .update({ category_id: category.id, category_name: category.name })
        .eq('id', ruleId);
    } else {
      const { data: created, error } = await supabaseServer.from('system_bank_classification_rules').insert({
        pattern,
        record_type: record.type,
        category_id: category.id,
        category_name: category.name,
        bank_account_id: scopeAccount,
        created_by: input.userEmail || null,
      }).select('id').single();
      if (error) throw new Error(error.message);
      ruleId = created.id;
    }

    const { data: pending } = await supabaseServer
      .from('system_finance_records')
      .select('id, description, metadata, bank_account_id')
      .eq('type', record.type)
      .eq('metadata->>needs_classification', 'true')
      .neq('id', record.id)
      .limit(500);
    const needle = normalizeText(pattern);
    for (const item of pending || []) {
      if (scopeAccount && item.bank_account_id !== scopeAccount) continue;
      const meta = (item.metadata && typeof item.metadata === 'object') ? item.metadata as Record<string, unknown> : {};
      const text = normalizeText(`${item.description || ''} ${String(meta.counterparty || '')}`);
      if (!text.includes(needle)) continue;
      await applyTo(item, ruleId);
      similarApplied++;
    }
    if (similarApplied > 0) {
      const { data: rule } = await supabaseServer.from('system_bank_classification_rules').select('hits').eq('id', ruleId).single();
      await supabaseServer.from('system_bank_classification_rules')
        .update({ hits: Number(rule?.hits || 0) + similarApplied })
        .eq('id', ruleId);
    }
  }

  return { similarApplied };
}
