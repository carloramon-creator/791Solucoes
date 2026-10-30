import { supabaseServer } from '@/lib/supabase-server';
import { getAsaasClient, todayBrt } from '@/lib/glass-tenant-billing';
import { fetchInterTransactions } from '@/lib/inter-statement';

export const UNCLASSIFIED_CATEGORY = 'A classificar';

type BankAccountRow = {
  id: string;
  name: string;
  provider: string | null;
  account_number: string | null;
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
  pendingReview: number;
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

function ruleSnapshot(rule: Rule | null) {
  if (!rule) return null;
  return {
    id: rule.id,
    pattern: rule.pattern,
    record_type: rule.record_type,
    category_id: rule.category_id,
    category_name: rule.category_name,
    bank_account_id: rule.bank_account_id,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function importInterTransactions(
  account: BankAccountRow,
  transactions: NormalizedTx[],
  rules: Rule[],
  result: AccountSyncResult,
) {
  const batchSize = 200;
  for (let offset = 0; offset < transactions.length; offset += batchSize) {
    const batch = transactions.slice(offset, offset + batchSize).map((tx) => ({
      external_id: tx.externalId,
      tx_date: tx.date,
      amount: tx.amount,
      tx_type: tx.type,
      description: tx.description,
      counterparty: tx.counterparty,
      reference_id: tx.referenceId,
      balance_after: tx.balanceAfter,
      raw: tx.raw,
      rule: ruleSnapshot(matchRule(
        rules, account.id, tx.amount > 0 ? 'revenue' : 'expense', `${tx.description} ${tx.counterparty || ''}`,
      )),
    }));
    const { data, error } = await supabaseServer.rpc('bank_inter_import_batch', {
      p_account_id: account.id,
      p_transactions: batch,
    });
    if (error) throw new Error(error.message);
    if (!isObject(data) || !isObject(data.rule_counts)) {
      throw new Error('O banco retornou um resultado inválido para o lote do Inter.');
    }
    const { imported, pending_review: pendingReview, auto_classified: autoClassified, existing, rule_counts: ruleCounts } = data;
    if (![imported, pendingReview, autoClassified, existing].every(
      (count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
    )) {
      throw new Error('O banco retornou contagens inválidas para o lote do Inter.');
    }
    if (typeof imported !== 'number' || typeof pendingReview !== 'number' ||
        typeof autoClassified !== 'number' || typeof existing !== 'number' ||
        imported + pendingReview + existing !== batch.length || autoClassified > imported) {
      throw new Error('O banco retornou contagens inconsistentes para o lote do Inter.');
    }
    let ruleTotal = 0;
    for (const [id, count] of Object.entries(ruleCounts)) {
      const rule = rules.find((item) => item.id === id);
      if (!rule || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('O banco retornou contagens de regras inválidas para o lote do Inter.');
      }
      rule.hits += count;
      ruleTotal += count;
    }
    if (ruleTotal !== autoClassified) {
      throw new Error('O banco retornou contagens de regras inconsistentes para o lote do Inter.');
    }
    result.imported += imported + pendingReview;
    result.pendingReview += pendingReview;
    result.autoClassified += autoClassified;
  }
}

export class InterReviewError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function resolveInterReview(input: {
  transactionId: string;
  action: 'link' | 'create';
  recordId?: string;
  allowPaid: boolean;
  actorId: string;
}) {
  let rule: ReturnType<typeof ruleSnapshot> = null;
  if (input.action === 'create') {
    const [transactionRes, rulesRes] = await Promise.all([
      supabaseServer.from('system_bank_transactions')
        .select('bank_account_id, amount, description, counterparty')
        .eq('id', input.transactionId)
        .eq('provider', 'inter')
        .eq('status', 'revisao_duplicidade')
        .maybeSingle(),
      supabaseServer.from('system_bank_classification_rules')
        .select('id, pattern, record_type, category_id, category_name, bank_account_id, hits'),
    ]);
    if (transactionRes.error) throw new Error(transactionRes.error.message);
    if (rulesRes.error) throw new Error(rulesRes.error.message);
    if (!transactionRes.data) throw new InterReviewError('A movimentação não está mais disponível para revisão.', 409);
    const tx = transactionRes.data;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount === 0) throw new Error('A movimentação possui valor inválido.');
    rule = ruleSnapshot(matchRule(
      (rulesRes.data || []) as Rule[],
      String(tx.bank_account_id),
      amount > 0 ? 'revenue' : 'expense',
      `${tx.description || ''} ${tx.counterparty || ''}`,
    ));
  }

  const { data, error } = await supabaseServer.rpc('bank_inter_resolve_review', {
    p_transaction_id: input.transactionId,
    p_action: input.action,
    p_record_id: input.recordId || null,
    p_expected_rule: rule,
    p_allow_paid: input.allowPaid,
    p_actor: input.actorId,
  });
  if (error) {
    if (error.code === '42501') throw new InterReviewError(error.message, 403);
    if (error.code === 'P0001') throw new InterReviewError(error.message, 409);
    throw new Error(error.message);
  }
  if (!isObject(data) || data.action !== input.action || typeof data.auto_classified !== 'boolean') {
    throw new Error('O banco retornou um resultado inválido para a conciliação.');
  }
  return { action: input.action, autoClassified: data.auto_classified };
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
    imported: 0, reconciled: 0, autoClassified: 0, pendingSettlement: 0, pendingReview: 0, providerBalance: null,
  };

  if (provider !== 'asaas' && provider !== 'inter') {
    result.skipped = 'Extrato deste banco ainda não habilitado.';
    return result;
  }
  if (provider === 'inter' && process.env.BANK_INTER_IMPORT_ENABLED !== 'true') {
    result.skipped = 'Importação do Inter bloqueada até a validação com o banco.';
    return result;
  }

  // Trava por conta: evita que o cron e o botão "Sincronizar" importem ao mesmo tempo.
  const nowIso = new Date().toISOString();
  const { data: locked, error: lockError } = await supabaseServer
    .from('system_bank_accounts')
    .update({ sync_lock_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
    .eq('id', account.id)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${nowIso}`)
    .select('id');
  if (lockError) {
    result.error = `Falha ao iniciar sincronização: ${lockError.message}`;
    return result;
  }
  if (!locked?.length) {
    result.skipped = 'Sincronização já em andamento.';
    return result;
  }

  try {
    const startFloor = account.sync_start_date || todayBrt();
    const { data: lastTx, error: lastTxError } = await supabaseServer
      .from('system_bank_transactions')
      .select('tx_date')
      .eq('bank_account_id', account.id)
      .order('tx_date', { ascending: false })
      .limit(1);
    if (provider === 'inter' && lastTxError) throw new Error(lastTxError.message);
    const lastDate = lastTx?.[0]?.tx_date as string | undefined;
    const lookback = lastDate ? addDays(lastDate, -3) : startFloor;
    const startDate = lookback < startFloor ? startFloor : lookback;
    const finishDate = todayBrt();

    const { transactions, balance } = provider === 'inter'
      ? await fetchInterTransactions(startDate, finishDate, account.account_number)
      : await fetchAsaasTransactions(startDate, finishDate);
    result.providerBalance = balance;

    if (provider === 'inter') {
      await importInterTransactions(account, transactions, rules, result);
    } else {
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
    }

    const { error: completionError } = await supabaseServer.from('system_bank_accounts').update({
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      provider_balance: balance,
      provider_balance_at: balance === null ? null : new Date().toISOString(),
      sync_lock_until: null,
    }).eq('id', account.id);
    if (provider === 'inter' && completionError) throw new Error(completionError.message);
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Falha ao sincronizar.';
    const { error: unlockError } = await supabaseServer.from('system_bank_accounts')
      .update({ last_sync_error: result.error.slice(0, 500), sync_lock_until: null })
      .eq('id', account.id);
    if (unlockError) {
      console.error('[BANK SYNC] Falha ao liberar a trava:', unlockError.message);
      result.error += ` Falha ao liberar a trava: ${unlockError.message}`;
    }
  }

  return result;
}

export async function syncBankAccounts(options: { accountId?: string } = {}) {
  let query = supabaseServer
    .from('system_bank_accounts')
    .select('id, name, provider, account_number, sync_enabled, sync_start_date')
    .eq('sync_enabled', true)
    .not('provider', 'is', null);
  if (options.accountId) query = query.eq('id', options.accountId);
  const { data: accounts, error } = await query;
  if (error) throw new Error(error.message);
  if (!accounts?.length) return [];

  const [rulesRes, categoriesRes] = await Promise.all([
    supabaseServer.from('system_bank_classification_rules').select('id, pattern, record_type, category_id, category_name, bank_account_id, hits'),
    supabaseServer.from('system_finance_categories').select('id, name, type, parent_id'),
  ]);
  const lookupError = rulesRes.error || categoriesRes.error;
  if (lookupError) throw new Error(lookupError.message);

  const results: AccountSyncResult[] = [];
  for (const account of accounts as BankAccountRow[]) {
    results.push(await syncAccount(account, (rulesRes.data || []) as Rule[], (categoriesRes.data || []) as CategoryRow[]));
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
    const { error: updateError } = await supabaseServer.from('system_finance_records').update({
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
    if (updateError) throw new Error(updateError.message);
    if (metadata.bank_tx_id && metadata.bank_link_provider !== 'inter' && metadata.provider !== 'inter') {
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
