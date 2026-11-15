-- Makes a scratch database look like production for the tables rated tournaments touch.
-- Facts from a read-only production query (policy and trigger NAMES), plus the real bodies from this repo's migrations where they exist.
-- Scratch ONLY. Never run against a real database. Idempotent. Needs 00_stubs.sql and the migrations listed in README.md first.
--
-- Policies in production (exact names):
--   pickup_run_results:  pickup_run_results_admin_write (ALL), pickup_run_results_select_all (SELECT)
--   pickup_run_rsvps:    pickup_run_rsvps_admin_insert (INSERT), pickup_run_rsvps_admin_select (SELECT), pickup_run_rsvps_admin_update (UPDATE),
--                        pickup_run_rsvps_select_own_or_run (SELECT)
--   pickup_runs:         pickup_runs_insert_admin (INSERT), pickup_runs_select_authenticated (SELECT), pickup_runs_update_admin (UPDATE)
-- Triggers in production:
--   pickup_run_results:  pickup_results_posted_by, pickup_results_reopened, pickup_results_version_bump, player_game_stats_on_results
--   pickup_run_rsvps:    analytics_rsvp_change, trg_ensure_player_rating, trg_sync_pickup_run_spots
--   pickup_runs:         trg_guard_pickup_run_field_photo, trg_pickup_runs_block_delete_with_players, trg_sync_pickup_runs_legacy_cols
-- The bodies of trg_ensure_player_rating and trg_sync_pickup_runs_legacy_cols are NOT in this repo. Here they are STAND-INS that only write a
-- line to prod_shape_trigger_log, so the tests can prove whether a hidden tournament game ever fires them. Replace them with the real
-- bodies (select pg_get_functiondef from production, read only) if you want the tests to exercise those too.

alter table public.pickup_runs add column if not exists field_photo_url text;
alter table public.pickup_runs add column if not exists spots_taken integer not null default 0;
alter table public.pickup_run_rsvps add column if not exists id uuid not null default gen_random_uuid();

-- the table the analytics trigger writes to (the real one has more checks; this has the columns the trigger uses)
create table if not exists public.analytics_events (id bigserial primary key, event_key text not null unique, occurred_at timestamptz not null default now(), user_id uuid, region text, name text not null, properties jsonb not null default '{}'::jsonb, source text not null);

create table if not exists public.prod_shape_trigger_log (id bigserial primary key, trigger_name text, table_name text, op text, at timestamptz default now());

-- stand-ins for the two triggers whose bodies are not in the repo
create or replace function public.prod_shape_log_trigger() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  insert into public.prod_shape_trigger_log (trigger_name, table_name, op) values (tg_name, tg_table_name, tg_op);
  return coalesce(new, old);
end $f$;
drop trigger if exists trg_ensure_player_rating on public.pickup_run_rsvps;
create trigger trg_ensure_player_rating after insert or update on public.pickup_run_rsvps for each row execute function public.prod_shape_log_trigger();
drop trigger if exists trg_sync_pickup_runs_legacy_cols on public.pickup_runs;
create trigger trg_sync_pickup_runs_legacy_cols before insert or update on public.pickup_runs for each row execute function public.prod_shape_log_trigger();

-- the real field photo guard
create or replace function public.guard_pickup_run_field_photo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.field_photo_url is distinct from old.field_photo_url
     and auth.uid() is not null
     and auth.uid() is distinct from new.created_by
     and not public.is_admin_uid(auth.uid()) then
    raise exception 'Only the session host or an admin can set the field photo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_pickup_run_field_photo on public.pickup_runs;
create trigger trg_guard_pickup_run_field_photo
  before update of field_photo_url on public.pickup_runs
  for each row execute function public.guard_pickup_run_field_photo();

-- row level security and the exact policies
alter table public.pickup_runs enable row level security;
drop policy if exists pickup_runs_select_authenticated on public.pickup_runs;
create policy pickup_runs_select_authenticated on public.pickup_runs for select to authenticated using (true);
drop policy if exists pickup_runs_insert_admin on public.pickup_runs;
create policy pickup_runs_insert_admin on public.pickup_runs for insert to authenticated with check (public.is_admin_uid(auth.uid()));
drop policy if exists pickup_runs_update_admin on public.pickup_runs;
create policy pickup_runs_update_admin on public.pickup_runs for update to authenticated using (public.is_admin_uid(auth.uid())) with check (public.is_admin_uid(auth.uid()));
drop policy if exists pickup_runs_delete_admin on public.pickup_runs;

alter table public.pickup_run_rsvps enable row level security;
drop policy if exists pickup_run_rsvps_select_own_or_run on public.pickup_run_rsvps;
create policy pickup_run_rsvps_select_own_or_run on public.pickup_run_rsvps for select to authenticated using (user_id = auth.uid() or public.is_admin_uid(auth.uid()));
drop policy if exists pickup_run_rsvps_admin_select on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_select on public.pickup_run_rsvps for select to authenticated using (public.is_admin_uid(auth.uid()));
drop policy if exists pickup_run_rsvps_admin_insert on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_insert on public.pickup_run_rsvps for insert to authenticated with check (public.is_admin_uid(auth.uid()));
drop policy if exists pickup_run_rsvps_admin_update on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_update on public.pickup_run_rsvps for update to authenticated using (public.is_admin_uid(auth.uid())) with check (public.is_admin_uid(auth.uid()));

-- pickup_run_results already has pickup_run_results_admin_write and pickup_run_results_select_all from 20260508120000_pickup_run_results.sql
alter table public.pickup_run_results enable row level security;

-- Supabase hands the API roles table privileges; RLS then decides rows.
grant select, insert, update, delete on public.pickup_runs, public.pickup_run_results, public.pickup_run_rsvps, public.pickup_run_team_assignments, public.profiles to authenticated, anon;
grant select on public.prod_shape_trigger_log to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
