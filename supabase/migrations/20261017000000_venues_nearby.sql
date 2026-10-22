-- Fields at national scale: venues_nearby(), a paged search of venues in a map box or near a point.
-- Additive. Depends on 20261012000000_fields_venues_schools.sql (venues, venues_lat_lon_idx) and 20261014000000_venues_setting.sql.
--
--   * Area: a bounding box (p_min_lat .. p_max_lat, p_min_lon .. p_max_lon) and/or a point with a radius in miles
--     (p_center_lat, p_center_lon, p_radius_miles). The box uses the existing btree index on (lat, lon). A radius is turned
--     into a box for the index first, then trimmed by true distance. With neither area and a text query, it searches everywhere.
--   * Filters match the app's chips exactly: free, turf, no permit, lights, indoor (indoor = setting indoor or both).
--   * p_query: text search over name, address, school name and operator.
--   * Sorted by distance from the point (or from the middle of the box), then priority, then name. Paged with limit / offset.
--   * total_count is the number of matching venues before paging, on every row, so the app can say "N fields near you".
-- security invoker: the existing RLS lets any signed-in user read venues, and nothing else changes.
-- At this size (tens of thousands of rows) even a full scan is a few milliseconds, so the box test does not depend on the planner
-- choosing the index. No PostGIS needed. If it is enabled later, a gist index on a geography column can replace the box test.

begin;

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

comment on function public.venues_nearby(double precision, double precision, double precision, double precision, double precision, double precision, double precision, boolean, boolean, boolean, boolean, boolean, text, integer, integer) is
  'Venues in a bounding box and/or within N miles of a point, filtered like the Fields chips plus text search, nearest first, paged. total_count is the match count before paging.';

revoke all on function public.venues_nearby(double precision, double precision, double precision, double precision, double precision, double precision, double precision, boolean, boolean, boolean, boolean, boolean, text, integer, integer) from public, anon;
grant execute on function public.venues_nearby(double precision, double precision, double precision, double precision, double precision, double precision, double precision, boolean, boolean, boolean, boolean, boolean, text, integer, integer) to authenticated, service_role;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop function if exists public.venues_nearby(double precision, double precision, double precision, double precision, double precision, double precision, double precision, boolean, boolean, boolean, boolean, boolean, text, integer, integer);
-- commit;
-- ============================================================
