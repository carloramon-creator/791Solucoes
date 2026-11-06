begin;

alter table public.holding_website_plans
  drop constraint holding_website_plan_features_check;

alter table public.holding_website_plans
  add constraint holding_website_plan_features_check check (
    website_features <@ array[
      'configuration','briefing','templates','content','images','catalog',
      'domain_managed','customer_dns','email_setup','social'
    ]::text[]
    and (category = 'creation' or cardinality(website_features) = 0)
    and (category <> 'creation' or website_features @> array['configuration','briefing']::text[])
    and ('catalog' <> all(website_features) or project_type in ('catalog','store'))
  );

commit;
