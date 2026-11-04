begin;

alter table public.holding_website_contracts
  add column bundled_subscription boolean not null default false;
alter table public.holding_website_subscriptions
  add column contract_id uuid unique references public.holding_website_contracts(id),
  add column lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active','paused','cancelled')),
  add column pending_action text check (pending_action in ('pause','resume','cancel')),
  add column resume_due_date date,
  add constraint holding_website_resume_date_check check (
    (pending_action = 'resume' and resume_due_date is not null)
    or (pending_action is distinct from 'resume' and resume_due_date is null)
  );
update public.holding_website_subscriptions set lifecycle_status='paused' where remote_status='INACTIVE';

create function public.holding_create_website_bundle(
  p_request_id uuid,p_customer_id uuid,p_plan_id uuid,p_total_cents integer,p_payment_method text,
  p_schedule jsonb,p_subscription jsonb
) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
  v_contract uuid;
  v_subscription uuid;
  v_existing public.holding_website_contracts;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  if p_subscription is not null and (jsonb_typeof(p_subscription) <> 'object'
    or p_subscription->'fiscal_confirmed' is distinct from 'true'::jsonb) then
    raise exception 'Confirme as condicoes fiscais da assinatura';
  end if;
  select * into v_existing from public.holding_website_contracts where request_id=p_request_id;
  if found and v_existing.bundled_subscription is distinct from (p_subscription is not null) then
    raise exception using errcode='22023',message='Tentativa reutilizada com dados diferentes';
  end if;
  v_contract := public.holding_create_website_contract(
    p_request_id,p_customer_id,p_plan_id,p_total_cents,p_payment_method,p_schedule);
  if p_subscription is not null then
    if exists (select 1 from public.holding_website_subscriptions
      where request_id=p_request_id and contract_id is distinct from v_contract) then
      raise exception using errcode='22023',message='Assinatura ja vinculada a outra tentativa';
    end if;
    v_subscription := public.holding_create_website_subscription(
      p_request_id,p_customer_id,(p_subscription->>'plan_id')::uuid,
      (p_subscription->>'amount_cents')::integer,p_subscription->>'payment_method',
      (p_subscription->>'first_due_date')::date,p_subscription->>'billing_cycle');
    update public.holding_website_subscriptions set contract_id=v_contract where id=v_subscription;
    update public.holding_website_contracts set bundled_subscription=true where id=v_contract;
  end if;
  return jsonb_build_object('id',v_contract,'subscription_id',v_subscription);
end;
$$;
revoke all on function public.holding_create_website_bundle(uuid,uuid,uuid,integer,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.holding_create_website_bundle(uuid,uuid,uuid,integer,text,jsonb,jsonb) to service_role;

commit;
