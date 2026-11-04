begin;

-- Somente o catalogo Websites. Nao altera system_plans nem nfse_config.
alter table public.holding_website_plans
  add column fiscal_config jsonb;

alter table public.holding_website_plans
  add constraint holding_website_plan_fiscal_check check (
    fiscal_config is null or (
      jsonb_typeof(fiscal_config) = 'object'
      and fiscal_config ?& array['national_code','municipal_code','nbs','service_description','accountant_confirmed','simples_percent']
      and jsonb_typeof(fiscal_config->'national_code') = 'string'
      and jsonb_typeof(fiscal_config->'municipal_code') = 'string'
      and jsonb_typeof(fiscal_config->'nbs') = 'string'
      and jsonb_typeof(fiscal_config->'service_description') = 'string'
      and jsonb_typeof(fiscal_config->'accountant_confirmed') = 'boolean'
      and (fiscal_config->>'national_code' = '' or fiscal_config->>'national_code' ~ '^[0-9]{6}$')
      and (fiscal_config->>'municipal_code' = '' or fiscal_config->>'municipal_code' ~ '^[0-9]{3}$')
      and (fiscal_config->>'nbs' = '' or fiscal_config->>'nbs' ~ '^[0-9]{9}$')
      and char_length(fiscal_config->>'service_description') <= 2000
      and (
        fiscal_config->'simples_percent' = 'null'::jsonb
        or case when jsonb_typeof(fiscal_config->'simples_percent') = 'number'
          then (fiscal_config->>'simples_percent')::numeric between 0 and 100
          else false end
      )
      and (
        fiscal_config->>'accountant_confirmed' = 'false'
        or (
          fiscal_config->>'national_code' ~ '^[0-9]{6}$'
          and fiscal_config->>'nbs' ~ '^[0-9]{9}$'
          and char_length(btrim(fiscal_config->>'service_description')) > 0
          and jsonb_typeof(fiscal_config->'simples_percent') = 'number'
        )
      )
    )
  );

commit;
