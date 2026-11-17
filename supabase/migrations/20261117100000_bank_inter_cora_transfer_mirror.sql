begin;

insert into public.system_finance_categories (name, type)
select 'Transferência entre contas', t
from (values ('revenue'), ('expense')) v(t)
where not exists (
  select 1
  from public.system_finance_categories c
  where c.name = 'Transferência entre contas'
    and c.type = v.t
);

create unique index if not exists system_finance_records_transfer_mirror_unique
  on public.system_finance_records ((metadata->>'transfer_mirror_of'))
  where metadata->>'source' = 'bank_transfer_mirror';

create or replace function public.bank_inter_mirror_cora_transfer(p_record_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.system_finance_records%rowtype;
  v_cora_account_id uuid;
  v_cora_account_count integer;
  v_source_provider text;
  v_text text;
  v_mirror_type text;
  v_mirror_category text;
  v_mirror_id uuid;
begin
  select * into v_source
  from public.system_finance_records
  where id = p_record_id
  for update;
  if not found
    or v_source.status is distinct from 'paid'
    or v_source.type not in ('revenue', 'expense')
    or v_source.value is null
    or v_source.value <= 0
    or jsonb_typeof(v_source.metadata) is distinct from 'object'
    or (v_source.metadata->>'provider' is distinct from 'inter'
        and v_source.metadata->>'bank_link_provider' is distinct from 'inter')
  then
    return null;
  end if;

  select provider into v_source_provider
  from public.system_bank_accounts
  where id = v_source.bank_account_id;
  if v_source_provider is distinct from 'inter'
    or not exists (
      select 1
      from public.system_bank_transactions tx
      where tx.finance_record_id = v_source.id
        and tx.provider = 'inter'
        and tx.id::text = v_source.metadata->>'bank_tx_id'
    )
  then
    return null;
  end if;

  v_text := translate(
    lower(concat_ws(' ', v_source.description, v_source.metadata->>'counterparty')),
    'áàãâäéèêëíìîïóòõôöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );
  if v_text not like '%791 solucoes empresariais%' then
    return null;
  end if;

  select id into v_mirror_id
  from public.system_finance_records
  where metadata->>'source' = 'bank_transfer_mirror'
    and metadata->>'transfer_mirror_of' = v_source.id::text;
  if found then
    select bank_account_id into v_cora_account_id
    from public.system_finance_records
    where id = v_mirror_id;
    if v_source.category is distinct from 'Transferência entre contas'
      or v_source.metadata->>'internal_transfer' is distinct from 'true'
      or v_source.metadata->>'needs_classification' is distinct from 'false'
      or v_source.metadata->>'transfer_mirror_id' is distinct from v_mirror_id::text
      or v_source.metadata->>'transfer_mirror_account_id' is distinct from v_cora_account_id::text
    then
      update public.system_finance_records
      set category = 'Transferência entre contas',
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'internal_transfer', true,
            'needs_classification', false,
            'transfer_mirror_id', v_mirror_id,
            'transfer_mirror_account_id', v_cora_account_id
          ),
          updated_at = now()
      where id = v_source.id;
    end if;
    return v_mirror_id;
  end if;

  select count(*), (array_agg(id order by id))[1]
  into v_cora_account_count, v_cora_account_id
  from public.system_bank_accounts
  where provider = 'cora';
  if v_cora_account_count <> 1 then
    raise exception 'Transferência interna detectada, mas é necessário haver exatamente uma conta Cora configurada.';
  end if;

  v_mirror_type := case when v_source.type = 'expense' then 'revenue' else 'expense' end;
  select name into v_mirror_category
  from public.system_finance_categories
  where name = 'Transferência entre contas'
    and type = v_mirror_type
  limit 1;
  if not found then
    raise exception 'A categoria "Transferência entre contas" não está configurada para o lançamento da Cora.';
  end if;

  insert into public.system_finance_records (
    type, value, description, payment_method, bank_account_id, category,
    status, created_at, metadata
  ) values (
    v_mirror_type,
    abs(v_source.value),
    left('Transferência entre contas - ' || coalesce(nullif(v_source.description, ''), 'Movimentação do Inter'), 300),
    'Transferencia',
    v_cora_account_id,
    v_mirror_category,
    'paid',
    v_source.created_at,
    jsonb_build_object(
      'source', 'bank_transfer_mirror',
      'provider', 'cora',
      'internal_transfer', true,
      'needs_classification', false,
      'transfer_mirror_of', v_source.id,
      'transfer_source_provider', 'inter',
      'transfer_source_bank_account_id', v_source.bank_account_id,
      'transfer_source_bank_tx_id', v_source.metadata->>'bank_tx_id'
    )
  )
  returning id into v_mirror_id;

  update public.system_finance_records
  set category = 'Transferência entre contas',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'internal_transfer', true,
        'needs_classification', false,
        'transfer_mirror_id', v_mirror_id,
        'transfer_mirror_account_id', v_cora_account_id
      ),
      updated_at = now()
  where id = v_source.id;

  return v_mirror_id;
end;
$$;

create or replace function public.bank_inter_mirror_cora_transfer_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.finance_record_id is not null and new.provider = 'inter' then
    if tg_op = 'INSERT' then
      perform public.bank_inter_mirror_cora_transfer(new.finance_record_id);
    elsif new.finance_record_id is distinct from old.finance_record_id then
      perform public.bank_inter_mirror_cora_transfer(new.finance_record_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bank_inter_mirror_cora_transfer on public.system_bank_transactions;
create trigger bank_inter_mirror_cora_transfer
after insert or update of finance_record_id on public.system_bank_transactions
for each row
execute function public.bank_inter_mirror_cora_transfer_trigger();

revoke all on function public.bank_inter_mirror_cora_transfer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.bank_inter_mirror_cora_transfer_trigger() from public, anon, authenticated, service_role;

do $$
declare
  v_record record;
begin
  for v_record in
    select r.id
    from public.system_finance_records r
    join public.system_bank_accounts a on a.id = r.bank_account_id and a.provider = 'inter'
    where r.status = 'paid'
      and (
        r.metadata->>'provider' = 'inter'
        or r.metadata->>'bank_link_provider' = 'inter'
      )
      and translate(
        lower(concat_ws(' ', r.description, r.metadata->>'counterparty')),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ) like '%791 solucoes empresariais%'
    order by r.created_at, r.id
  loop
    perform public.bank_inter_mirror_cora_transfer(v_record.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
