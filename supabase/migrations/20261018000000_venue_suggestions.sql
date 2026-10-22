-- Fields: player suggestions ("Suggest a field", "Report a problem") and confirmations ("Looks right").
-- Additive. Depends on 20261012000000_fields_venues_schools.sql, is_admin_uid(), and 20261014000000_venues_setting.sql.
-- DEV project only until it has been tried there.
--
--   * venue_suggestions: a player proposes a new field (kind new_venue, with a pin) or a correction to an existing one.
--       RLS: a signed-in user inserts and reads only their own rows; admins read and update all. A player can only insert
--       status = pending with no reviewer set. At most 10 pending suggestions per player (trigger).
--   * venue_confirmations: "Looks right" -- one per player per venue (primary key). A player reads only their own rows;
--       the count shown to everyone comes from venue_confirmation_counts(), which exposes no user ids.
--   * venues gains: source ('osm' | 'player'), locked_fields (columns an import must not overwrite), player_notes.
--   * upsert_venues() is replaced so an import keeps any column listed in locked_fields (name, lat, lon, setting, surface,
--       lit, address, website). Everything from before is unchanged: price_* are kept when verified or price_source = manual,
--       permit_* when verified or permit_basis = manual, booking_* when verified, and verified is never changed by an import.
--   * Approving a suggestion is done by the server (service role), see /api/admin/venue-suggestions.

begin;

-- ---------------------------------------------------------------------------
-- venues: where a row came from, and what an import must leave alone
-- ---------------------------------------------------------------------------
alter table public.venues add column if not exists source text not null default 'osm'
  check (source in ('osm', 'player'));
alter table public.venues add column if not exists locked_fields text[] not null default '{}';
alter table public.venues add column if not exists player_notes text;

comment on column public.venues.source is 'osm = from the map data import; player = added by a player and approved by an admin.';
comment on column public.venues.locked_fields is 'Columns a player correction or an admin set by hand. upsert_venues() never overwrites these.';

-- ---------------------------------------------------------------------------
-- venue_suggestions
-- ---------------------------------------------------------------------------
create table if not exists public.venue_suggestions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('new_venue', 'correction')),
  venue_key         text references public.venues (venue_key) on delete set null,
  problem           text check (problem is null or problem in ('wrong_price', 'wrong_permit', 'wrong_location', 'wrong_setting', 'closed', 'other')),
  lat               double precision check (lat is null or lat between -90 and 90),
  lon               double precision check (lon is null or lon between -180 and 180),
  name              text,
  setting           text check (setting is null or setting in ('indoor', 'outdoor', 'both')),
  surface           text,
  price_note        text,
  permit_note       text,
  website           text,
  note              text,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  created_venue_key text,
  created_at        timestamptz not null default now(),
  -- a new field needs a name and a pin; a correction needs the venue it is about
  check (kind <> 'new_venue' or (name is not null and length(trim(name)) > 0 and lat is not null and lon is not null)),
  check (kind <> 'correction' or venue_key is not null),
  check (name is null or length(name) <= 200),
  check (note is null or length(note) <= 2000)
);

comment on table public.venue_suggestions is 'Player-suggested new fields and corrections, reviewed by an admin.';

create index if not exists venue_suggestions_status_idx on public.venue_suggestions (status, created_at desc);
create index if not exists venue_suggestions_user_idx on public.venue_suggestions (user_id, created_at desc);
create index if not exists venue_suggestions_venue_idx on public.venue_suggestions (venue_key) where venue_key is not null;

create or replace function public.venue_suggestions_rate_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  pending integer;
begin
  select count(*) into pending from public.venue_suggestions s where s.user_id = new.user_id and s.status = 'pending';
  if pending >= 10 then
    raise exception 'venue_suggestion_rate_limit' using errcode = 'P0001', hint = 'Too many pending suggestions';
  end if;
  return new;
end;
$$;

drop trigger if exists venue_suggestions_rate_limit on public.venue_suggestions;
create trigger venue_suggestions_rate_limit
  before insert on public.venue_suggestions
  for each row execute function public.venue_suggestions_rate_limit();

alter table public.venue_suggestions enable row level security;
revoke all on public.venue_suggestions from anon, authenticated;
grant select, insert, update on public.venue_suggestions to authenticated;

drop policy if exists venue_suggestions_insert_own on public.venue_suggestions;
create policy venue_suggestions_insert_own on public.venue_suggestions
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null and created_venue_key is null);

drop policy if exists venue_suggestions_select_own on public.venue_suggestions;
create policy venue_suggestions_select_own on public.venue_suggestions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists venue_suggestions_admin_select on public.venue_suggestions;
create policy venue_suggestions_admin_select on public.venue_suggestions
  for select to authenticated using (public.is_admin_uid(auth.uid()));

drop policy if exists venue_suggestions_admin_update on public.venue_suggestions;
create policy venue_suggestions_admin_update on public.venue_suggestions
  for update to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- venue_confirmations
-- ---------------------------------------------------------------------------
create table if not exists public.venue_confirmations (
  venue_key  text not null references public.venues (venue_key) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_key, user_id)
);

create index if not exists venue_confirmations_user_idx on public.venue_confirmations (user_id);

alter table public.venue_confirmations enable row level security;
revoke all on public.venue_confirmations from anon, authenticated;
grant select, insert on public.venue_confirmations to authenticated;

drop policy if exists venue_confirmations_insert_own on public.venue_confirmations;
create policy venue_confirmations_insert_own on public.venue_confirmations
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists venue_confirmations_select_own on public.venue_confirmations;
create policy venue_confirmations_select_own on public.venue_confirmations
  for select to authenticated using (user_id = auth.uid());

-- "Confirmed by N players": counts only, no user ids.
create or replace function public.venue_confirmation_counts(p_keys text[])
returns table (venue_key text, confirmations bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.venue_key, count(*)::bigint
    from public.venue_confirmations c
   where c.venue_key = any(p_keys)
   group by c.venue_key;
$$;

revoke all on function public.venue_confirmation_counts(text[]) from public, anon;
grant execute on function public.venue_confirmation_counts(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- upsert_venues: keep locked_fields (otherwise identical to 20261014000000_venues_setting.sql)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_venues(p_rows jsonb)
returns table (inserted integer, updated integer, protected integer)
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array of venue objects';
  end if;

  return query
  with incoming as (
    select distinct on (r.venue_key) r.*
    from jsonb_populate_recordset(null::public.venues, p_rows) r
    where r.venue_key is not null
    order by r.venue_key
  ),
  prot as (
    select count(*) as n
    from incoming i
    join public.venues v on v.venue_key = i.venue_key
    where v.verified or v.price_source = 'manual' or v.permit_basis = 'manual' or cardinality(v.locked_fields) > 0
  ),
  up as (
    insert into public.venues as v (
      venue_key, state, name, lat, lon, venue_type, school_key, school_name, school_kind, access, access_basis,
      field_count, turf_count, surface, lit, address, website, operator, sport_confidence, osm_ids, priority,
      price_status, price_text, price_min, price_max, price_unit, price_source,
      booking_method, booking_url, booking_phone, booking_basis,
      permit_required, permit_type, permit_basis,
      verified, last_verified_at, setting, updated_at
    )
    select
      i.venue_key, i.state, i.name, i.lat, i.lon, i.venue_type, i.school_key, i.school_name, i.school_kind, i.access, i.access_basis,
      i.field_count, i.turf_count, i.surface, i.lit, i.address, i.website, i.operator, i.sport_confidence, i.osm_ids, i.priority,
      coalesce(i.price_status, 'unknown'), i.price_text, i.price_min, i.price_max, i.price_unit, coalesce(i.price_source, 'unknown'),
      coalesce(i.booking_method, 'unknown'), i.booking_url, i.booking_phone, i.booking_basis,
      coalesce(i.permit_required, 'unknown'), i.permit_type, i.permit_basis,
      coalesce(i.verified, false), i.last_verified_at,
      -- A missing (or null) setting keeps the row's current value; a brand-new row defaults to outdoor.
      coalesce(i.setting, (select v0.setting from public.venues v0 where v0.venue_key = i.venue_key), 'outdoor'),
      now()
    from incoming i
    on conflict (venue_key) do update set
      -- always refreshed by an import
      state = excluded.state,
      name = case when 'name' = any(v.locked_fields) then v.name else excluded.name end,
      lat = case when 'lat' = any(v.locked_fields) then v.lat else excluded.lat end,
      lon = case when 'lon' = any(v.locked_fields) then v.lon else excluded.lon end,
      venue_type = excluded.venue_type,
      school_key = excluded.school_key,
      school_name = excluded.school_name,
      school_kind = excluded.school_kind,
      access = excluded.access,
      access_basis = excluded.access_basis,
      field_count = excluded.field_count,
      turf_count = excluded.turf_count,
      surface = case when 'surface' = any(v.locked_fields) then v.surface else excluded.surface end,
      lit = case when 'lit' = any(v.locked_fields) then v.lit else excluded.lit end,
      address = case when 'address' = any(v.locked_fields) then v.address else excluded.address end,
      website = case when 'website' = any(v.locked_fields) then v.website else excluded.website end,
      operator = excluded.operator,
      sport_confidence = excluded.sport_confidence,
      osm_ids = excluded.osm_ids,
      priority = excluded.priority,
      setting = case when 'setting' = any(v.locked_fields) then v.setting else excluded.setting end,
      -- price_*: protected when verified or price_source = manual
      price_status    = case when v.verified or v.price_source = 'manual' then v.price_status    else excluded.price_status end,
      price_text      = case when v.verified or v.price_source = 'manual' then v.price_text      else excluded.price_text end,
      price_min       = case when v.verified or v.price_source = 'manual' then v.price_min       else excluded.price_min end,
      price_max       = case when v.verified or v.price_source = 'manual' then v.price_max       else excluded.price_max end,
      price_unit      = case when v.verified or v.price_source = 'manual' then v.price_unit      else excluded.price_unit end,
      price_source    = case when v.verified or v.price_source = 'manual' then v.price_source    else excluded.price_source end,
      -- booking_*: protected when verified
      booking_method  = case when v.verified then v.booking_method  else excluded.booking_method end,
      booking_url     = case when v.verified then v.booking_url     else excluded.booking_url end,
      booking_phone   = case when v.verified then v.booking_phone   else excluded.booking_phone end,
      booking_basis   = case when v.verified then v.booking_basis   else excluded.booking_basis end,
      -- permit_*: protected when verified or permit_basis = manual
      permit_required = case when v.verified or v.permit_basis = 'manual' then v.permit_required else excluded.permit_required end,
      permit_type     = case when v.verified or v.permit_basis = 'manual' then v.permit_type     else excluded.permit_type end,
      permit_basis    = case when v.verified or v.permit_basis = 'manual' then v.permit_basis    else excluded.permit_basis end,
      -- verified and last_verified_at are deliberately not touched here
      updated_at = now()
    returning (xmax = 0) as was_inserted
  )
  select (count(*) filter (where was_inserted))::integer,
         (count(*) filter (where not was_inserted))::integer,
         (select n from prot)::integer
  from up;
end;
$$;

comment on function public.upsert_venues(jsonb) is
  'Import venues from a JSON array. Existing rows keep price_* (verified or price_source = manual), permit_* (verified or permit_basis = manual), booking_* (verified), and any column in locked_fields; verified is never changed. A missing setting keeps the current value. Returns inserted / updated / protected row counts.';

revoke all on function public.upsert_venues(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_venues(jsonb) to service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- -- First restore upsert_venues by re-running its definition from 20261014000000_venues_setting.sql, then:
-- drop function if exists public.venue_confirmation_counts(text[]);
-- drop table if exists public.venue_confirmations;
-- drop table if exists public.venue_suggestions;
-- drop function if exists public.venue_suggestions_rate_limit();
-- alter table public.venues drop column if exists player_notes;
-- alter table public.venues drop column if exists locked_fields;
-- alter table public.venues drop column if exists source;
-- commit;
-- ============================================================
