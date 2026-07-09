-- Sessions map: schema, realtime, and spots_taken trigger
-- Run this in the Supabase SQL editor or via supabase db push.

-- 1. Level enum
do $$ begin
  create type session_level as enum ('casual', 'competitive', 'elite');
exception when duplicate_object then null;
end $$;

-- 2. Sessions table (create if not exists, then add map columns)
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table sessions
  add column if not exists title        text          not null default '',
  add column if not exists status       text          not null default 'draft',
  add column if not exists starts_at    timestamptz   not null default now(),
  add column if not exists format       text          not null default '7v7',
  add column if not exists venue_name   text          not null default '',
  add column if not exists latitude     double precision,
  add column if not exists longitude    double precision,
  add column if not exists level        session_level not null default 'casual',
  add column if not exists capacity     integer       not null default 14,
  add column if not exists spots_taken  integer       not null default 0,
  add column if not exists price_cents  integer       not null default 0;

-- 3. Index for ordered, time-bounded queries
create index if not exists sessions_starts_at_idx on sessions (starts_at asc);

-- 4. Bookings table (must exist for the trigger below)
create table if not exists bookings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions (id) on delete cascade,
  user_id     uuid not null,
  created_at  timestamptz not null default now()
);

create index if not exists bookings_session_id_idx on bookings (session_id);

-- 5. RLS (enable but keep permissive for now; tighten per auth model)
alter table sessions enable row level security;
alter table bookings  enable row level security;

create policy "sessions: published rows are public"
  on sessions for select
  using (status = 'published');

create policy "bookings: users see their own"
  on bookings for select
  using (user_id = auth.uid());

create policy "bookings: users can insert their own"
  on bookings for insert
  with check (user_id = auth.uid());

create policy "bookings: users can delete their own"
  on bookings for delete
  using (user_id = auth.uid());

-- 6. Trigger: keep spots_taken in sync, with row lock to prevent oversell
create or replace function sync_session_spots()
returns trigger
language plpgsql
as $$
declare
  v_capacity    integer;
  v_spots_taken integer;
begin
  if TG_OP = 'INSERT' then
    -- Lock the session row so concurrent inserts serialize here.
    select capacity, spots_taken
      into v_capacity, v_spots_taken
      from sessions
     where id = NEW.session_id
       for update;

    if not found then
      raise exception 'session_not_found: %', NEW.session_id;
    end if;

    if v_spots_taken >= v_capacity then
      raise exception 'session_full: session % has no spots remaining', NEW.session_id;
    end if;

    update sessions
       set spots_taken = spots_taken + 1
     where id = NEW.session_id;

    return NEW;

  elsif TG_OP = 'DELETE' then
    update sessions
       set spots_taken = greatest(0, spots_taken - 1)
     where id = OLD.session_id;

    return OLD;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_session_spots on bookings;
create trigger trg_sync_session_spots
  before insert or delete on bookings
  for each row execute function sync_session_spots();

-- 7. Enable Supabase Realtime on sessions so the map pin updates live
-- (Realtime is enabled per-table in the Supabase dashboard under
--  Database → Replication, or via the publication below.)
alter publication supabase_realtime add table sessions;
