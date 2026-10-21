-- =====================================================================================================================
-- DEV ONLY. Run this ONCE on the DEV database (plratvhywezrtedwipsm) that already has the Fields tables from the old
-- 20261012000100 migration, where the table was called public.events. Safe to run again (it does nothing the second time).
-- NEVER run it on production: production's public.events is an unrelated table (pickup time options) and must not be touched.
-- The script refuses to rename any public.events that does not have the Fields columns (event_type, is_published, venue_key).
--
-- Renames: table events -> field_events, its constraints/indexes (events_* -> field_events_*), trigger and the two policies.
-- Afterwards the dev database has the same object names as a fresh run of the updated 20261012000100 migration.
-- =====================================================================================================================
begin;

do $$
declare
  r record;
  new_name text;
begin
  -- 1. The table. Only a table with the Fields shape is renamed, and only if field_events does not exist yet.
  if to_regclass('public.field_events') is null
     and to_regclass('public.events') is not null
     and (
       select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'events' and column_name in ('event_type', 'is_published', 'venue_key', 'starts_at')
     ) = 4
  then
    alter table public.events rename to field_events;
    raise notice 'renamed public.events to public.field_events';
  end if;

  if to_regclass('public.field_events') is null then
    raise notice 'public.field_events does not exist; nothing to do (run the updated 20261012000100 migration instead)';
    return;
  end if;

  -- 2. Constraints (the primary key's index is renamed with it).
  for r in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.field_events'::regclass and con.conname like 'events\_%'
  loop
    new_name := 'field_' || r.conname;
    if not exists (select 1 from pg_constraint where conname = new_name and conrelid = 'public.field_events'::regclass) then
      execute format('alter table public.field_events rename constraint %I to %I', r.conname, new_name);
    end if;
  end loop;

  -- 3. Remaining indexes.
  for r in
    select i.indexname from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'field_events' and i.indexname like 'events\_%'
  loop
    new_name := 'field_' || r.indexname;
    if to_regclass('public.' || quote_ident(new_name)) is null then
      execute format('alter index public.%I rename to %I', r.indexname, new_name);
    end if;
  end loop;

  -- 4. Trigger.
  for r in
    select t.tgname from pg_trigger t
     where t.tgrelid = 'public.field_events'::regclass and not t.tgisinternal and t.tgname like 'events\_%'
  loop
    execute format('alter trigger %I on public.field_events rename to %I', r.tgname, 'field_' || r.tgname);
  end loop;

  -- 5. Policies.
  for r in
    select p.policyname from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'field_events' and p.policyname like 'events\_%'
  loop
    execute format('alter policy %I on public.field_events rename to %I', r.policyname, 'field_' || r.policyname);
  end loop;

  comment on table public.field_events is 'Games, leagues and tournaments at venues. price_cents null or 0 means free. source = imported for town-calendar events.';
end $$;

commit;

-- Check (read-only). Expect: no rows from the first query; the second lists field_events_* objects.
select 'still named events_*' as problem, c.relname as object
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname like 'events\_%'
   and exists (select 1 from pg_index x where x.indexrelid = c.oid and x.indrelid = to_regclass('public.field_events'));
select 'field_events object' as what, conname as name from pg_constraint where conrelid = to_regclass('public.field_events')
union all select 'index', indexname from pg_indexes where schemaname = 'public' and tablename = 'field_events'
union all select 'policy', policyname from pg_policies where schemaname = 'public' and tablename = 'field_events'
union all select 'trigger', tgname from pg_trigger where tgrelid = to_regclass('public.field_events') and not tgisinternal
order by 1, 2;
