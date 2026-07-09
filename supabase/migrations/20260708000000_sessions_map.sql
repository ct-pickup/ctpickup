-- Map migration: adds latitude, longitude, level, spots_taken to pickup_runs
-- and installs a live-sync trigger on pickup_run_rsvps.
--
-- Safe to paste into the Supabase dashboard SQL editor more than once:
-- all DDL uses IF NOT EXISTS / CREATE OR REPLACE.

-- ── 1. Level enum ──────────────────────────────────────────────────────────
do $$ begin
  create type session_level as enum ('casual', 'competitive', 'elite');
exception when duplicate_object then null;
end $$;

-- ── 2. New columns on pickup_runs ──────────────────────────────────────────
alter table public.pickup_runs
  add column if not exists latitude     double precision,
  add column if not exists longitude    double precision,
  add column if not exists level        session_level,
  add column if not exists spots_taken  integer not null default 0,
  add column if not exists is_completed boolean not null default false;

-- ── 3. Index for map time-range queries ────────────────────────────────────
create index if not exists pickup_runs_start_at_idx
  on public.pickup_runs (start_at asc);

-- ── 4. Backfill is_completed from existing completed runs ─────────────────
-- status = 'completed' is the source of truth; is_completed mirrors it so
-- analytics queries (which filter on is_completed) and the result/end-run
-- routes (which set both) stay in sync.
update public.pickup_runs
set is_completed = true
where status = 'completed';

-- ── 5. Backfill spots_taken from live RSVPs ────────────────────────────────
-- Capacity-holding statuses: confirmed + pending_payment
-- (defined in mobile/lib/pickup/waitlist.ts as PICKUP_CAPACITY_STATUSES).
-- Sets absolute count so this is safe to run multiple times.
update public.pickup_runs pr
set spots_taken = (
  select count(*)
  from public.pickup_run_rsvps r
  where r.run_id = pr.id
    and r.status in ('confirmed', 'pending_payment')
);

-- ── 6. Trigger: keep spots_taken live ──────────────────────────────────────
-- Fires BEFORE INSERT | DELETE | UPDATE OF status on pickup_run_rsvps.
--
-- pickup_rsvp_status enum values (from production):
--   capacity-holding : confirmed, pending_payment
--   non-holding      : declined, waitlist, pending_confirm (and any future values)
--
-- There is NO 'canceled' or 'cancelled' value in this enum.
create or replace function sync_pickup_run_spots()
returns trigger
language plpgsql
as $$
declare
  v_capacity    integer;
  v_spots_taken integer;
  v_old_holds   boolean;
  v_new_holds   boolean;
begin

  -- ── INSERT ─────────────────────────────────────────────────────────────
  if TG_OP = 'INSERT' then
    if NEW.status not in ('confirmed', 'pending_payment') then
      return NEW;
    end if;

    select capacity, spots_taken
      into v_capacity, v_spots_taken
      from public.pickup_runs
     where id = NEW.run_id
       for update;  -- serialize concurrent inserts

    if not found then
      raise exception 'pickup_run_not_found: %', NEW.run_id;
    end if;
    if v_spots_taken >= v_capacity then
      raise exception 'session_full: run % is at capacity', NEW.run_id;
    end if;

    update public.pickup_runs
       set spots_taken = spots_taken + 1
     where id = NEW.run_id;
    return NEW;

  -- ── DELETE ─────────────────────────────────────────────────────────────
  elsif TG_OP = 'DELETE' then
    if OLD.status in ('confirmed', 'pending_payment') then
      update public.pickup_runs
         set spots_taken = greatest(0, spots_taken - 1)
       where id = OLD.run_id;
    end if;
    return OLD;

  -- ── UPDATE OF status ───────────────────────────────────────────────────
  elsif TG_OP = 'UPDATE' then
    v_old_holds := OLD.status in ('confirmed', 'pending_payment');
    v_new_holds := NEW.status in ('confirmed', 'pending_payment');

    if v_old_holds and not v_new_holds then
      -- spot released: confirmed/pending_payment → declined (or other)
      update public.pickup_runs
         set spots_taken = greatest(0, spots_taken - 1)
       where id = NEW.run_id;

    elsif not v_old_holds and v_new_holds then
      -- spot claimed: waitlist/pending_confirm → confirmed/pending_payment
      select capacity, spots_taken
        into v_capacity, v_spots_taken
        from public.pickup_runs
       where id = NEW.run_id
         for update;

      if v_spots_taken >= v_capacity then
        raise exception 'session_full: run % is at capacity', NEW.run_id;
      end if;
      update public.pickup_runs
         set spots_taken = spots_taken + 1
       where id = NEW.run_id;
    end if;
    -- same category (both hold or both non-hold): no change
    return NEW;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_pickup_run_spots on public.pickup_run_rsvps;
create trigger trg_sync_pickup_run_spots
  before insert or delete or update of status on public.pickup_run_rsvps
  for each row execute function sync_pickup_run_spots();

-- ── 7. Realtime on pickup_runs ─────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.pickup_runs;
exception when duplicate_object then null;
end $$;
