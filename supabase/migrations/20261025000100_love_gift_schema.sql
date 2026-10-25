-- =============================================================================
-- His Habitation · Love Gift Day — schema, security model and pairing logic
-- =============================================================================
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS). Re-running never deletes members or pairings.
--
-- Security model (summary — see README "Security design"):
--   * The browser only holds the public anon key. The anon/authenticated roles
--     have NO privileges on any table except SELECT on the counters-only
--     public.activity_progress row (used for realtime progress).
--   * Everything else goes through SECURITY DEFINER functions that take a
--     server-issued session token, never a member id chosen by the caller.
--   * Access codes are stored only as bcrypt hashes; session tokens are stored
--     only as SHA-256 digests. Neither is ever returned by any function.
--   * Secrets live in the `private` schema, which PostgREST does not expose.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- The v1 starter (supabase/setup.sql) created incompatible tables with the
-- wrong roster. Refuse to run on top of it rather than silently mixing schemas.
do $$
begin
  if (to_regclass('public.members') is not null and exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'members' and column_name = 'name'))
     or (to_regclass('public.pairings') is not null and not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'pairings' and column_name = 'initiated_by'))
  then
    raise exception 'The old v1 starter schema is installed. Run supabase/drop_v1_starter.sql once, then re-run this migration.';
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null unique
               check (display_name = btrim(display_name) and length(display_name) between 1 and 80),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- One row per pair. Canonical ordering (a < b) means the same two people can
-- only ever be written one way.
create table if not exists public.pairings (
  id           uuid primary key default gen_random_uuid(),
  member_a_id  uuid not null references public.members (id) on delete restrict,
  member_b_id  uuid not null references public.members (id) on delete restrict,
  initiated_by uuid not null references public.members (id) on delete restrict,
  created_at   timestamptz not null default now(),
  constraint pairings_distinct_members check (member_a_id <> member_b_id),
  constraint pairings_canonical_order  check (member_a_id < member_b_id),
  constraint pairings_initiator_is_participant check (initiated_by in (member_a_id, member_b_id)),
  constraint pairings_member_a_unique unique (member_a_id),
  constraint pairings_member_b_unique unique (member_b_id)
);

-- Membership index: exactly one row per paired member. The PRIMARY KEY on
-- member_id is what makes "each member appears in at most one pairing" a hard
-- database guarantee — unique(member_a_id) + unique(member_b_id) alone would
-- still allow someone to be `a` in one pair and `b` in another. Rows are only
-- ever written by the trigger on public.pairings, inside the same transaction.
create table if not exists public.pair_memberships (
  member_id  uuid primary key references public.members (id) on delete restrict,
  pairing_id uuid not null references public.pairings (id) on delete cascade,
  partner_id uuid not null references public.members (id) on delete restrict,
  constraint pair_memberships_not_self check (member_id <> partner_id)
);
create index if not exists pair_memberships_pairing_idx on public.pair_memberships (pairing_id);

-- Counters only — no names, no ids. This is the only table the public can read
-- and the only one published to Supabase Realtime.
create table if not exists public.activity_progress (
  id             boolean primary key default true check (id),
  total_members  integer not null default 0,
  paired_members integer not null default 0,
  updated_at     timestamptz not null default now()
);
insert into public.activity_progress (id) values (true) on conflict (id) do nothing;

create table if not exists private.member_credentials (
  member_id       uuid primary key references public.members (id) on delete cascade,
  code_hash       text not null,              -- bcrypt, never plaintext
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create table if not exists private.sessions (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  token_hash bytea not null unique,           -- sha256(token), never the token
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists sessions_member_idx on private.sessions (member_id);

-- Audit trail of sign-in attempts. Contains no codes or tokens.
create table if not exists private.auth_events (
  id         bigint generated always as identity primary key,
  member_id  uuid references public.members (id) on delete set null,
  outcome    text not null check (outcome in ('success', 'invalid_code', 'unknown_member', 'locked')),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Row Level Security + privileges (defence in depth: RLS on, grants revoked)
-- -----------------------------------------------------------------------------

alter table public.members            enable row level security;
alter table public.pairings           enable row level security;
alter table public.pair_memberships   enable row level security;
alter table public.activity_progress  enable row level security;
alter table private.member_credentials enable row level security;
alter table private.sessions           enable row level security;
alter table private.auth_events        enable row level security;

-- Supabase grants anon/authenticated ALL on new public tables by default.
-- Take that away explicitly; no policies exist for these tables, so even a
-- future accidental GRANT would still be blocked by RLS.
revoke all on public.members, public.pairings, public.pair_memberships, public.activity_progress
  from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- The progress counter row is safe to publish.
grant select on public.activity_progress to anon, authenticated;
drop policy if exists "Progress counters are public" on public.activity_progress;
create policy "Progress counters are public" on public.activity_progress
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------

-- Server-generated timestamp: whatever a writer supplies is overwritten.
create or replace function private.pairings_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  return new;
end;
$$;

-- Write both membership rows. A primary-key violation here aborts the whole
-- pairing insert, so an overlapping pair can never be committed.
create or replace function private.pairings_after_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.pair_memberships (member_id, pairing_id, partner_id)
  values (new.member_a_id, new.id, new.member_b_id),
         (new.member_b_id, new.id, new.member_a_id);
  return null;
end;
$$;

-- Pairing history is append-only. Only private.admin_reset_pairings() (owner
-- only, for rehearsals) may remove rows, by setting a transaction-local flag.
-- NOTE: this guards against *accidental* edits by privileged roles (dashboard
-- table editor, service-role scripts). It is not the security boundary for
-- participants — anon/authenticated hold no table privileges at all, so they
-- can never reach this trigger. Custom settings like this flag are settable by
-- any role, which is fine precisely because of that.
create or replace function private.forbid_pairing_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('love_gift.allow_reset', true), '') = 'on' and tg_op in ('DELETE', 'TRUNCATE') then
    return case when tg_op = 'DELETE' then old else null end;
  end if;
  raise exception 'Pairing history is append-only (% on %)', tg_op, tg_table_name
    using errcode = '42501';
end;
$$;

-- Keep the public counters in step with the real tables (same transaction).
create or replace function private.refresh_activity_progress()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.activity_progress
     set total_members  = (select count(*) from public.members where is_active),
         paired_members = (select count(*) from public.pair_memberships),
         updated_at     = now()
   where id;
  return null;
end;
$$;

drop trigger if exists pairings_before_insert on public.pairings;
create trigger pairings_before_insert before insert on public.pairings
  for each row execute function private.pairings_before_insert();

drop trigger if exists pairings_after_insert on public.pairings;
create trigger pairings_after_insert after insert on public.pairings
  for each row execute function private.pairings_after_insert();

drop trigger if exists pairings_immutable on public.pairings;
create trigger pairings_immutable before update or delete on public.pairings
  for each row execute function private.forbid_pairing_mutation();
drop trigger if exists pairings_no_truncate on public.pairings;
create trigger pairings_no_truncate before truncate on public.pairings
  for each statement execute function private.forbid_pairing_mutation();

drop trigger if exists pair_memberships_immutable on public.pair_memberships;
create trigger pair_memberships_immutable before update or delete on public.pair_memberships
  for each row execute function private.forbid_pairing_mutation();
drop trigger if exists pair_memberships_no_truncate on public.pair_memberships;
create trigger pair_memberships_no_truncate before truncate on public.pair_memberships
  for each statement execute function private.forbid_pairing_mutation();

drop trigger if exists pair_memberships_progress on public.pair_memberships;
create trigger pair_memberships_progress after insert or delete on public.pair_memberships
  for each statement execute function private.refresh_activity_progress();

drop trigger if exists members_progress on public.members;
create trigger members_progress after insert or update or delete on public.members
  for each statement execute function private.refresh_activity_progress();

-- -----------------------------------------------------------------------------
-- Internal helpers (not callable by API roles)
-- -----------------------------------------------------------------------------

-- Resolve a bearer session token to an active member id, or NULL.
create or replace function private.session_member(p_token text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_member uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select s.member_id into v_member
    from private.sessions s
    join public.members m on m.id = s.member_id
   where s.token_hash = extensions.digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now()
     and m.is_active;
  return v_member;
end;
$$;

create or replace function private.member_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'name', m.display_name) from public.members m where m.id = p_id;
$$;

-- The caller's own pairing as JSON, or NULL when unpaired.
create or replace function private.pairing_json(p_member uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'partner', private.member_json(pm.partner_id),
           'paired_at', p.created_at,
           'initiated_by_me', p.initiated_by = p_member)
    from public.pair_memberships pm
    join public.pairings p on p.id = pm.pairing_id
   where pm.member_id = p_member;
$$;

-- -----------------------------------------------------------------------------
-- Public API (anon) — every function returns a JSON object with a `status`.
-- Expected failures are returned, not raised, so that state changes such as
-- failed-attempt counters are committed rather than rolled back.
-- -----------------------------------------------------------------------------

-- Roster for the name dropdown. Deliberately exposes no pairing status.
create or replace function public.list_members()
returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.display_name from public.members m where m.is_active order by lower(m.display_name);
$$;

create or replace function public.get_activity_progress()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select (select count(*) from public.members where is_active)::int as total,
           (select count(*) from public.pair_memberships)::int        as paired
  )
  select jsonb_build_object(
           'total_members',   c.total,
           'paired_members',  c.paired,
           'unpaired_members', c.total - c.paired,
           'pairs_completed', c.paired / 2,
           'total_pairs',     c.total / 2,
           'is_complete',     c.total > 0 and c.total - c.paired < 2,
           'checked_at',      now())
    from c;
$$;

-- Exchange (member id + access code) for a short-lived session token.
-- Rate limit: 5 consecutive failures lock that member's sign-in for 15 minutes.
create or replace function public.member_sign_in(p_member_id uuid, p_access_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c_max_failures constant int := 5;
  c_lockout      constant interval := interval '15 minutes';
  c_session_ttl  constant interval := interval '2 hours';
  v_code   text := upper(regexp_replace(coalesce(p_access_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_cred   private.member_credentials%rowtype;
  v_token  text;
  v_expiry timestamptz;
begin
  if p_member_id is null or length(v_code) = 0 or length(v_code) > 64 then
    return jsonb_build_object('status', 'invalid_credentials');
  end if;

  -- Row lock serialises concurrent attempts for the same member so the
  -- failure counter cannot be raced past the limit.
  select c.* into v_cred
    from private.member_credentials c
    join public.members m on m.id = c.member_id and m.is_active
   where c.member_id = p_member_id
     for update of c;

  if not found then
    -- Spend the same bcrypt time so unknown/unprovisioned ids are not distinguishable by timing.
    perform extensions.crypt(v_code, extensions.gen_salt('bf', 10));
    insert into private.auth_events (member_id, outcome)
      select p_member_id, 'unknown_member' where exists (select 1 from public.members where id = p_member_id);
    return jsonb_build_object('status', 'invalid_credentials');
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    insert into private.auth_events (member_id, outcome) values (p_member_id, 'locked');
    return jsonb_build_object('status', 'locked',
      'retry_after_seconds', ceil(extract(epoch from v_cred.locked_until - now()))::int);
  end if;

  if extensions.crypt(v_code, v_cred.code_hash) <> v_cred.code_hash then
    update private.member_credentials
       set failed_attempts = case when failed_attempts + 1 >= c_max_failures then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= c_max_failures then now() + c_lockout else null end,
           updated_at      = now()
     where member_id = p_member_id
     returning * into v_cred;
    insert into private.auth_events (member_id, outcome) values (p_member_id, 'invalid_code');
    if v_cred.locked_until is not null then
      return jsonb_build_object('status', 'locked',
        'retry_after_seconds', ceil(extract(epoch from c_lockout))::int);
    end if;
    return jsonb_build_object('status', 'invalid_credentials',
      'attempts_remaining', c_max_failures - v_cred.failed_attempts);
  end if;

  update private.member_credentials
     set failed_attempts = 0, locked_until = null, updated_at = now()
   where member_id = p_member_id;

  -- 256-bit random bearer token; only its SHA-256 digest is stored.
  v_token  := encode(extensions.gen_random_bytes(32), 'hex');
  v_expiry := now() + c_session_ttl;
  insert into private.sessions (member_id, token_hash, expires_at)
    values (p_member_id, extensions.digest(v_token, 'sha256'), v_expiry);
  insert into private.auth_events (member_id, outcome) values (p_member_id, 'success');

  -- Opportunistic housekeeping.
  delete from private.sessions where expires_at < now() - interval '1 day';

  return jsonb_build_object(
    'status', 'ok',
    'session_token', v_token,
    'expires_at', v_expiry,
    'member', private.member_json(p_member_id));
end;
$$;

create or replace function public.member_sign_out(p_session_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_session_token ~ '^[0-9a-f]{64}$' then
    update private.sessions set revoked_at = now()
     where token_hash = extensions.digest(p_session_token, 'sha256') and revoked_at is null;
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- The signed-in member's own pairing (never anyone else's).
create or replace function public.get_my_pairing(p_session_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_member  uuid := private.session_member(p_session_token);
  v_pairing jsonb;
begin
  if v_member is null then
    return jsonb_build_object('status', 'invalid_session');
  end if;
  v_pairing := private.pairing_json(v_member);
  return jsonb_build_object(
           'status', case when v_pairing is null then 'unpaired' else 'paired' end,
           'member', private.member_json(v_member))
         || coalesce(v_pairing, '{}'::jsonb);
end;
$$;

-- The authoritative, atomic draw.
--
-- Concurrency: every writer to public.pairings goes through this function,
-- and each call takes the same transaction-scoped advisory lock before reading
-- the pool. The function is VOLATILE, so under READ COMMITTED each statement
-- after the lock takes a fresh snapshot that includes every pair committed by
-- the previous lock holder (the lock is only released at its COMMIT). The
-- second of two simultaneous requests therefore re-checks, sees the first
-- pair, and either returns it (same member) or draws from the reduced pool.
-- The pair_memberships primary key is a final backstop: even a writer that
-- bypassed the lock could not commit an overlapping pair.
-- A single global lock is deliberate — with 24 people, serialising draws costs
-- milliseconds and removes every class of pool race.
create or replace function public.draw_partner(p_session_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_member  uuid := private.session_member(p_session_token);
  v_partner uuid;
  v_pairing jsonb;
begin
  if v_member is null then
    return jsonb_build_object('status', 'invalid_session');
  end if;

  -- Fast path: already paired (possibly by someone else, before ever visiting).
  v_pairing := private.pairing_json(v_member);
  if v_pairing is not null then
    return jsonb_build_object('status', 'existing', 'member', private.member_json(v_member)) || v_pairing;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('his-habitation-love-gift:pairing', 0));

  -- Re-check under the lock (fresh snapshot).
  v_pairing := private.pairing_json(v_member);
  if v_pairing is not null then
    return jsonb_build_object('status', 'existing', 'member', private.member_json(v_member)) || v_pairing;
  end if;

  select m.id into v_partner
    from public.members m
   where m.is_active
     and m.id <> v_member
     and not exists (select 1 from public.pair_memberships pm where pm.member_id = m.id)
   order by random()
   limit 1;

  if v_partner is null then
    return jsonb_build_object('status', 'no_partner_available', 'member', private.member_json(v_member));
  end if;

  insert into public.pairings (member_a_id, member_b_id, initiated_by)
  values (least(v_member, v_partner), greatest(v_member, v_partner), v_member);

  return jsonb_build_object('status', 'created', 'member', private.member_json(v_member))
         || private.pairing_json(v_member);
end;
$$;

-- -----------------------------------------------------------------------------
-- Administrator API — service_role only (used by scripts/*.mjs with the
-- service-role key, which must never be shipped to the browser).
-- -----------------------------------------------------------------------------

-- p_codes: [{"member_id": "...", "code": "ABCD-EFGH"}, ...]
-- Hashes each code with bcrypt, clears lockouts, and revokes that member's
-- existing sessions. Returns only counts.
create or replace function public.admin_provision_access_codes(p_codes jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_code text;
  v_count int := 0;
begin
  if jsonb_typeof(p_codes) <> 'array' then
    raise exception 'p_codes must be a JSON array' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_codes) loop
    v_code := upper(regexp_replace(coalesce(v_item->>'code', ''), '[^A-Za-z0-9]', '', 'g'));
    if length(v_code) < 8 then
      raise exception 'Access codes must have at least 8 letters/digits' using errcode = '22023';
    end if;
    if not exists (select 1 from public.members where id = (v_item->>'member_id')::uuid) then
      raise exception 'Unknown member id %', v_item->>'member_id' using errcode = '22023';
    end if;
    insert into private.member_credentials (member_id, code_hash)
    values ((v_item->>'member_id')::uuid, extensions.crypt(v_code, extensions.gen_salt('bf', 10)))
    on conflict (member_id) do update
      set code_hash = excluded.code_hash, failed_attempts = 0, locked_until = null, updated_at = now();
    update private.sessions set revoked_at = now()
     where member_id = (v_item->>'member_id')::uuid and revoked_at is null;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'provisioned', v_count);
end;
$$;

create or replace function public.admin_access_code_status()
returns table (member_id uuid, name text, has_code boolean, locked_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.display_name, c.member_id is not null, c.locked_until
    from public.members m
    left join private.member_credentials c on c.member_id = m.id
   where m.is_active
   order by lower(m.display_name);
$$;

create or replace function public.admin_pairing_history()
returns table (pairing_id uuid, member_a text, member_b text, drawn_by text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, a.display_name, b.display_name, i.display_name, p.created_at
    from public.pairings p
    join public.members a on a.id = p.member_a_id
    join public.members b on b.id = p.member_b_id
    join public.members i on i.id = p.initiated_by
   order by p.created_at;
$$;

-- SQL-editor conveniences (owner only; not exposed through the API).
create or replace view private.pairing_history as
  select * from public.admin_pairing_history();

create or replace function private.admin_unlock_member(p_member_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update private.member_credentials set failed_attempts = 0, locked_until = null, updated_at = now()
   where member_id = p_member_id;
$$;

-- Rehearsal reset. Requires an exact confirmation phrase.
create or replace function private.admin_reset_pairings(p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_deleted int;
begin
  if p_confirm is distinct from 'RESET ALL PAIRINGS' then
    raise exception 'Pass the exact phrase ''RESET ALL PAIRINGS'' to confirm' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('his-habitation-love-gift:pairing', 0));
  perform set_config('love_gift.allow_reset', 'on', true);
  delete from public.pairings;   -- cascades to pair_memberships
  get diagnostics v_deleted = row_count;
  perform set_config('love_gift.allow_reset', 'off', true);
  return jsonb_build_object('status', 'ok', 'pairings_deleted', v_deleted);
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges. Postgres grants EXECUTE to PUBLIC by default, so
-- revoke from everyone first, then grant exactly what each role needs.
-- -----------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function
  public.list_members(),
  public.get_activity_progress(),
  public.member_sign_in(uuid, text),
  public.member_sign_out(text),
  public.get_my_pairing(text),
  public.draw_partner(text),
  public.admin_provision_access_codes(jsonb),
  public.admin_access_code_status(),
  public.admin_pairing_history()
from public, anon, authenticated;

grant execute on function
  public.list_members(),
  public.get_activity_progress(),
  public.member_sign_in(uuid, text),
  public.member_sign_out(text),
  public.get_my_pairing(text),
  public.draw_partner(text)
to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.admin_provision_access_codes(jsonb),
      public.admin_access_code_status(),
      public.admin_pairing_history()
    to service_role;
  end if;
end $$;

-- Remove the v1 starter's public RPC if it exists (it accepted any member id).
drop function if exists public.choose_love_gift_partner(uuid);

-- -----------------------------------------------------------------------------
-- Realtime: publish the counters row only.
-- -----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.activity_progress;
exception
  when duplicate_object then null;   -- already published
  when undefined_object then null;   -- no Realtime (e.g. plain Postgres in tests)
end $$;
