-- DEV ONLY. Not a migration. Never run this on production.
--
-- Seeds the five sample venues the Fields screens show (mobile/lib/fields/sampleData.ts), so the whole
-- request flow can be tested on a development database: send a request, see it in the admin queue, change
-- its status, get the pushes.
--
-- Run it by hand against the dev database after the fields migrations (20261012* and 20261013*) have run:
--   psql "$DEV_DATABASE_URL" -f scripts/dev/fields_sample_venues.sql
--
-- Safe to run more than once: it upserts on venue_key. All keys start with "sample-" so they are easy to find
-- and remove (see the cleanup block at the bottom). It writes only the venues table.

begin;

insert into public.venues (
  venue_key, state, name, lat, lon, venue_type, school_name, school_kind, access, operator,
  field_count, turf_count, surface, lit, address,
  price_status, price_min, price_max, price_unit, price_source,
  booking_method, booking_url, booking_phone,
  permit_required, permit_type, permit_basis, verified, last_verified_at
) values
  -- Free town park, walk up. Verified. Shows "Free", "No permit", "Verified".
  ('sample-riverside-park', 'CT', 'Riverside Park Field', 41.1565, -73.2706, 'park', null, null, 'public', null,
   1, 0, 'grass', 'no', '45 River Rd, Fairfield, CT',
   'free', null, null, null, 'osm',
   'unknown', null, null,
   'no', 'walk_up', 'tag: access=yes', true, now()),

  -- Public school turf. Price is manual (so verified), permit is an assumption: "We're confirming".
  ('sample-hillcrest-hs', 'CT', 'Hillcrest High School Turf', 41.1912, -73.2431, 'school_public', 'Hillcrest High School', 'public', 'restricted', null,
   2, 2, 'turf', 'yes', '123 Sample Rd, Fairfield, CT',
   'paid', 120, 120, 'hour', 'manual',
   'permit_request', null, null,
   'yes', 'school_use_request', 'assumed: public school facility-use policy', false, null),

  -- Private club, membership, has a phone number for the "Call" button.
  ('sample-lakeview-sc', 'CT', 'Lakeview Soccer Club', 41.1301, -73.3012, 'club', null, null, 'private', 'Lakeview SC',
   3, 3, 'turf', 'yes', '9 Lakeview Dr, Westport, CT',
   'paid', 60, 60, 'hour', 'manual',
   'phone', null, '(203) 555-0100',
   'yes', 'membership', 'manual', true, now()),

  -- School with nothing known: shows "Price unknown", "$?" pin and no permit chip.
  ('sample-oak-hill-ms', 'CT', 'Oak Hill Middle School', 41.2105, -73.2899, 'school_unknown', 'Oak Hill Middle School', null, null, null,
   1, null, 'grass', null, '77 Oak Hill Ave, Trumbull, CT',
   'unknown', null, null, null, 'unknown',
   'unknown', null, null,
   'unknown', null, null, false, null),

  -- Town park with a permit, not verified.
  ('sample-penfield-field', 'CT', 'Penfield Field', 41.1198, -73.2503, 'park', null, null, 'public', 'Town Parks and Recreation',
   2, 0, 'grass', 'yes', '12 Reef Rd, Fairfield, CT',
   'paid', 25, 25, 'hour', 'osm',
   'online', 'https://example.org/parks/permits', null,
   'yes', 'permit', 'tag: access=permit', false, null)
on conflict (venue_key) do update set
  state = excluded.state,
  name = excluded.name,
  lat = excluded.lat,
  lon = excluded.lon,
  venue_type = excluded.venue_type,
  school_name = excluded.school_name,
  school_kind = excluded.school_kind,
  access = excluded.access,
  operator = excluded.operator,
  field_count = excluded.field_count,
  turf_count = excluded.turf_count,
  surface = excluded.surface,
  lit = excluded.lit,
  address = excluded.address,
  price_status = excluded.price_status,
  price_min = excluded.price_min,
  price_max = excluded.price_max,
  price_unit = excluded.price_unit,
  price_source = excluded.price_source,
  booking_method = excluded.booking_method,
  booking_url = excluded.booking_url,
  booking_phone = excluded.booking_phone,
  permit_required = excluded.permit_required,
  permit_type = excluded.permit_type,
  permit_basis = excluded.permit_basis,
  verified = excluded.verified,
  last_verified_at = excluded.last_verified_at;

commit;

-- ============================================================
-- Cleanup (run manually on the dev database when you are done testing):
--
-- begin;
-- delete from public.venue_requests where venue_key like 'sample-%';   -- venue_requests restricts venue deletes
-- delete from public.venues where venue_key like 'sample-%';
-- commit;
-- ============================================================
