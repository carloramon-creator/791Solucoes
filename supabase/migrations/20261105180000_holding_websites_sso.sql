begin;

revoke insert, update, delete, truncate, references, trigger on public.holding_permission_profiles,
  public.holding_permission_resources, public.holding_profile_resource_permissions,
  public.holding_user_permission_profiles from public, anon, authenticated;
grant all on public.holding_permission_profiles, public.holding_permission_resources,
  public.holding_profile_resource_permissions, public.holding_user_permission_profiles to service_role;

create table public.holding_websites_login_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null references auth.sessions(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '90 seconds'
);

create table public.holding_websites_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null references auth.sessions(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '8 hours'
);
create index holding_websites_codes_expiry on public.holding_websites_login_codes(expires_at);
create index holding_websites_sessions_expiry on public.holding_websites_sessions(expires_at);

alter table public.holding_websites_login_codes enable row level security;
alter table public.holding_websites_sessions enable row level security;
revoke all on public.holding_websites_login_codes, public.holding_websites_sessions from public, anon, authenticated;
grant select, insert, delete on public.holding_websites_login_codes, public.holding_websites_sessions to service_role;

create function public.exchange_holding_websites_code(p_code_hash text, p_challenge text, p_token_hash text)
returns table (expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  issued public.holding_websites_login_codes;
begin
  delete from public.holding_websites_login_codes codes
  where codes.code_hash = p_code_hash and codes.challenge = p_challenge and codes.expires_at > now()
  returning codes.* into issued;
  if not found then return; end if;
  insert into public.holding_websites_sessions(token_hash, user_id, auth_session_id)
  values (p_token_hash, issued.user_id, issued.auth_session_id)
  returning holding_websites_sessions.expires_at into expires_at;
  return next;
end;
$$;

create function public.inspect_holding_websites_session(p_token_hash text)
returns table (user_id uuid, email text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select sessions.user_id, users.email::text, sessions.expires_at
  from public.holding_websites_sessions sessions
  join auth.users users on users.id = sessions.user_id
  join auth.sessions auth_session on auth_session.id = sessions.auth_session_id and auth_session.user_id = users.id
  where sessions.token_hash = p_token_hash and sessions.expires_at > now()
    and (auth_session.not_after is null or auth_session.not_after > now())
    and (users.banned_until is null or users.banned_until <= now());
$$;

revoke all on function public.exchange_holding_websites_code(text,text,text),
  public.inspect_holding_websites_session(text) from public, anon, authenticated;
grant execute on function public.exchange_holding_websites_code(text,text,text),
  public.inspect_holding_websites_session(text) to service_role;

commit;
