begin;

create table public.holding_websites_sync_outbox (
  id boolean primary key default true check (id),
  revision bigint not null default 1 check (revision > 0),
  delivered_revision bigint not null default 0,
  changed_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  check (delivered_revision between 0 and revision)
);
insert into public.holding_websites_sync_outbox(id) values (true);
alter table public.holding_websites_sync_outbox enable row level security;
revoke all on public.holding_websites_sync_outbox from public, anon, authenticated;
grant select, update on public.holding_websites_sync_outbox to service_role;

create or replace function public.inspect_holding_websites_session(p_token_hash text)
returns table (user_id uuid, email text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select sessions.user_id, users.email::text, least(sessions.expires_at, auth_session.not_after)
  from public.holding_websites_sessions sessions
  join auth.users users on users.id = sessions.user_id
  join auth.sessions auth_session on auth_session.id = sessions.auth_session_id and auth_session.user_id = users.id
  where sessions.token_hash = p_token_hash and sessions.expires_at > now()
    and (auth_session.not_after is null or auth_session.not_after > now())
    and (users.banned_until is null or users.banned_until <= now());
$$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'websites_sync_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'websites_sync_cron_secret');
  end if;
end $$;

create function public.websites_sync_secret_ok(p_secret text) returns boolean
language sql security definer set search_path = '' as $$
  select coalesce((select decrypted_secret = p_secret from vault.decrypted_secrets
    where name = 'websites_sync_cron_secret' limit 1), false);
$$;

create function public.request_websites_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.holding_websites_sync_outbox where revision > delivered_revision) then
    perform net.http_post(
      url := 'https://admin.791solucoes.com.br/api/system/cron/websites-sync',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-websites-sync-secret', (select decrypted_secret from vault.decrypted_secrets
          where name = 'websites_sync_cron_secret' limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
  end if;
end;
$$;

create function public.enqueue_websites_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.holding_websites_sync_outbox set revision = revision + 1, changed_at = now() where id;
  -- pg_net only sends after commit; several changes in one transaction share a wakeup.
  if current_setting('holding.websites_sync_tx', true) is distinct from txid_current()::text then
    perform set_config('holding.websites_sync_tx', txid_current()::text, true);
    perform public.request_websites_sync();
  end if;
  return null;
end;
$$;

create function public.acknowledge_websites_sync(p_revision bigint) returns void
language sql security definer set search_path = '' as $$
  update public.holding_websites_sync_outbox
    set delivered_revision = greatest(delivered_revision, p_revision), delivered_at = now(), last_error = null
    where id and p_revision between 1 and revision;
$$;

create trigger websites_sync_contracts after insert or update or delete
  on public.holding_website_contracts for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_subscriptions after insert or update or delete
  on public.holding_website_subscriptions for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_sessions after insert or update or delete
  on public.holding_websites_sessions for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_profiles after insert or update or delete
  on public.holding_permission_profiles for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_resources after insert or update or delete
  on public.holding_permission_resources for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_grants after insert or update or delete
  on public.holding_profile_resource_permissions for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_assignments after insert or update or delete
  on public.holding_user_permission_profiles for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_auth_logout after delete on auth.sessions
  for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_auth_expiry after update of not_after, user_id on auth.sessions
  for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_auth_users after update of email, banned_until on auth.users
  for each statement execute function public.enqueue_websites_sync();
create trigger websites_sync_auth_delete after delete on auth.users
  for each statement execute function public.enqueue_websites_sync();

revoke all on function public.websites_sync_secret_ok(text), public.request_websites_sync(),
  public.enqueue_websites_sync(), public.acknowledge_websites_sync(bigint),
  public.inspect_holding_websites_session(text) from public, anon, authenticated;
grant execute on function public.websites_sync_secret_ok(text), public.request_websites_sync(),
  public.acknowledge_websites_sync(bigint), public.inspect_holding_websites_session(text) to service_role;

select cron.schedule('websites-sync-retry', '* * * * *', 'select public.request_websites_sync()');
select public.request_websites_sync();
commit;
