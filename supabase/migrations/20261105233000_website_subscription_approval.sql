begin;

alter table public.holding_website_subscriptions
  drop constraint holding_website_subscriptions_contract_id_key;
create index holding_website_subscriptions_contract_idx on public.holding_website_subscriptions(contract_id);

alter table public.holding_website_subscriptions
  add column approval_status text not null default 'approved'
    check (approval_status in ('pending','approved')),
  add column approved_at timestamptz,
  add column approved_by uuid;
alter table public.holding_website_subscriptions alter column approval_status set default 'pending';

create function public.holding_link_website_subscription(
  p_contract_id uuid,p_subscription_id uuid
) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare v_contract public.holding_website_contracts; v_subscription public.holding_website_subscriptions;
begin
  select * into strict v_contract from public.holding_website_contracts where id=p_contract_id for update;
  select * into strict v_subscription from public.holding_website_subscriptions where id=p_subscription_id for update;
  if v_subscription.customer_id <> v_contract.customer_id
    or (v_subscription.contract_id is not null and v_subscription.contract_id <> p_contract_id)
    or v_subscription.lifecycle_status='cancelled' then
    raise exception 'Selecione uma assinatura do mesmo cliente, sem outro projeto e nao encerrada';
  end if;
  update public.holding_website_subscriptions set contract_id=p_contract_id where id=p_subscription_id;
  return p_subscription_id;
end;
$$;

create function public.holding_add_contract_subscription(
  p_contract_id uuid,p_request_id uuid,p_plan_id uuid,p_amount_cents integer,
  p_payment_method text,p_first_due_date date,p_cycle text
) returns uuid language plpgsql set search_path=public,pg_temp as $$
declare v_customer uuid; v_id uuid;
begin
  select customer_id into strict v_customer from public.holding_website_contracts where id=p_contract_id for update;
  v_id:=public.holding_create_website_subscription(
    p_request_id,v_customer,p_plan_id,p_amount_cents,p_payment_method,p_first_due_date,p_cycle);
  return public.holding_link_website_subscription(p_contract_id,v_id);
end;
$$;

revoke all on function public.holding_link_website_subscription(uuid,uuid),
  public.holding_add_contract_subscription(uuid,uuid,uuid,integer,text,date,text)
  from public,anon,authenticated;
grant execute on function public.holding_link_website_subscription(uuid,uuid),
  public.holding_add_contract_subscription(uuid,uuid,uuid,integer,text,date,text) to service_role;

commit;
