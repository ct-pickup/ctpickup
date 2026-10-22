-- ============================================================================================================================
-- DEV ONLY.  NEVER RUN THIS ON PRODUCTION.  Production already has the real pickup_runs table.
-- ============================================================================================================================
-- This is NOT a migration and must never be placed under supabase/migrations.
--
-- Why it exists: the repo only ALTERs public.pickup_runs (the original CREATE TABLE lives only in production), so on an empty dev
-- project the migration 20261023000000_games_at_fields.sql refuses to run ("public.pickup_runs does not exist").
--
-- This file is the smallest stand-in that lets a dev database CREATE a game (POST /api/sessions/create) and OPEN its page
-- (mobile/app/session/[id].tsx). It is idempotent: create table if not exists / add column if not exists / drop policy if exists.
-- Run it more than once safely. If the real pickup_runs ever exists in the target database, every statement here is a no-op
-- apart from adding any missing column and re-creating the two RLS policies named below.
--
-- ORDER:  1) scripts/dev/fields_stub_tables.sql   (profiles + is_admin_uid, plus the Fields migrations 20261012* .. 20261022*)
--         2) THIS FILE
--         3) supabase/migrations/20261023000000_games_at_fields.sql   (adds pickup_runs.venue_key / venue_request_id; not edited)
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/dev/dev_pickup_runs_stub.sql
--
-- Creates:  type session_level (if missing), public.pickup_runs, public.pickup_run_rsvps (minimal), RLS policies on both, and a few
--           nullable profile columns the create route and game page read (only if public.profiles exists).
-- Does NOT create pickup_runs.venue_key or pickup_runs.venue_request_id: the games_at_fields migration adds those.
-- ============================================================================================================================

begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles does not exist. Run scripts/dev/fields_stub_tables.sql first.';
  end if;
  if to_regprocedure('public.is_admin_uid(uuid)') is null then
    raise exception 'public.is_admin_uid(uuid) does not exist. Run scripts/dev/fields_stub_tables.sql first.';
  end if;
  if to_regclass('public.venues') is null then
    raise exception 'public.venues does not exist. Apply the Fields migrations (20261012* onwards) first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Columns of profiles that the create route (nearest_venue) and the game page (playing_position, avatar_url, zip_code) read.
-- All nullable, all "if not exists": the real profiles table already has them.
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists nearest_venue text;
alter table public.profiles add column if not exists playing_position text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists zip_code text;
alter table public.profiles add column if not exists tier_rank integer;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 20260708000000_sessions_map.sql creates this enum; pickup_runs.level uses it.
-- ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  create type public.session_level as enum ('casual', 'competitive', 'elite');
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- pickup_runs: the game. Base columns first (what the original production table has and the create route / game page use) ...
-- ---------------------------------------------------------------------------------------------------------------------------
create table if not exists public.pickup_runs (
  id            uuid primary key default gen_random_uuid(),
  title         text,
  location_text text,
  start_at      timestamptz,
  capacity      integer not null default 10,
  fee_cents     integer not null default 0,
  status        text not null default 'planning',   -- planning | active | completed | cancelled
  run_type      text not null default 'public',      -- public | select (invite only)
  format        text,                                -- 5v5, 6v6, 7v7, Open
  created_by    uuid references public.profiles (id) on delete set null,   -- the host
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ... then every column the migrations in supabase/migrations add (copied from their ALTERs), plus the columns the create route
-- inserts and the game page reads that no migration in the repo defines (open_tier_rank, tiered_pricing, tier_session_id).
alter table public.pickup_runs add column if not exists is_current          boolean not null default false;     -- 20260404180000
alter table public.pickup_runs add column if not exists outreach_started_at timestamptz;                         -- 20260406120000
alter table public.pickup_runs add column if not exists auto_managed        boolean not null default false;
alter table public.pickup_runs add column if not exists auto_cp_24h_at      timestamptz;
alter table public.pickup_runs add column if not exists auto_cp_12h_at      timestamptz;
alter table public.pickup_runs add column if not exists auto_cp_6h_at       timestamptz;
alter table public.pickup_runs add column if not exists auto_cp_1h_at       timestamptz;
alter table public.pickup_runs add column if not exists service_region      text;                                -- 20260502130000
alter table public.pickup_runs add column if not exists next_wave_at        timestamptz;                         -- 20260511120000
alter table public.pickup_runs add column if not exists current_wave        integer;
alter table public.pickup_runs add column if not exists locked_at           timestamptz;                         -- 20260514120000
alter table public.pickup_runs add column if not exists admin_fee_cents     integer not null default 0;          -- 20260516210000
alter table public.pickup_runs add column if not exists wave_state          jsonb;                               -- 20260518140000
alter table public.pickup_runs add column if not exists venue_zip_code      text;                                -- 20260528120000
alter table public.pickup_runs add column if not exists latitude            double precision;                    -- 20260708000000
alter table public.pickup_runs add column if not exists longitude           double precision;
alter table public.pickup_runs add column if not exists level               public.session_level;
alter table public.pickup_runs add column if not exists spots_taken         integer not null default 0;
alter table public.pickup_runs add column if not exists voting_notif_sent   boolean not null default false;     -- 20260729000000
alter table public.pickup_runs add column if not exists field_photo_url     text;                                -- 20261002120000
alter table public.pickup_runs add column if not exists time_tbd            boolean not null default false;     -- 20261004000000
alter table public.pickup_runs add column if not exists min_star            numeric(2, 1);                       -- 20261011000000
alter table public.pickup_runs add column if not exists open_tier_rank      integer;                             -- inserted by /api/sessions/create
alter table public.pickup_runs add column if not exists tiered_pricing      boolean not null default false;      -- inserted by /api/sessions/create
alter table public.pickup_runs add column if not exists tier_session_id     uuid;                                -- read by the game page (no FK: tier_sessions is not stubbed)

-- is_completed is a generated column in production (20260708000000). Added only if absent.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pickup_runs' and column_name = 'is_completed') then
    alter table public.pickup_runs add column is_completed boolean generated always as (status = 'completed') stored;
  end if;
end $$;

-- 20261011000000 adds half-star steps only.
alter table public.pickup_runs drop constraint if exists pickup_runs_min_star_half_step;
alter table public.pickup_runs add constraint pickup_runs_min_star_half_step
  check (min_star is null or (min_star between 0.5 and 5.0 and (min_star * 2) = round(min_star * 2)));

create index if not exists pickup_runs_start_at_idx on public.pickup_runs (start_at asc);   -- 20260708000000
create index if not exists pickup_runs_created_by_idx on public.pickup_runs (created_by);

-- ---------------------------------------------------------------------------------------------------------------------------
-- pickup_run_rsvps: the game page lists who is going. Only the columns it reads, plus the unique key the RSVP route upserts on.
-- Joining a game (payments, waitlists, tiers) is NOT supported by this stub.
-- ---------------------------------------------------------------------------------------------------------------------------
create table if not exists public.pickup_run_rsvps (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.pickup_runs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'confirmed',   -- confirmed | pending_payment | waitlist | cancelled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, user_id)
);
create index if not exists pickup_run_rsvps_run_idx on public.pickup_run_rsvps (run_id);

-- ---------------------------------------------------------------------------------------------------------------------------
-- RLS, the simplest thing the app needs. The server routes use the service role and bypass it.
--   pickup_runs:       any signed-in user can read; the host (created_by) can insert and update; an admin can update
--   pickup_run_rsvps:  any signed-in user can read; a player writes only their own row
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.pickup_runs enable row level security;
alter table public.pickup_run_rsvps enable row level security;

revoke all on public.pickup_runs from anon;
revoke all on public.pickup_run_rsvps from anon;
grant select, insert, update on public.pickup_runs to authenticated;
grant select, insert, update, delete on public.pickup_run_rsvps to authenticated;

drop policy if exists dev_pickup_runs_select on public.pickup_runs;
create policy dev_pickup_runs_select on public.pickup_runs for select to authenticated using (true);

drop policy if exists dev_pickup_runs_insert_host on public.pickup_runs;
create policy dev_pickup_runs_insert_host on public.pickup_runs for insert to authenticated with check (created_by = auth.uid());

drop policy if exists dev_pickup_runs_update_host on public.pickup_runs;
create policy dev_pickup_runs_update_host on public.pickup_runs for update to authenticated
  using (created_by = auth.uid() or public.is_admin_uid(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin_uid(auth.uid()));

drop policy if exists dev_pickup_run_rsvps_select on public.pickup_run_rsvps;
create policy dev_pickup_run_rsvps_select on public.pickup_run_rsvps for select to authenticated using (true);

drop policy if exists dev_pickup_run_rsvps_write_own on public.pickup_run_rsvps;
create policy dev_pickup_run_rsvps_write_own on public.pickup_run_rsvps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;

-- Undo (dev only; deletes every game in this dev database):
-- drop table if exists public.pickup_run_rsvps;
-- drop table if exists public.pickup_runs cascade;
