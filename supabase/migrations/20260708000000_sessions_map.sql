-- Sessions map: schema, realtime, and spots_taken trigger
-- Run in Supabase SQL editor or via supabase db push.

-- 1. Level enum
do $$ begin
  create type session_level as enum ('casual', 'competitive', 'elite');
exception when duplicate_object then null;
end $$;

-- 2. Sessions table
-- No existing "sessions" table in production — this is a net-new table.
create table if not exists sessions (
  id          uuid          primary key default gen_random_uuid(),
  created_at  timestamptz   not null default now(),
  title       text          not null default '',
  status      text          not null default 'draft',
  starts_at   timestamptz   not null default now(),
  format      text          not null default '7v7',
  venue_name  text          not null default '',
  latitude    double precision,
  longitude   double precision,
  level       session_level not null default 'casual',
  capacity    integer       not null default 14,
  spots_taken integer       not null default 0,
  price_cents integer       not null default 0
);

create index if not exists sessions_starts_at_idx on sessions (starts_at asc);

-- 3. Bookings table
-- Uses a status column (same cancellation pattern as pickup_run_rsvps)
-- so that cancellations are a status flip, not a hard delete.
create table if not exists bookings (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references sessions (id) on delete cascade,
  user_id     uuid        not null,
  status      text        not null default 'confirmed',  -- 'confirmed' | 'canceled'
  created_at  timestamptz not null default now(),
  unique (session_id, user_id)
);

create index if not exists bookings_session_id_idx on bookings (session_id);

-- 4. RLS
alter table sessions enable row level security;
alter table bookings  enable row level security;

do $$ begin
  create policy "sessions: published rows are public"
    on sessions for select using (status = 'published');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "bookings: users see their own"
    on bookings for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "bookings: users can insert their own"
    on bookings for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "bookings: users can cancel their own"
    on bookings for update using (user_id = auth.uid())
    with check (status = 'canceled');
exception when duplicate_object then null;
end $$;

-- 5. Trigger: keep spots_taken in sync with row lock to prevent oversell.
--    Handles three events:
--      INSERT            → new booking (increment, enforce capacity)
--      DELETE            → hard delete (decrement)
--      UPDATE OF status  → cancellation flip to 'canceled' (decrement)
--                          re-activation flip away from 'canceled' (increment, enforce capacity)
create or replace function sync_session_spots()
returns trigger
language plpgsql
as $$
declare
  v_capacity    integer;
  v_spots_taken integer;
begin
  -- ── INSERT: new confirmed booking ──────────────────────────────────────
  if TG_OP = 'INSERT' then
    if NEW.status = 'canceled' then
      return NEW;  -- inserting already-canceled row is a no-op for spot count
    end if;

    select capacity, spots_taken
      into v_capacity, v_spots_taken
      from sessions
     where id = NEW.session_id
       for update;  -- serialize concurrent inserts

    if not found then
      raise exception 'session_not_found: %', NEW.session_id;
    end if;

    if v_spots_taken >= v_capacity then
      raise exception 'session_full: session % has no spots remaining', NEW.session_id;
    end if;

    update sessions set spots_taken = spots_taken + 1 where id = NEW.session_id;
    return NEW;

  -- ── DELETE: hard delete (admin tooling / cascade) ──────────────────────
  elsif TG_OP = 'DELETE' then
    if OLD.status != 'canceled' then
      update sessions
         set spots_taken = greatest(0, spots_taken - 1)
       where id = OLD.session_id;
    end if;
    return OLD;

  -- ── UPDATE: cancellation or re-activation via status flip ──────────────
  elsif TG_OP = 'UPDATE' then
    -- becoming canceled → free the spot
    if OLD.status != 'canceled' and NEW.status = 'canceled' then
      update sessions
         set spots_taken = greatest(0, spots_taken - 1)
       where id = NEW.session_id;

    -- un-canceling → re-claim the spot with capacity check
    elsif OLD.status = 'canceled' and NEW.status != 'canceled' then
      select capacity, spots_taken
        into v_capacity, v_spots_taken
        from sessions
       where id = NEW.session_id
         for update;

      if v_spots_taken >= v_capacity then
        raise exception 'session_full: session % has no spots remaining', NEW.session_id;
      end if;

      update sessions set spots_taken = spots_taken + 1 where id = NEW.session_id;
    end if;

    return NEW;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_session_spots on bookings;
create trigger trg_sync_session_spots
  before insert or delete or update of status on bookings
  for each row execute function sync_session_spots();

-- 6. Enable Supabase Realtime on sessions
alter publication supabase_realtime add table sessions;
