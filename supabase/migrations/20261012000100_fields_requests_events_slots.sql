-- Fields, step 2 of 3: venue requests, venue calendars, schedule slots and field events (table field_events).
-- Additive. Depends on 20261012000000_fields_venues_schools.sql.
--
--   * venue_requests: a player can create and read only their own; admins can read and update all.
--     A player can only create a request in status 'new' with no admin fields set.
--   * venue_calendars: admin only (the feed URL can be a private link). Signed-in users learn whether a venue's calendar
--     is connected through public.venue_calendar_connected(), which exposes nothing else.
--   * schedule_slots: signed-in users read; only admins write.
--   * field_events: signed-in users read published events; only admins write. Named field_events (not events) because
--     production already has an unrelated public.events table (pickup time options) that this migration must never touch.

begin;

-- ---------------------------------------------------------------------------
-- venue_requests
-- ---------------------------------------------------------------------------
create table if not exists public.venue_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  venue_key            text not null references public.venues (venue_key) on delete restrict,
  requested_date       date not null,
  start_time           time not null,
  duration_hours       numeric(3, 1) not null default 2 check (duration_hours > 0 and duration_hours <= 8),
  players              integer not null check (players between 1 and 100),
  notes                text,
  estimate_cents       integer check (estimate_cents is null or estimate_cents >= 0),
  status               text not null default 'new'
                         check (status in ('new', 'waiting_on_school', 'approved', 'declined', 'cancelled')),
  -- Admin-only fields, written when the admin works the request.
  draft_email          text,
  school_contact_email text,
  admin_notes          text,
  status_changed_at    timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.venue_requests is 'A player asking CT to request a field for a date and time. The admin sends the email to the school by hand for now.';

create index if not exists venue_requests_user_idx on public.venue_requests (user_id, created_at desc);
create index if not exists venue_requests_status_idx on public.venue_requests (status, created_at desc);
create index if not exists venue_requests_venue_idx on public.venue_requests (venue_key, requested_date);

create or replace function public.venue_requests_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists venue_requests_touch on public.venue_requests;
create trigger venue_requests_touch
  before update on public.venue_requests
  for each row execute function public.venue_requests_touch();

alter table public.venue_requests enable row level security;
revoke all on public.venue_requests from anon, authenticated;
grant select, insert, update on public.venue_requests to authenticated;

drop policy if exists venue_requests_select_own on public.venue_requests;
create policy venue_requests_select_own on public.venue_requests
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists venue_requests_insert_own on public.venue_requests;
create policy venue_requests_insert_own on public.venue_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'new'
    and draft_email is null
    and school_contact_email is null
    and admin_notes is null
  );

drop policy if exists venue_requests_admin_select on public.venue_requests;
create policy venue_requests_admin_select on public.venue_requests
  for select to authenticated
  using (public.is_admin_uid(auth.uid()));

drop policy if exists venue_requests_admin_update on public.venue_requests;
create policy venue_requests_admin_update on public.venue_requests
  for update to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- venue_calendars
-- ---------------------------------------------------------------------------
create table if not exists public.venue_calendars (
  venue_key      text primary key references public.venues (venue_key) on delete cascade,
  provider       text check (provider in ('google', 'ical', 'town_feed')),
  calendar_url   text,
  sync_status    text not null default 'not_connected' check (sync_status in ('live', 'failed', 'not_connected')),
  last_synced_at timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  connected_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.venue_calendars is 'One row per venue whose calendar we read. Only a live, recently synced calendar lets the app show a time as Open.';

drop trigger if exists venue_calendars_touch_updated_at on public.venue_calendars;
create trigger venue_calendars_touch_updated_at
  before update on public.venue_calendars
  for each row execute function public.fields_touch_updated_at();

alter table public.venue_calendars enable row level security;
revoke all on public.venue_calendars from anon, authenticated;
grant select, insert, update, delete on public.venue_calendars to authenticated;

drop policy if exists venue_calendars_admin_all on public.venue_calendars;
create policy venue_calendars_admin_all on public.venue_calendars
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- Which venues have a connected calendar? Live and synced within 24 hours. A failed or stale sync is NOT connected,
-- so the app shows Unknown. Exposes only venue keys, never feed URLs.
create or replace function public.connected_venue_keys()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select c.venue_key
  from public.venue_calendars c
  where c.sync_status = 'live'
    and c.last_synced_at is not null
    and c.last_synced_at > now() - interval '24 hours';
$$;

revoke all on function public.connected_venue_keys() from public, anon;
grant execute on function public.connected_venue_keys() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- schedule_slots
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_slots (
  id          uuid primary key default gen_random_uuid(),
  venue_key   text not null references public.venues (venue_key) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null check (status in ('booked', 'pending')),
  title       text,
  source      text not null default 'manual' check (source in ('calendar', 'manual', 'request')),
  request_id  uuid references public.venue_requests (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

comment on table public.schedule_slots is 'Known occupied times only (booked or pending). Open is never stored: the app derives it, and only when the venue calendar is connected.';

create index if not exists schedule_slots_venue_time_idx on public.schedule_slots (venue_key, starts_at);
create index if not exists schedule_slots_request_idx on public.schedule_slots (request_id) where request_id is not null;

drop trigger if exists schedule_slots_touch_updated_at on public.schedule_slots;
create trigger schedule_slots_touch_updated_at
  before update on public.schedule_slots
  for each row execute function public.fields_touch_updated_at();

alter table public.schedule_slots enable row level security;
revoke all on public.schedule_slots from anon, authenticated;
grant select, insert, update, delete on public.schedule_slots to authenticated;

drop policy if exists schedule_slots_select_signed_in on public.schedule_slots;
create policy schedule_slots_select_signed_in on public.schedule_slots
  for select to authenticated using (true);

drop policy if exists schedule_slots_admin_write on public.schedule_slots;
create policy schedule_slots_admin_write on public.schedule_slots
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- field_events (NOT public.events: production has an unrelated table by that name)
-- ---------------------------------------------------------------------------
create table if not exists public.field_events (
  id            uuid primary key default gen_random_uuid(),
  venue_key     text references public.venues (venue_key) on delete set null,
  title         text not null,
  event_type    text not null check (event_type in ('pickup', 'league', 'tournament')),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  capacity      integer check (capacity is null or capacity > 0),
  joined_count  integer not null default 0 check (joined_count >= 0),
  price_cents   integer check (price_cents is null or price_cents >= 0),
  price_unit    text check (price_unit in ('player', 'team')),
  source        text not null default 'manual' check (source in ('manual', 'imported')),
  source_note   text,
  is_published  boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.field_events is 'Games, leagues and tournaments at venues. price_cents null or 0 means free. source = imported for town-calendar events.';

create index if not exists field_events_starts_idx on public.field_events (starts_at);
create index if not exists field_events_venue_idx on public.field_events (venue_key, starts_at);
create index if not exists field_events_type_idx on public.field_events (event_type, starts_at);

drop trigger if exists field_events_touch_updated_at on public.field_events;
create trigger field_events_touch_updated_at
  before update on public.field_events
  for each row execute function public.fields_touch_updated_at();

alter table public.field_events enable row level security;
revoke all on public.field_events from anon, authenticated;
grant select, insert, update, delete on public.field_events to authenticated;

drop policy if exists field_events_select_signed_in on public.field_events;
create policy field_events_select_signed_in on public.field_events
  for select to authenticated
  using (is_published or public.is_admin_uid(auth.uid()));

drop policy if exists field_events_admin_write on public.field_events;
create policy field_events_admin_write on public.field_events
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.field_events;
-- drop table if exists public.schedule_slots;
-- drop function if exists public.connected_venue_keys();
-- drop table if exists public.venue_calendars;
-- drop table if exists public.venue_requests;
-- drop function if exists public.venue_requests_touch();
-- commit;
-- ============================================================
