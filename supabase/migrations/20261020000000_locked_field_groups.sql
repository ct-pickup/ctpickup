-- Lets locked_fields also protect whole groups of columns from an import: 'price' (price_*), 'permit' (permit_*) and 'booking'
-- (booking_*), on top of the single columns it already protects (name, lat, lon, setting, surface, lit, address, website).
-- Used by scripts/import-research.ts so researched price, permit and booking values survive an OSM re-import.
-- Replaces upsert_venues from 20261018000000_venue_suggestions.sql; otherwise identical. Safe to run more than once.

begin;

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
  'Import venues from a JSON array. Existing rows keep price_* (verified, price_source = manual, or price locked), permit_* (verified, permit_basis = manual, or permit locked), booking_* (verified or booking locked), and any other column named in locked_fields; verified is never changed. A missing setting keeps the current value. Returns inserted / updated / protected row counts.';

revoke all on function public.upsert_venues(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_venues(jsonb) to service_role;

commit;

-- Rollback: re-run the upsert_venues definition from 20261018000000_venue_suggestions.sql.
