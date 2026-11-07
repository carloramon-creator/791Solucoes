begin;
alter table public.holding_website_plans add column translation_monthly_characters integer not null default 0;
alter table public.holding_website_plans drop constraint holding_website_plan_features_check;
alter table public.holding_website_plans add constraint holding_website_plan_features_check check (
  website_features <@ array['configuration','briefing','templates','content','images','catalog','domain_managed','customer_dns','email_setup','social','translation']::text[]
  and (category='creation' or cardinality(website_features)=0)
  and (category<>'creation' or website_features @> array['configuration','briefing']::text[])
  and ('catalog'<>all(website_features) or project_type in ('catalog','store'))
);
alter table public.holding_website_plans add constraint holding_website_translation_limit check (
  case when 'translation'=any(website_features) then translation_monthly_characters between 1 and 1800000
    else translation_monthly_characters=0 end
);
create function public.holding_snapshot_translation_quota() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_limit integer;
begin
  if TG_OP='UPDATE' and new.plan_id=old.plan_id and new.plan_snapshot is not distinct from old.plan_snapshot then return new; end if;
  if coalesce(new.plan_snapshot->'website_features','[]'::jsonb) ? 'translation' then
    select translation_monthly_characters into strict v_limit from holding_website_plans where id=new.plan_id;
    if v_limit<1 then raise exception 'Plano sem franquia de traducao'; end if;
    new.plan_snapshot:=jsonb_set(new.plan_snapshot,'{translation_monthly_characters}',to_jsonb(v_limit));
  else new.plan_snapshot:=jsonb_set(new.plan_snapshot,'{translation_monthly_characters}','0'::jsonb); end if;
  return new;
end;
$$;
create trigger holding_contract_translation_quota before insert or update of plan_id,plan_snapshot
  on public.holding_website_contracts for each row execute function public.holding_snapshot_translation_quota();
revoke all on function public.holding_snapshot_translation_quota() from public,anon,authenticated;
commit;
