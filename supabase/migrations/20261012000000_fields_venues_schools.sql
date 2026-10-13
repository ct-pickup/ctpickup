-- Fields, step 1 of 3: schools and venues, plus the re-import function.
-- Additive. Nothing existing reads these tables yet.
--
--   * venues mirrors the CT venue data (one row per field complex). Status columns have check constraints.
--   * Players (any signed-in user) can read venues and schools. Only admins write them from the app.
--   * Re-imports go through public.upsert_venues(), which never overwrites price_*, booking_* or permit_*
--     on a row where verified = true, and never changes verified / last_verified_at.
--     Only the service role can call it (the import script), and the service role bypasses RLS.

begin;

-- Shared updated_at trigger for the fields tables (this migration and the two after it).
create or replace function public.fields_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- schools
-- ---------------------------------------------------------------------------
create table if not exists public.schools (
  school_key       text primary key,
  state            text,
  name             text not null,
  kind             text,
  kind_basis       text,
  amenity          text,
  lat              double precision,
  lon              double precision,
  website          text,
  phone            text,
  address          text,
  has_field_mapped boolean not null default false
);

comment on table public.schools is 'Schools from the venue data run. A venue links to a school by school_key (no foreign key: imports may land in either order).';

create index if not exists schools_state_idx on public.schools (state);

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------
create table if not exists public.venues (
  venue_key        text primary key,
  state            text,
  name             text not null,
  lat              double precision,
  lon              double precision,
  venue_type       text,            -- school_public | school_private | school_unknown | park | club | other
  school_key       text,
  school_name      text,
  school_kind      text,
  access           text,            -- public | private | restricted | unknown
  access_basis     text,
  field_count      integer,
  turf_count       integer,
  surface          text,
  lit              text,
  address          text,
  website          text,
  operator         text,
  sport_confidence text,
  osm_ids          text,
  priority         integer,
  price_status     text not null default 'unknown' check (price_status in ('free', 'paid', 'unknown')),
  price_text       text,
  price_min        numeric,
  price_max        numeric,
  price_unit       text,
  price_source     text not null default 'unknown' check (price_source in ('osm', 'manual', 'unknown')),
  booking_method   text not null default 'unknown' check (booking_method in ('online', 'phone', 'permit_request', 'unknown')),
  booking_url      text,
  booking_phone    text,
  booking_basis    text,
  permit_required  text not null default 'unknown' check (permit_required in ('yes', 'no', 'unknown')),
  permit_type      text,            -- permit | reservation | membership | school_use_request | walk_up
  permit_basis     text,            -- tag... | assumed: ... | manual
  verified         boolean not null default false,
  last_verified_at timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.venues is 'Fields and venues. verified = a person checked price, booking and permit; imports never overwrite those on verified rows.';
comment on column public.venues.permit_basis is 'Where permit info came from: a map tag, "assumed: <reason>" (a guess, never shown as Verified) or "manual".';

create index if not exists venues_state_idx on public.venues (state);
create index if not exists venues_venue_type_idx on public.venues (venue_type);
create index if not exists venues_school_key_idx on public.venues (school_key);
create index if not exists venues_lat_lon_idx on public.venues (lat, lon);
create index if not exists venues_verified_idx on public.venues (verified) where verified;

drop trigger if exists venues_touch_updated_at on public.venues;
create trigger venues_touch_updated_at
  before update on public.venues
  for each row execute function public.fields_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.schools enable row level security;
alter table public.venues enable row level security;

revoke all on public.schools from anon, authenticated;
revoke all on public.venues from anon, authenticated;
grant select, insert, update, delete on public.schools to authenticated;
grant select, insert, update, delete on public.venues to authenticated;

drop policy if exists schools_select_signed_in on public.schools;
create policy schools_select_signed_in on public.schools
  for select to authenticated using (true);

drop policy if exists schools_admin_write on public.schools;
create policy schools_admin_write on public.schools
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

drop policy if exists venues_select_signed_in on public.venues;
create policy venues_select_signed_in on public.venues
  for select to authenticated using (true);

drop policy if exists venues_admin_write on public.venues;
create policy venues_admin_write on public.venues
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- Re-import: schools (plain upsert, schools have no verified flag)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_schools(p_rows jsonb)
returns table (inserted integer, updated integer)
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array of school objects';
  end if;

  return query
  with incoming as (
    select distinct on (r.school_key) r.*
    from jsonb_populate_recordset(null::public.schools, p_rows) r
    where r.school_key is not null
    order by r.school_key
  ),
  up as (
    insert into public.schools as s (school_key, state, name, kind, kind_basis, amenity, lat, lon, website, phone, address, has_field_mapped)
    select i.school_key, i.state, i.name, i.kind, i.kind_basis, i.amenity, i.lat, i.lon, i.website, i.phone, i.address,
           coalesce(i.has_field_mapped, false)
    from incoming i
    on conflict (school_key) do update set
      state = excluded.state,
      name = excluded.name,
      kind = excluded.kind,
      kind_basis = excluded.kind_basis,
      amenity = excluded.amenity,
      lat = excluded.lat,
      lon = excluded.lon,
      website = excluded.website,
      phone = excluded.phone,
      address = excluded.address,
      has_field_mapped = excluded.has_field_mapped
    returning (xmax = 0) as was_inserted
  )
  select (count(*) filter (where was_inserted))::integer,
         (count(*) filter (where not was_inserted))::integer
  from up;
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-import: venues. Never overwrites price_*, booking_* or permit_* when verified = true,
-- and never changes verified or last_verified_at (people verify in the admin app, not by import).
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
    where v.verified
  ),
  up as (
    insert into public.venues as v (
      venue_key, state, name, lat, lon, venue_type, school_key, school_name, school_kind, access, access_basis,
      field_count, turf_count, surface, lit, address, website, operator, sport_confidence, osm_ids, priority,
      price_status, price_text, price_min, price_max, price_unit, price_source,
      booking_method, booking_url, booking_phone, booking_basis,
      permit_required, permit_type, permit_basis,
      verified, last_verified_at, updated_at
    )
    select
      i.venue_key, i.state, i.name, i.lat, i.lon, i.venue_type, i.school_key, i.school_name, i.school_kind, i.access, i.access_basis,
      i.field_count, i.turf_count, i.surface, i.lit, i.address, i.website, i.operator, i.sport_confidence, i.osm_ids, i.priority,
      coalesce(i.price_status, 'unknown'), i.price_text, i.price_min, i.price_max, i.price_unit, coalesce(i.price_source, 'unknown'),
      coalesce(i.booking_method, 'unknown'), i.booking_url, i.booking_phone, i.booking_basis,
      coalesce(i.permit_required, 'unknown'), i.permit_type, i.permit_basis,
      coalesce(i.verified, false), i.last_verified_at, now()
    from incoming i
    on conflict (venue_key) do update set
      -- always refreshed by an import
      state = excluded.state,
      name = excluded.name,
      lat = excluded.lat,
      lon = excluded.lon,
      venue_type = excluded.venue_type,
      school_key = excluded.school_key,
      school_name = excluded.school_name,
      school_kind = excluded.school_kind,
      access = excluded.access,
      access_basis = excluded.access_basis,
      field_count = excluded.field_count,
      turf_count = excluded.turf_count,
      surface = excluded.surface,
      lit = excluded.lit,
      address = excluded.address,
      website = excluded.website,
      operator = excluded.operator,
      sport_confidence = excluded.sport_confidence,
      osm_ids = excluded.osm_ids,
      priority = excluded.priority,
      -- protected when verified = true
      price_status    = case when v.verified then v.price_status    else excluded.price_status end,
      price_text      = case when v.verified then v.price_text      else excluded.price_text end,
      price_min       = case when v.verified then v.price_min       else excluded.price_min end,
      price_max       = case when v.verified then v.price_max       else excluded.price_max end,
      price_unit      = case when v.verified then v.price_unit      else excluded.price_unit end,
      price_source    = case when v.verified then v.price_source    else excluded.price_source end,
      booking_method  = case when v.verified then v.booking_method  else excluded.booking_method end,
      booking_url     = case when v.verified then v.booking_url     else excluded.booking_url end,
      booking_phone   = case when v.verified then v.booking_phone   else excluded.booking_phone end,
      booking_basis   = case when v.verified then v.booking_basis   else excluded.booking_basis end,
      permit_required = case when v.verified then v.permit_required else excluded.permit_required end,
      permit_type     = case when v.verified then v.permit_type     else excluded.permit_type end,
      permit_basis    = case when v.verified then v.permit_basis    else excluded.permit_basis end,
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
  'Import venues from a JSON array. Existing rows keep price_*, booking_* and permit_* (and verified) when verified = true. Returns inserted / updated / protected row counts.';

revoke all on function public.upsert_venues(jsonb) from public, anon, authenticated;
revoke all on function public.upsert_schools(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_venues(jsonb) to service_role;
grant execute on function public.upsert_schools(jsonb) to service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop function if exists public.upsert_venues(jsonb);
-- drop function if exists public.upsert_schools(jsonb);
-- drop table if exists public.venues;
-- drop table if exists public.schools;
-- drop function if exists public.fields_touch_updated_at();
-- commit;
-- (Run the two later fields migrations' rollbacks first: they reference venues.)
-- ============================================================
