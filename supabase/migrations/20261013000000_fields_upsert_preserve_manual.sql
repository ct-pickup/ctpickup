-- Fields: re-imports also keep hand-entered data. Replaces public.upsert_venues from 20261012000000.
--
-- Before: price_*, booking_* and permit_* were kept only when verified = true.
-- Now, on an existing row:
--   * price_*   are kept when verified = true OR price_source  = 'manual'
--   * permit_*  are kept when verified = true OR permit_basis  = 'manual'
--   * booking_* are kept when verified = true (unchanged)
-- verified and last_verified_at are still never changed by an import.
-- The "protected" count now includes rows kept because of a manual price or permit.
-- Same signature and grants, so callers do not change. Additive: create or replace only.

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
    where v.verified or v.price_source = 'manual' or v.permit_basis = 'manual'
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
  'Import venues from a JSON array. Existing rows keep price_* (verified or price_source = manual), permit_* (verified or permit_basis = manual) and booking_* (verified), and always keep verified. Returns inserted / updated / protected row counts.';

revoke all on function public.upsert_venues(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_venues(jsonb) to service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed): re-run the upsert_venues definition from
-- 20261012000000_fields_venues_schools.sql (create or replace restores the verified-only rule).
-- ============================================================
