-- One-off cleanup for projects where the old v1 starter `setup.sql` was run.
-- The v1 tables used a different (incorrect) roster and had public read access
-- to the pairing ledger, so they are dropped rather than migrated.
--
-- Run this ONLY before the real event starts. It refuses to run if the v1
-- table holds any pairings, so it cannot destroy real results by accident.
do $$
begin
  if to_regclass('public.pairings') is not null
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'pairings' and column_name = 'initiated_by')
  then
    if exists (select 1 from public.pairings) then
      raise exception 'v1 pairings table is not empty — export it first, then delete its rows manually if you are sure.';
    end if;
    drop table public.pairings;
  end if;

  if to_regclass('public.members') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'members' and column_name = 'name')
  then
    drop table public.members;
  end if;

  drop function if exists public.choose_love_gift_partner(uuid);
end $$;
