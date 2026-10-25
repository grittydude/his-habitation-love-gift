-- =============================================================================
-- His Habitation · Love Gift Day — organiser console (/admin)
-- =============================================================================
-- Lets the organiser see every pairing and clear the event from the browser,
-- protected by an organiser passphrase. Same model as member sign-in:
--   * the passphrase is stored only as a bcrypt hash;
--   * sign-in returns a short-lived (30 min) bearer token, stored only as SHA-256;
--   * 5 wrong passphrases lock the console for 15 minutes;
--   * every console sign-in, view and reset is written to private.admin_events.
-- The passphrase is set with `npm run admin:passphrase` (service role only).
-- Safe to re-run.
-- =============================================================================

create table if not exists private.admin_credentials (
  id              boolean primary key default true check (id),   -- single row
  passphrase_hash text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table if not exists private.admin_sessions (
  id         uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Audit trail (no secrets).
create table if not exists private.admin_events (
  id         bigint generated always as identity primary key,
  action     text not null check (action in ('sign_in', 'sign_in_failed', 'sign_in_locked', 'view', 'reset', 'passphrase_set')),
  detail     jsonb,
  created_at timestamptz not null default now()
);

alter table private.admin_credentials enable row level security;
alter table private.admin_sessions    enable row level security;
alter table private.admin_events      enable row level security;
revoke all on private.admin_credentials, private.admin_sessions, private.admin_events
  from public, anon, authenticated;

create or replace function private.admin_session_valid(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_token ~ '^[0-9a-f]{64}$' and exists (
    select 1 from private.admin_sessions s
     where s.token_hash = extensions.digest(p_token, 'sha256')
       and s.revoked_at is null
       and s.expires_at > now());
$$;

-- -----------------------------------------------------------------------------
-- Public console API (callable with the anon key, but useless without a token)
-- -----------------------------------------------------------------------------

create or replace function public.admin_console_sign_in(p_passphrase text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_max_failures constant int := 5;
  c_lockout      constant interval := interval '15 minutes';
  c_session_ttl  constant interval := interval '30 minutes';
  v_cred   private.admin_credentials%rowtype;
  v_token  text;
  v_expiry timestamptz;
begin
  -- Row lock: concurrent guesses are serialised so the limit can't be raced.
  select * into v_cred from private.admin_credentials where id for update;
  if not found then
    perform extensions.crypt(coalesce(p_passphrase, ''), extensions.gen_salt('bf', 10));
    return jsonb_build_object('status', 'not_configured');
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    insert into private.admin_events (action) values ('sign_in_locked');
    return jsonb_build_object('status', 'locked',
      'retry_after_seconds', ceil(extract(epoch from v_cred.locked_until - now()))::int);
  end if;

  if p_passphrase is null or length(p_passphrase) > 200
     or extensions.crypt(p_passphrase, v_cred.passphrase_hash) <> v_cred.passphrase_hash then
    update private.admin_credentials
       set failed_attempts = case when failed_attempts + 1 >= c_max_failures then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= c_max_failures then now() + c_lockout else null end,
           updated_at      = now()
     where id
     returning * into v_cred;
    insert into private.admin_events (action) values ('sign_in_failed');
    if v_cred.locked_until is not null then
      return jsonb_build_object('status', 'locked', 'retry_after_seconds', ceil(extract(epoch from c_lockout))::int);
    end if;
    return jsonb_build_object('status', 'invalid_credentials', 'attempts_remaining', c_max_failures - v_cred.failed_attempts);
  end if;

  update private.admin_credentials set failed_attempts = 0, locked_until = null, updated_at = now() where id;
  v_token  := encode(extensions.gen_random_bytes(32), 'hex');
  v_expiry := now() + c_session_ttl;
  insert into private.admin_sessions (token_hash, expires_at) values (extensions.digest(v_token, 'sha256'), v_expiry);
  insert into private.admin_events (action) values ('sign_in');
  delete from private.admin_sessions where expires_at < now() - interval '1 day';
  return jsonb_build_object('status', 'ok', 'session_token', v_token, 'expires_at', v_expiry);
end;
$$;

create or replace function public.admin_console_sign_out(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_token ~ '^[0-9a-f]{64}$' then
    update private.admin_sessions set revoked_at = now()
     where token_hash = extensions.digest(p_token, 'sha256') and revoked_at is null;
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Everything the organiser needs on one screen.
create or replace function public.admin_console_overview(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.admin_session_valid(p_token) then
    return jsonb_build_object('status', 'invalid_session');
  end if;
  insert into private.admin_events (action) values ('view');
  return jsonb_build_object(
    'status', 'ok',
    'progress', public.get_activity_progress(),
    'pairings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pairing_id', p.id,
               'member_a', a.display_name,
               'member_b', b.display_name,
               'drawn_by', i.display_name,
               'created_at', p.created_at) order by p.created_at)
        from public.pairings p
        join public.members a on a.id = p.member_a_id
        join public.members b on b.id = p.member_b_id
        join public.members i on i.id = p.initiated_by), '[]'::jsonb),
    'unpaired', coalesce((
      select jsonb_agg(m.display_name order by lower(m.display_name))
        from public.members m
       where m.is_active and not exists (select 1 from public.pair_memberships pm where pm.member_id = m.id)), '[]'::jsonb),
    'locked_members', coalesce((
      select jsonb_agg(m.display_name order by lower(m.display_name))
        from private.member_credentials c join public.members m on m.id = c.member_id
       where c.locked_until > now()), '[]'::jsonb));
end;
$$;

-- Clear the event: delete every pairing, sign every member out and clear
-- wrong-code lockouts. Members' links/codes keep working. Irreversible, so it
-- needs both a valid console session and the exact confirmation phrase.
create or replace function public.admin_console_reset(p_token text, p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_sessions int;
begin
  if not private.admin_session_valid(p_token) then
    return jsonb_build_object('status', 'invalid_session');
  end if;
  if p_confirm is distinct from 'RESET ALL PAIRINGS' then
    return jsonb_build_object('status', 'confirmation_required');
  end if;
  v_result := private.admin_reset_pairings('RESET ALL PAIRINGS');
  update private.sessions set revoked_at = now() where revoked_at is null;
  get diagnostics v_sessions = row_count;
  update private.member_credentials set failed_attempts = 0, locked_until = null, updated_at = now()
   where failed_attempts > 0 or locked_until is not null;
  insert into private.admin_events (action, detail)
    values ('reset', jsonb_build_object('pairings_deleted', v_result->'pairings_deleted', 'sessions_ended', v_sessions));
  return jsonb_build_object('status', 'ok', 'pairings_deleted', v_result->'pairings_deleted', 'sessions_ended', v_sessions);
end;
$$;

-- Service role only: set or change the organiser passphrase. Signs out any
-- existing console sessions and clears a lockout.
create or replace function public.admin_set_console_passphrase(p_passphrase text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_passphrase is null or length(p_passphrase) < 12 or length(p_passphrase) > 200 then
    raise exception 'The organiser passphrase must be 12–200 characters' using errcode = '22023';
  end if;
  insert into private.admin_credentials (id, passphrase_hash)
  values (true, extensions.crypt(p_passphrase, extensions.gen_salt('bf', 10)))
  on conflict (id) do update
    set passphrase_hash = excluded.passphrase_hash, failed_attempts = 0, locked_until = null, updated_at = now();
  update private.admin_sessions set revoked_at = now() where revoked_at is null;
  insert into private.admin_events (action) values ('passphrase_set');
  return jsonb_build_object('status', 'ok');
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function private.admin_session_valid(text) from public, anon, authenticated;
revoke all on function
  public.admin_console_sign_in(text),
  public.admin_console_sign_out(text),
  public.admin_console_overview(text),
  public.admin_console_reset(text, text),
  public.admin_set_console_passphrase(text)
from public, anon, authenticated;

grant execute on function
  public.admin_console_sign_in(text),
  public.admin_console_sign_out(text),
  public.admin_console_overview(text),
  public.admin_console_reset(text, text)
to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.admin_set_console_passphrase(text) to service_role;
  end if;
end $$;
