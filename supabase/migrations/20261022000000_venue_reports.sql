-- Field reports and admin actions on bad fields.
--
--   * venues gains status ('active' | 'hidden_pending_review' | 'removed'), status_reason, status_changed_at, closed_until,
--     closed_reason and merged_into. A removed field is never deleted: it stays as a tombstone so imports cannot bring it back.
--   * venue_suggestions: new report reasons (doesnt_exist, private, not_soccer, duplicate, wrong_info) plus detail and duplicate_of.
--   * venues_nearby() only returns active venues, so hidden and removed fields leave the map and the list.
--   * upsert_venues() skips rows for removed or hidden venues (and a removed field returning under a new key with the same
--     osm_ids), so neither the OSM importer nor anything that calls it can re-create or re-show them.
-- Replaces venues_nearby (20261017000000) and upsert_venues (20261020000000); otherwise identical. Safe to run more than once.
-- Depends on 20261018000000 (venue_suggestions) and 20261020000000.

begin;

alter table public.venues add column if not exists status text not null default 'active';
alter table public.venues drop constraint if exists venues_status_check;
alter table public.venues add constraint venues_status_check check (status in ('active', 'hidden_pending_review', 'removed'));
alter table public.venues add column if not exists status_reason text;
alter table public.venues add column if not exists status_changed_at timestamptz;
alter table public.venues add column if not exists closed_until date;
alter table public.venues add column if not exists closed_reason text;
alter table public.venues add column if not exists merged_into text;

comment on column public.venues.status is 'active = shown; hidden_pending_review = hidden after repeated reports until an admin looks; removed = gone for good (kept so imports cannot re-create it).';
comment on column public.venues.closed_until is 'A closed banner shows on the field page until this date. The field stays on the map.';
comment on column public.venues.merged_into is 'venue_key of the field this one was merged into (the duplicate is then removed).';

create index if not exists venues_status_idx on public.venues (status) where status <> 'active';

alter table public.venue_suggestions add column if not exists detail text;
alter table public.venue_suggestions add column if not exists duplicate_of text references public.venues (venue_key) on delete set null;

alter table public.venue_suggestions drop constraint if exists venue_suggestions_problem_check;
alter table public.venue_suggestions add constraint venue_suggestions_problem_check check (
  problem is null or problem in (
    'wrong_price', 'wrong_permit', 'wrong_location', 'wrong_setting', 'closed', 'other',
    'doesnt_exist', 'private', 'not_soccer', 'duplicate', 'wrong_info'
  )
);

create index if not exists venue_suggestions_report_idx on public.venue_suggestions (venue_key, problem, status);

-- ---------------------------------------------------------------------------
-- venues_nearby: active venues only
-- ---------------------------------------------------------------------------
create or replace function public.venues_nearby(
  p_min_lat      double precision default null,
  p_max_lat      double precision default null,
  p_min_lon      double precision default null,
  p_max_lon      double precision default null,
  p_center_lat   double precision default null,
  p_center_lon   double precision default null,
  p_radius_miles double precision default null,
  p_free         boolean default false,
  p_turf         boolean default false,
  p_no_permit    boolean default false,
  p_lights       boolean default false,
  p_indoor       boolean default false,
  p_query        text default null,
  p_limit        integer default 25,
  p_offset       integer default 0
)
returns table (venue public.venues, distance_mi double precision, total_count bigint)
language sql
stable
set search_path = public
as $$
  with params as (
    select
      -- box for the index: given, or derived from the radius (1 degree of latitude is about 69 miles)
      coalesce(p_min_lat, case when p_radius_miles is not null and p_center_lat is not null then p_center_lat - p_radius_miles / 69.0 end) as min_lat,
      coalesce(p_max_lat, case when p_radius_miles is not null and p_center_lat is not null then p_center_lat + p_radius_miles / 69.0 end) as max_lat,
      coalesce(p_min_lon, case when p_radius_miles is not null and p_center_lat is not null and p_center_lon is not null
                               then p_center_lon - p_radius_miles / (69.0 * greatest(cos(radians(p_center_lat)), 0.01)) end) as min_lon,
      coalesce(p_max_lon, case when p_radius_miles is not null and p_center_lat is not null and p_center_lon is not null
                               then p_center_lon + p_radius_miles / (69.0 * greatest(cos(radians(p_center_lat)), 0.01)) end) as max_lon,
      -- where distance is measured from: the point, else the middle of the box
      coalesce(p_center_lat, (p_min_lat + p_max_lat) / 2.0) as o_lat,
      coalesce(p_center_lon, (p_min_lon + p_max_lon) / 2.0) as o_lon,
      nullif(trim(coalesce(p_query, '')), '') as q,
      greatest(1, least(coalesce(p_limit, 25), 500)) as lim,
      greatest(0, coalesce(p_offset, 0)) as off
  ),
  hits as (
    select
      v,
      case when pr.o_lat is not null and pr.o_lon is not null and v.lat is not null and v.lon is not null then
        3958.8 * 2 * asin(least(1.0, sqrt(
          power(sin(radians(v.lat - pr.o_lat) / 2), 2)
          + cos(radians(pr.o_lat)) * cos(radians(v.lat)) * power(sin(radians(v.lon - pr.o_lon) / 2), 2)
        )))
      end as dist
    from public.venues v
    cross join params pr
    where v.name <> ''
      and v.status = 'active'
      and (pr.min_lat is null or v.lat >= pr.min_lat)
      and (pr.max_lat is null or v.lat <= pr.max_lat)
      and (pr.min_lon is null or v.lon >= pr.min_lon)
      and (pr.max_lon is null or v.lon <= pr.max_lon)
      and (not p_free      or v.price_status = 'free')
      and (not p_turf      or coalesce(v.turf_count, 0) > 0 or lower(coalesce(v.surface, '')) like '%turf%' or lower(coalesce(v.surface, '')) like '%artificial%')
      and (not p_no_permit or v.permit_type = 'walk_up' or v.permit_required = 'no')
      and (not p_lights    or lower(trim(coalesce(v.lit, ''))) in ('yes', 'true'))
      and (not p_indoor    or v.setting in ('indoor', 'both'))
      and (pr.q is null or concat_ws(' ', v.name, v.address, v.school_name, v.operator) ilike '%' || replace(replace(replace(pr.q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  trimmed as (
    select h.v, h.dist
    from hits h
    where p_radius_miles is null or p_center_lat is null or p_center_lon is null or h.dist is null or h.dist <= p_radius_miles
  )
  select t.v, t.dist, count(*) over () as total_count
  from trimmed t
  order by t.dist asc nulls last, (t.v).priority desc nulls last, (t.v).name asc
  limit (select lim from params) offset (select off from params);
$$;


-- ---------------------------------------------------------------------------
-- upsert_venues: skip removed and hidden fields
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
      -- never touch (or re-create) a field an admin removed or hid for review
      and not exists (select 1 from public.venues x where x.venue_key = r.venue_key and x.status in ('removed', 'hidden_pending_review'))
      -- a removed field that comes back under a new key but the same map object is still removed
      and not exists (
        select 1 from public.venues x
        where x.status = 'removed' and x.venue_key <> r.venue_key
          and r.osm_ids is not null and btrim(r.osm_ids) <> '' and x.osm_ids = r.osm_ids
      )
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
      -- price_*: protected when verified, price_source = manual, or 'price' is in locked_fields
      price_status    = case when v.verified or v.price_source = 'manual' or 'price' = any(v.locked_fields) then v.price_status    else excluded.price_status end,
      price_text      = case when v.verified or v.price_source = 'manual' or 'price' = any(v.locked_fields) then v.price_text      else excluded.price_text end,
      price_min       = case when v.verified or v.price_source = 'manual' or 'price' = any(v.locked_fields) then v.price_min       else excluded.price_min end,
      price_max       = case when v.verified or v.price_source = 'manual' or 'price' = any(v.locked_fields) then v.price_max       else excluded.price_max end,
      price_unit      = case when v.verified or v.price_source = 'manual' or 'price' = any(v.locked_fields) then v.price_unit      else excluded.price_unit end,
      price_source    = case when v.verified or v.price_source = 'manual' or 'price' = any(v.locked_fields) then v.price_source    else excluded.price_source end,
      -- booking_*: protected when verified or 'booking' is in locked_fields
      booking_method  = case when v.verified or 'booking' = any(v.locked_fields) then v.booking_method  else excluded.booking_method end,
      booking_url     = case when v.verified or 'booking' = any(v.locked_fields) then v.booking_url     else excluded.booking_url end,
      booking_phone   = case when v.verified or 'booking' = any(v.locked_fields) then v.booking_phone   else excluded.booking_phone end,
      booking_basis   = case when v.verified or 'booking' = any(v.locked_fields) then v.booking_basis   else excluded.booking_basis end,
      -- permit_*: protected when verified, permit_basis = manual, or 'permit' is in locked_fields
      permit_required = case when v.verified or v.permit_basis = 'manual' or 'permit' = any(v.locked_fields) then v.permit_required else excluded.permit_required end,
      permit_type     = case when v.verified or v.permit_basis = 'manual' or 'permit' = any(v.locked_fields) then v.permit_type     else excluded.permit_type end,
      permit_basis    = case when v.verified or v.permit_basis = 'manual' or 'permit' = any(v.locked_fields) then v.permit_basis    else excluded.permit_basis end,
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
  'Import venues from a JSON array. Rows whose status is removed or hidden_pending_review are skipped (never updated or re-created). Existing rows keep price_* (verified, price_source = manual, or price locked), permit_* (verified, permit_basis = manual, or permit locked), booking_* (verified or booking locked), and any other column named in locked_fields; verified is never changed. A missing setting keeps the current value. Returns inserted / updated / protected row counts.';

revoke all on function public.upsert_venues(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_venues(jsonb) to service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed): re-run venues_nearby from 20261017000000 and upsert_venues from 20261020000000, then
--
-- begin;
-- alter table public.venue_suggestions drop column if exists duplicate_of;
-- alter table public.venue_suggestions drop column if exists detail;
-- alter table public.venues drop column if exists merged_into, drop column if exists closed_reason, drop column if exists closed_until,
--   drop column if exists status_changed_at, drop column if exists status_reason, drop column if exists status;
-- commit;
-- ============================================================
