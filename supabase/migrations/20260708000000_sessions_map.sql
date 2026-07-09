-- Sessions map migration
--
-- SAFETY: pickup_runs is the production table for pickup games.
-- This migration only ADDs new columns to it — it never drops or alters
-- existing columns, and it does not touch pickup_run_rsvps rows.
--
-- The `sessions` table below is a net-new empty table (no production data).
-- It is kept to avoid dropping it if already created; the app queries pickup_runs.

-- ── 1. Level enum (new concept — not on existing runs) ─────────────────────
do $$ begin
  create type session_level as enum ('casual', 'competitive', 'elite');
exception when duplicate_object then null;
end $$;

-- ── 2. Add map columns to pickup_runs ──────────────────────────────────────
alter table public.pickup_runs
  add column if not exists latitude    double precision,
  add column if not exists longitude   double precision,
  add column if not exists level       session_level,
  add column if not exists spots_taken integer not null default 0;

-- ── 3. Index for map time-range queries ────────────────────────────────────
create index if not exists pickup_runs_start_at_idx on public.pickup_runs (start_at asc);

-- ── 4. Backfill spots_taken from existing confirmed RSVPs ──────────────────
-- Safe to run multiple times (idempotent via absolute count, not delta).
update public.pickup_runs pr
set spots_taken = (
  select count(*)
  from public.pickup_run_rsvps r
  where r.run_id = pr.id
    and r.status = 'confirmed'
);

-- ── 5. Trigger on pickup_run_rsvps to keep spots_taken live ────────────────
--    INSERT status=confirmed  → increment (with capacity check + row lock)
--    UPDATE confirmed→canceled → decrement
--    UPDATE canceled→confirmed → increment (with capacity check + row lock)
--    DELETE of confirmed row   → decrement
create or replace function sync_pickup_run_spots()
returns trigger
language plpgsql
as $$
declare
  v_capacity    integer;
  v_spots_taken integer;
begin

  -- ── INSERT ───────────────────────────────────────────────────────────────
  if TG_OP = 'INSERT' then
    if NEW.status != 'confirmed' then
      return NEW;  -- declined/canceled inserts don't affect spot count
    end if;

    select capacity, spots_taken
      into v_capacity, v_spots_taken
      from public.pickup_runs
     where id = NEW.run_id
       for update;  -- serialize concurrent confirmed inserts

    if not found then
      raise exception 'pickup_run_not_found: %', NEW.run_id;
    end if;

    if v_spots_taken >= v_capacity then
      raise exception 'session_full: pickup run % has no spots remaining', NEW.run_id;
    end if;

    update public.pickup_runs
       set spots_taken = spots_taken + 1
     where id = NEW.run_id;

    return NEW;

  -- ── DELETE ───────────────────────────────────────────────────────────────
  elsif TG_OP = 'DELETE' then
    if OLD.status = 'confirmed' then
      update public.pickup_runs
         set spots_taken = greatest(0, spots_taken - 1)
       where id = OLD.run_id;
    end if;
    return OLD;

  -- ── UPDATE OF status ─────────────────────────────────────────────────────
  elsif TG_OP = 'UPDATE' then
    -- confirmed → canceled (or cancelled — both spellings exist in the codebase)
    if OLD.status = 'confirmed' and NEW.status in ('canceled', 'cancelled') then
      update public.pickup_runs
         set spots_taken = greatest(0, spots_taken - 1)
       where id = NEW.run_id;

    -- canceled → confirmed (re-activation)
    elsif OLD.status in ('canceled', 'cancelled') and NEW.status = 'confirmed' then
      select capacity, spots_taken
        into v_capacity, v_spots_taken
        from public.pickup_runs
       where id = NEW.run_id
         for update;

      if v_spots_taken >= v_capacity then
        raise exception 'session_full: pickup run % has no spots remaining', NEW.run_id;
      end if;

      update public.pickup_runs
         set spots_taken = spots_taken + 1
       where id = NEW.run_id;
    end if;

    return NEW;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_pickup_run_spots on public.pickup_run_rsvps;
create trigger trg_sync_pickup_run_spots
  before insert or delete or update of status on public.pickup_run_rsvps
  for each row execute function sync_pickup_run_spots();

-- ── 6. Empty sessions table (kept to avoid dropping it if already created) ─
-- The app does not query this table — pickup_runs is the source of truth.
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- ── 7. Enable Supabase Realtime on pickup_runs (not sessions) ──────────────
-- If pickup_runs is already in the publication this is a no-op.
do $$ begin
  alter publication supabase_realtime add table public.pickup_runs;
exception when duplicate_object then null;
end $$;
