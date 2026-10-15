-- "Record the reply": an admin records what a venue answered to a field request, optionally applies it to the field page,
-- and every change to a venue is written to an audit log that can be undone.
--
-- Additive; safe to run more than once. Depends on 20261012000000 (venues), 20261012000100 (venue_requests) and is_admin_uid().
--   * venues gains: residency_rule, availability_notes, contact_text
--   * venue_replies: one row per recorded reply (admin only)
--   * venue_data_events: audit log of venue field changes (admin only), with undo markers
-- Writes happen on the server (service role), which bypasses RLS; the policies below are for admin reads and manual fixes.

begin;

alter table public.venues add column if not exists residency_rule text;
alter table public.venues add column if not exists availability_notes text;
alter table public.venues add column if not exists contact_text text;

comment on column public.venues.residency_rule is 'Who may book: e.g. Residents only, Non-resident fee, Open to all.';
comment on column public.venues.availability_notes is 'Dated notes about availability (a denial, no field on a day). Not a permanent change to the venue.';
comment on column public.venues.contact_text is 'Who to contact at the venue (name, email, phone) as recorded from a reply.';

-- ---------------------------------------------------------------------------
-- venue_replies
-- ---------------------------------------------------------------------------
create table if not exists public.venue_replies (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references public.venue_requests (id) on delete cascade,
  venue_key          text not null references public.venues (venue_key) on delete restrict,
  replied_by_name    text,
  replied_by_contact text,
  replied_at         date not null default current_date,
  outcome            text not null check (outcome in ('approved', 'denied', 'needs_permit', 'pending', 'no_answer')),
  price_amount       numeric(10, 2) check (price_amount is null or price_amount >= 0),
  price_unit         text check (price_unit is null or price_unit in ('hour', 'game', 'season', 'day')),
  permit_required    text check (permit_required is null or permit_required in ('yes', 'no')),
  residency_rule     text check (residency_rule is null or residency_rule in ('residents_only', 'non_resident_fee', 'open')),
  how_to_book        text,
  contact            text,
  notes              text,
  from_venue         boolean not null default true,
  no_field_that_day  boolean not null default false,
  apply_to_venue     boolean not null default true,
  apply_mode         text not null default 'none' check (apply_mode in ('none', 'apply', 'availability')),
  previous_status    text,
  new_status         text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  undone_at          timestamptz,
  undone_by          uuid references auth.users (id) on delete set null
);

create index if not exists venue_replies_request_idx on public.venue_replies (request_id, created_at desc);
create index if not exists venue_replies_venue_idx on public.venue_replies (venue_key, created_at desc);

alter table public.venue_replies enable row level security;
revoke all on public.venue_replies from anon, authenticated;
grant select, insert, update, delete on public.venue_replies to authenticated;

drop policy if exists venue_replies_admin_all on public.venue_replies;
create policy venue_replies_admin_all on public.venue_replies
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- venue_data_events: audit log
-- ---------------------------------------------------------------------------
create table if not exists public.venue_data_events (
  id          uuid primary key default gen_random_uuid(),
  venue_key   text not null references public.venues (venue_key) on delete cascade,
  field       text not null,
  old_value   jsonb,
  new_value   jsonb,
  source      text not null check (source in ('reply', 'research', 'osm', 'player')),
  request_id  uuid references public.venue_requests (id) on delete set null,
  reply_id    uuid references public.venue_replies (id) on delete set null,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now(),
  undone_at   timestamptz,
  undone_by   uuid references auth.users (id) on delete set null
);

comment on table public.venue_data_events is 'Every change made to a venue field by a reply, research import, OSM import or player suggestion, with the old and new value so it can be undone.';

create index if not exists venue_data_events_venue_idx on public.venue_data_events (venue_key, changed_at desc);
create index if not exists venue_data_events_reply_idx on public.venue_data_events (reply_id);
create index if not exists venue_data_events_request_idx on public.venue_data_events (request_id);

alter table public.venue_data_events enable row level security;
revoke all on public.venue_data_events from anon, authenticated;
grant select, insert, update on public.venue_data_events to authenticated;

drop policy if exists venue_data_events_admin_read on public.venue_data_events;
create policy venue_data_events_admin_read on public.venue_data_events
  for select to authenticated using (public.is_admin_uid(auth.uid()));

drop policy if exists venue_data_events_admin_write on public.venue_data_events;
create policy venue_data_events_admin_write on public.venue_data_events
  for insert to authenticated with check (public.is_admin_uid(auth.uid()));

drop policy if exists venue_data_events_admin_update on public.venue_data_events;
create policy venue_data_events_admin_update on public.venue_data_events
  for update to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.venue_data_events;
-- drop table if exists public.venue_replies;
-- alter table public.venues drop column if exists contact_text;
-- alter table public.venues drop column if exists availability_notes;
-- alter table public.venues drop column if exists residency_rule;
-- commit;
-- ============================================================
