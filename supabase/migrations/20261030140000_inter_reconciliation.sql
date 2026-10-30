-- Uma movimentação em revisão não cria lançamento nem altera saldo.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

alter table public.system_bank_transactions
  drop constraint if exists system_bank_transactions_status_check;
alter table public.system_bank_transactions
  add constraint system_bank_transactions_status_check
  check (status in (
    'a_classificar', 'classificado', 'conciliado', 'pendente_baixa',
    'ignorado', 'revisao_duplicidade'
  ));

alter table public.system_bank_transactions
  add column if not exists review_reason text,
  add column if not exists review_resolution text,
  add column if not exists review_resolved_by text,
  add column if not exists review_resolved_at timestamptz;

create index if not exists system_finance_records_inter_candidates_idx
  on public.system_finance_records (value, bank_account_id, type)
  where status is distinct from 'cancelled';
create index if not exists system_bank_transactions_finance_record_idx
  on public.system_bank_transactions (finance_record_id)
  where finance_record_id is not null;
create index if not exists system_bank_transactions_inter_review_idx
  on public.system_bank_transactions (tx_date desc, id)
  where provider = 'inter' and status = 'revisao_duplicidade';
create unique index if not exists system_bank_transactions_inter_record_unique
  on public.system_bank_transactions (finance_record_id)
  where provider = 'inter' and finance_record_id is not null;

create or replace function public.bank_inter_find_candidates(
  p_account_id uuid,
  p_amount numeric
)
returns table (
  id uuid,
  status text,
  record_type text,
  value numeric,
  description text,
  created_at timestamptz,
  bank_account_id uuid,
  payment_method text,
  category text,
  bank_id text,
  source text,
  blocked_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.status,
    r.type,
    r.value,
    r.description,
    r.created_at,
    r.bank_account_id,
    r.payment_method,
    r.category,
    r.bank_id,
    r.metadata->>'source',
    case
      when r.status is distinct from 'paid' and r.status is distinct from 'pending'
        then 'status_invalido'
      when r.type is null or r.type not in ('revenue', 'expense')
        then 'tipo_invalido'
      when r.value <= 0
        then 'valor_invalido'
      when r.metadata is not null and jsonb_typeof(r.metadata) <> 'object'
        then 'metadados_invalidos'
      when nullif(r.metadata->>'card_id', '') is not null
        then 'cartao'
      when nullif(r.metadata->>'bank_tx_id', '') is not null
        then 'vinculo_existente'
      else null
    end
  from public.system_finance_records r
  where (r.type = case when p_amount > 0 then 'revenue' else 'expense' end
         or r.type is null or r.type not in ('revenue', 'expense'))
    and r.value in (abs(p_amount), -abs(p_amount))
    and r.status is distinct from 'cancelled'
    and (r.bank_account_id = p_account_id or r.bank_account_id is null)
    and not exists (
      select 1
      from public.system_bank_transactions linked
      where linked.finance_record_id = r.id
    );
$$;

create or replace function public.bank_inter_review_candidates(
  p_transaction_id uuid,
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (
  id uuid,
  status text,
  record_type text,
  value numeric,
  description text,
  created_at timestamptz,
  bank_account_id uuid,
  payment_method text,
  category text,
  bank_id text,
  source text,
  blocked_reason text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, c.status, c.record_type, c.value, c.description, c.created_at,
    c.bank_account_id, c.payment_method, c.category, c.bank_id, c.source, c.blocked_reason,
    count(*) over ()
  from public.system_bank_transactions tx
  cross join lateral public.bank_inter_find_candidates(tx.bank_account_id, tx.amount) c
  where tx.id = p_transaction_id
    and tx.provider = 'inter'
    and tx.status = 'revisao_duplicidade'
  order by
    (c.bank_account_id is null),
    abs((c.created_at at time zone 'America/Sao_Paulo')::date - tx.tx_date) nulls last,
    c.created_at desc nulls last,
    c.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.bank_inter_create_record(
  p_transaction_id uuid,
  p_expected_rule jsonb,
  p_allow_candidates boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.system_bank_transactions%rowtype;
  v_rule public.system_bank_classification_rules%rowtype;
  v_category public.system_finance_categories%rowtype;
  v_parent public.system_finance_categories%rowtype;
  v_metadata jsonb;
  v_record_id uuid;
  v_record_type text;
begin
  select * into v_tx
  from public.system_bank_transactions
  where id = p_transaction_id and provider = 'inter'
  for update;
  if not found or v_tx.status <> 'revisao_duplicidade' or v_tx.finance_record_id is not null then
    raise exception 'A movimentação não está disponível para revisão.';
  end if;

  if p_allow_candidates is distinct from true and exists (
    select 1 from public.bank_inter_find_candidates(v_tx.bank_account_id, v_tx.amount)
  ) then
    raise exception 'A movimentação possui possíveis correspondências e precisa de revisão.';
  end if;

  v_record_type := case when v_tx.amount > 0 then 'revenue' else 'expense' end;
  if p_expected_rule is not null then
    if jsonb_typeof(p_expected_rule) <> 'object' then
      raise exception 'Regra de classificação inválida.';
    end if;
    select * into v_rule
    from public.system_bank_classification_rules
    where id = nullif(p_expected_rule->>'id', '')::uuid
    for share;
    if not found
      or v_rule.pattern is distinct from p_expected_rule->>'pattern'
      or v_rule.record_type is distinct from p_expected_rule->>'record_type'
      or v_rule.category_id is distinct from nullif(p_expected_rule->>'category_id', '')::uuid
      or v_rule.category_name is distinct from p_expected_rule->>'category_name'
      or v_rule.bank_account_id is distinct from nullif(p_expected_rule->>'bank_account_id', '')::uuid
      or v_rule.record_type <> v_record_type
      or (v_rule.bank_account_id is not null and v_rule.bank_account_id <> v_tx.bank_account_id)
    then
      raise exception 'A regra de classificação mudou. Atualize e tente novamente.';
    end if;
  end if;

  v_metadata := jsonb_build_object(
    'source', 'bank_import',
    'provider', 'inter',
    'bank_link_provider', 'inter',
    'bank_tx_id', v_tx.id,
    'external_id', v_tx.external_id,
    'bank_tx_type', v_tx.tx_type,
    'counterparty', v_tx.counterparty,
    'reference_id', v_tx.reference_id,
    'needs_classification', v_rule.id is null
  );
  if v_rule.id is not null then
    v_metadata := v_metadata || jsonb_build_object('classified_by_rule', v_rule.id);
    if v_rule.category_id is not null then
      select * into v_category
      from public.system_finance_categories
      where id = v_rule.category_id;
      if not found then
        raise exception 'A categoria da regra não foi encontrada.';
      end if;
      if v_category.parent_id is not null then
        select * into v_parent
        from public.system_finance_categories
        where id = v_category.parent_id;
      end if;
      v_metadata := v_metadata || jsonb_build_object(
        'category_parent_id', coalesce(v_parent.id, v_category.id),
        'category_parent_name', coalesce(v_parent.name, v_category.name),
        'category_subcategory_id', case when v_parent.id is not null then v_category.id else null end,
        'category_subcategory_name', case when v_parent.id is not null then v_category.name else null end
      );
    end if;
  end if;

  insert into public.system_finance_records (
    type, value, description, payment_method, bank_account_id,
    category, status, created_at, metadata
  ) values (
    v_record_type, abs(v_tx.amount), left(v_tx.description, 300),
    'Transferencia', v_tx.bank_account_id,
    coalesce(v_rule.category_name, 'A classificar'), 'paid',
    (v_tx.tx_date + time '12:00') at time zone 'America/Sao_Paulo',
    v_metadata
  )
  returning id into v_record_id;

  update public.system_bank_transactions
  set finance_record_id = v_record_id,
      status = case when v_rule.id is null then 'a_classificar' else 'classificado' end,
      updated_at = now()
  where id = v_tx.id;

  if v_rule.id is not null then
    update public.system_bank_classification_rules
    set hits = hits + 1
    where id = v_rule.id;
  end if;
  return v_rule.id is not null;
end;
$$;

create or replace function public.bank_inter_import_batch(
  p_account_id uuid,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.system_bank_accounts%rowtype;
  v_item jsonb;
  v_existing public.system_bank_transactions%rowtype;
  v_transaction_id uuid;
  v_external_id text;
  v_date date;
  v_amount numeric;
  v_imported integer := 0;
  v_review integer := 0;
  v_classified integer := 0;
  v_existing_count integer := 0;
  v_rule_counts jsonb := '{}'::jsonb;
  v_rule_id text;
begin
  if p_transactions is null or jsonb_typeof(p_transactions) <> 'array'
    or jsonb_array_length(p_transactions) < 1 or jsonb_array_length(p_transactions) > 200
  then
    raise exception 'Lote de movimentações inválido.';
  end if;

  select * into v_account
  from public.system_bank_accounts
  where id = p_account_id
  for update;
  if not found or v_account.provider is distinct from 'inter' or v_account.sync_enabled is distinct from true then
    raise exception 'A sincronização desta conta Inter não está habilitada.';
  end if;

  for v_item in select value from jsonb_array_elements(p_transactions)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Movimentação inválida no lote.';
    end if;
    v_external_id := btrim(v_item->>'external_id');
    v_date := (v_item->>'tx_date')::date;
    v_amount := (v_item->>'amount')::numeric;
    if v_external_id is null or v_external_id = '' or v_date is null
      or v_amount is null or v_amount = 0 or round(v_amount, 2) <> v_amount
      or v_item->>'description' is null
    then
      raise exception 'Movimentação do Inter incompleta ou inválida.';
    end if;

    select * into v_existing
    from public.system_bank_transactions
    where bank_account_id = p_account_id and external_id = v_external_id;
    if found then
      if v_existing.provider <> 'inter' or v_existing.tx_date <> v_date or v_existing.amount <> v_amount then
        raise exception 'O Inter alterou a data ou o valor de uma movimentação já importada. Confira antes de continuar.';
      end if;
      v_existing_count := v_existing_count + 1;
      continue;
    end if;

    insert into public.system_bank_transactions (
      bank_account_id, provider, external_id, tx_date, amount, tx_type,
      description, counterparty, reference_id, balance_after, raw, status, review_reason
    ) values (
      p_account_id, 'inter', v_external_id, v_date, v_amount, v_item->>'tx_type',
      v_item->>'description', v_item->>'counterparty', v_item->>'reference_id',
      nullif(v_item->>'balance_after', '')::numeric, v_item->'raw',
      'revisao_duplicidade', 'Possível correspondência com lançamento existente.'
    )
    returning id into v_transaction_id;

    if exists (select 1 from public.bank_inter_find_candidates(p_account_id, v_amount)) then
      v_review := v_review + 1;
    else
      if public.bank_inter_create_record(
        v_transaction_id, nullif(v_item->'rule', 'null'::jsonb), false
      ) then
        v_classified := v_classified + 1;
        v_rule_id := v_item->'rule'->>'id';
        v_rule_counts := jsonb_set(
          v_rule_counts, array[v_rule_id],
          to_jsonb(coalesce((v_rule_counts->>v_rule_id)::integer, 0) + 1), true
        );
      end if;
      v_imported := v_imported + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'pending_review', v_review,
    'auto_classified', v_classified,
    'existing', v_existing_count,
    'rule_counts', v_rule_counts
  );
end;
$$;

create or replace function public.bank_inter_resolve_review(
  p_transaction_id uuid,
  p_action text,
  p_record_id uuid,
  p_expected_rule jsonb,
  p_allow_paid boolean,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.system_bank_transactions%rowtype;
  v_record public.system_finance_records%rowtype;
  v_blocked_reason text;
  v_classified boolean := false;
begin
  if p_action is null or p_action not in ('link', 'create') or nullif(btrim(p_actor), '') is null then
    raise exception 'Decisão de conciliação inválida.';
  end if;
  select * into v_tx
  from public.system_bank_transactions
  where id = p_transaction_id and provider = 'inter';
  if not found then
    raise exception 'Movimentação não encontrada.';
  end if;

  perform 1 from public.system_bank_accounts where id = v_tx.bank_account_id for update;
  if p_action = 'link' then
    if p_record_id is null then
      raise exception 'Escolha o lançamento a vincular.';
    end if;
    -- O trigger financeiro também trava o lançamento antes da movimentação.
    select * into v_record
    from public.system_finance_records
    where id = p_record_id
    for update;
    if not found then
      raise exception 'Lançamento não encontrado.';
    end if;
  end if;
  select * into v_tx
  from public.system_bank_transactions
  where id = p_transaction_id and provider = 'inter'
  for update;
  if not found or v_tx.status <> 'revisao_duplicidade' or v_tx.finance_record_id is not null then
    raise exception 'A movimentação já foi resolvida ou não está mais disponível.';
  end if;

  if p_action = 'create' then
    v_classified := public.bank_inter_create_record(v_tx.id, p_expected_rule, true);
  else
    select c.blocked_reason into v_blocked_reason
    from public.bank_inter_find_candidates(v_tx.bank_account_id, v_tx.amount) c
    where c.id = v_record.id;
    if not found then
      raise exception 'O lançamento não corresponde mais à movimentação ou já foi vinculado.';
    end if;
    if v_blocked_reason = 'cartao' then
      raise exception 'Lançamentos de cartão não podem ser vinculados diretamente à conta bancária.';
    elsif v_blocked_reason is not null then
      raise exception 'Confira a situação, o tipo, o valor e o vínculo do lançamento antes de vinculá-lo.';
    end if;
    if v_record.status = 'paid' and not coalesce(p_allow_paid, false) then
      raise exception 'Sem permissão para editar lançamento já pago.' using errcode = '42501';
    end if;

    update public.system_finance_records
    set bank_account_id = v_tx.bank_account_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'bank_link_provider', 'inter',
          'bank_tx_id', v_tx.id,
          'bank_confirmed_at', v_tx.tx_date
        ),
        updated_at = now()
    where id = v_record.id;
    update public.system_bank_transactions
    set finance_record_id = v_record.id,
        status = case when v_record.status = 'paid' then 'conciliado' else 'pendente_baixa' end,
        updated_at = now()
    where id = v_tx.id;
  end if;

  update public.system_bank_transactions
  set review_resolution = p_action,
      review_resolved_by = p_actor,
      review_resolved_at = now(),
      updated_at = now()
  where id = v_tx.id;

  return jsonb_build_object('action', p_action, 'auto_classified', v_classified);
end;
$$;

-- Se o lançamento vinculado for alterado ou excluído, a movimentação volta à revisão.
create or replace function public.bank_inter_follow_finance_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.system_bank_transactions%rowtype;
  v_status text;
begin
  select * into v_tx
  from public.system_bank_transactions
  where finance_record_id = old.id and provider = 'inter'
  for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.system_bank_transactions
    set finance_record_id = null, status = 'revisao_duplicidade',
        review_reason = 'O lançamento vinculado foi excluído.', updated_at = now()
    where id = v_tx.id;
    return old;
  end if;

  if new.status is null or new.status not in ('paid', 'pending')
    or new.type is distinct from (case when v_tx.amount > 0 then 'revenue' else 'expense' end)
    or new.value is distinct from abs(v_tx.amount)
    or new.bank_account_id is distinct from v_tx.bank_account_id
    or nullif(new.metadata->>'card_id', '') is not null
    or (new.metadata is not null and jsonb_typeof(new.metadata) <> 'object')
  then
    update public.system_bank_transactions
    set finance_record_id = null, status = 'revisao_duplicidade',
        review_reason = 'O lançamento vinculado foi alterado. Confira a baixa antes de criar outro.', updated_at = now()
    where id = v_tx.id;
    if new.metadata is null or jsonb_typeof(new.metadata) = 'object' then
      new.metadata := coalesce(new.metadata, '{}'::jsonb) - 'bank_tx_id' - 'bank_confirmed_at' - 'bank_link_provider';
    end if;
    return new;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'bank_link_provider', 'inter',
    'bank_tx_id', v_tx.id,
    'bank_confirmed_at', v_tx.tx_date
  );
  v_status := v_tx.status;
  if new.status = 'pending' then
    v_status := 'pendente_baixa';
  elsif v_tx.status = 'pendente_baixa' then
    v_status := case
      when new.metadata->>'needs_classification' = 'true' then 'a_classificar'
      when new.metadata->>'source' = 'bank_import' then 'classificado'
      else 'conciliado'
    end;
  elsif v_tx.status = 'a_classificar'
    and old.metadata->>'needs_classification' = 'true'
    and new.metadata->>'needs_classification' = 'false'
  then
    v_status := 'classificado';
  end if;
  if v_status <> v_tx.status then
    update public.system_bank_transactions
    set status = v_status, updated_at = now()
    where id = v_tx.id;
  end if;
  return new;
end;
$$;

drop trigger if exists bank_inter_follow_finance_record on public.system_finance_records;
create trigger bank_inter_follow_finance_record
before update or delete on public.system_finance_records
for each row
when (old.metadata->>'bank_link_provider' = 'inter' or old.metadata->>'provider' = 'inter')
execute function public.bank_inter_follow_finance_record();

create or replace function public.bank_inter_settle_record(
  p_record_id uuid,
  p_paid_amount numeric,
  p_bank_account_id uuid,
  p_payment_method text,
  p_handling text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.system_finance_records%rowtype;
  v_settled public.system_finance_records%rowtype;
  v_remaining public.system_finance_records%rowtype;
  v_remaining_json jsonb;
  v_remaining_metadata jsonb;
  v_difference numeric;
  v_settled_at timestamptz := now();
  v_review_required boolean;
begin
  if p_paid_amount is null or p_paid_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_paid_amount <= 0 or round(p_paid_amount, 2) <> p_paid_amount
    or p_handling is null or p_handling not in ('adjust', 'keep_open')
  then
    raise exception 'Dados de baixa inválidos.';
  end if;

  select * into v_record from public.system_finance_records
  where id = p_record_id for update;
  if not found or v_record.status is distinct from 'pending'
    or jsonb_typeof(v_record.metadata) is distinct from 'object'
    or (v_record.metadata->>'bank_link_provider' is distinct from 'inter'
        and v_record.metadata->>'provider' is distinct from 'inter')
  then
    raise exception 'O lançamento não está mais disponível para baixa do Inter.';
  end if;

  perform 1 from public.system_bank_transactions
  where finance_record_id = v_record.id and provider = 'inter'
    and id::text = v_record.metadata->>'bank_tx_id'
  for update;
  if not found then
    raise exception 'O vínculo bancário mudou. Atualize e tente novamente.';
  end if;

  v_difference := round(v_record.value - p_paid_amount, 2);
  if v_difference is null or (p_handling = 'keep_open' and v_difference <= 0) then
    raise exception 'Não é possível manter a diferença em aberto com esse valor.';
  end if;

  update public.system_finance_records
  set status = 'paid',
      value = p_paid_amount,
      bank_account_id = coalesce(p_bank_account_id, v_record.bank_account_id),
      payment_method = coalesce(p_payment_method, v_record.payment_method),
      metadata = v_record.metadata || jsonb_build_object(
        'settlement', jsonb_build_object(
          'settled_at', v_settled_at,
          'original_value', v_record.value,
          'paid_value', p_paid_amount,
          'difference', v_difference,
          'handling', p_handling,
          'adjustment_kind', case
            when p_paid_amount > v_record.value then 'juros'
            when p_paid_amount < v_record.value then 'desconto'
            else 'sem_diferenca'
          end
        )
      )
  where id = v_record.id
  returning * into v_settled;

  v_review_required := v_settled.metadata->>'bank_tx_id'
    is distinct from v_record.metadata->>'bank_tx_id';
  if p_handling = 'keep_open' and v_difference > 0 then
    v_remaining_metadata := v_record.metadata;
    if v_review_required then
      v_remaining_metadata := v_remaining_metadata - 'bank_tx_id' - 'bank_confirmed_at' - 'bank_link_provider';
    end if;
    insert into public.system_finance_records (
      type, value, description, category, payment_method, bank_account_id,
      status, created_at, is_recurring, recurring_period, metadata
    ) values (
      v_record.type, v_difference, coalesce(v_record.description, '') || ' - Saldo em aberto',
      v_record.category, coalesce(p_payment_method, v_record.payment_method),
      coalesce(p_bank_account_id, v_record.bank_account_id),
      'pending', v_settled_at, false, null,
      v_remaining_metadata || jsonb_build_object(
        'settlement_parent_id', v_record.id,
        'settlement_generated_at', v_settled_at,
        'settlement_generated_value', v_difference
      )
    ) returning * into v_remaining;
    v_remaining_json := to_jsonb(v_remaining);
  end if;

  return jsonb_build_object(
    'settledRecord', to_jsonb(v_settled),
    'remainingRecord', v_remaining_json,
    'bankReviewRequired', v_review_required,
    'meta', jsonb_build_object(
      'originalValue', v_record.value,
      'paidAmount', p_paid_amount,
      'difference', v_difference,
      'handling', p_handling
    )
  );
end;
$$;

revoke all on function public.bank_inter_find_candidates(uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_review_candidates(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_create_record(uuid, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_import_batch(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_resolve_review(uuid, text, uuid, jsonb, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_follow_finance_record() from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_settle_record(uuid, numeric, uuid, text, text) from public, anon, authenticated, service_role;

grant execute on function public.bank_inter_review_candidates(uuid, integer, integer) to service_role;
grant execute on function public.bank_inter_import_batch(uuid, jsonb) to service_role;
grant execute on function public.bank_inter_resolve_review(uuid, text, uuid, jsonb, boolean, text) to service_role;
grant execute on function public.bank_inter_settle_record(uuid, numeric, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
