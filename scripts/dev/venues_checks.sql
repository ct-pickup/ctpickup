-- DEV ONLY. Read-only checks for the nationwide venue import and venues_nearby(). Run in the dev SQL editor.

-- 1. Venues and schools per state (compare with the importer's per-state table)
select coalesce(v.state, s.state) as state, v.venues, s.schools
from (select state, count(*) as venues from public.venues group by state) v
full join (select state, count(*) as schools from public.schools group by state) s on s.state = v.state
order by 1;

-- 2. Totals, and the indoor / outdoor split
select count(*) as venues, count(*) filter (where verified) as verified from public.venues;
select setting, count(*) from public.venues group by setting order by setting;
select count(*) as schools from public.schools;

-- 3. Nearby search: fields in a box around Danbury, CT (the first row's total_count is the match count)
select (venue).name, (venue).venue_type, round(distance_mi::numeric, 1) as miles, total_count
from public.venues_nearby(p_min_lat => 41.3, p_max_lat => 41.5, p_min_lon => -73.6, p_max_lon => -73.3, p_center_lat => 41.4, p_center_lon => -73.45, p_limit => 10);

-- 4. Same box, indoor only (should include Danbury Sports Dome if it is in the data)
select (venue).name, (venue).setting, total_count
from public.venues_nearby(p_min_lat => 41.3, p_max_lat => 41.5, p_min_lon => -73.6, p_max_lon => -73.3, p_indoor => true);

-- 5. Search anywhere by text, nearest to a point
select (venue).name, (venue).state, round(distance_mi::numeric, 0) as miles, total_count
from public.venues_nearby(p_query => 'dome', p_center_lat => 41.4, p_center_lon => -73.45, p_limit => 10);

-- 6. Paging: page 2 of 25 around a point within 10 miles
select (venue).name, round(distance_mi::numeric, 1) as miles, total_count
from public.venues_nearby(p_center_lat => 41.4, p_center_lon => -73.45, p_radius_miles => 10, p_limit => 25, p_offset => 25);

-- 7. Speed: should be a few milliseconds
explain analyze select * from public.venues_nearby(p_min_lat => 41.3, p_max_lat => 41.5, p_min_lon => -73.6, p_max_lon => -73.3, p_limit => 200);
