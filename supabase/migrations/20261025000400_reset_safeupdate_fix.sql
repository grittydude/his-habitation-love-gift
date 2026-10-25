-- Supabase loads the pg-safeupdate extension for API (PostgREST) requests,
-- which rejects DELETE/UPDATE statements without a WHERE clause (SQLSTATE
-- 21000). The rehearsal reset used a bare `delete from public.pairings`, so it
-- worked from the SQL Editor but failed when called from the /admin console.
-- Same behaviour, with an explicit WHERE.
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
  delete from public.pairings where true;   -- cascades to pair_memberships
  get diagnostics v_deleted = row_count;
  perform set_config('love_gift.allow_reset', 'off', true);
  return jsonb_build_object('status', 'ok', 'pairings_deleted', v_deleted);
end;
$$;

revoke all on function private.admin_reset_pairings(text) from public, anon, authenticated;
