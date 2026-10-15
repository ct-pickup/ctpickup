-- DEV ONLY. Not a migration. Never run this on production.
--
-- Three pending player suggestions so the admin "Field suggestions" screen has something to approve or reject:
--   * a new field (no venue_key)
--   * a price correction for sample-riverside-park
--   * a "closed" report for sample-hillcrest-hs
-- Needs: migration 20261018000000_venue_suggestions.sql, scripts/dev/fields_sample_venues.sql, and the user already created.
-- Safe to run more than once: fixed ids, upserted. Re-running a row you already approved sets it back to pending.
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -v email='you@example.com' -f scripts/dev/fields_sample_suggestions.sql
--
-- In the Dashboard SQL editor, psql variables do not work: replace :'email' with 'you@example.com'.

begin;

with u as (select id from auth.users where lower(email) = lower(:'email') limit 1)
insert into public.venue_suggestions (id, user_id, kind, venue_key, problem, lat, lon, name, setting, surface, price_note, permit_note, website, note, status)
select v.id::uuid, u.id, v.kind, v.venue_key, v.problem, v.lat, v.lon, v.name, v.setting, v.surface, v.price_note, v.permit_note, v.website, v.note, 'pending'
from u, (values
  ('00000000-0000-4000-8000-0000000000a1', 'new_venue', null, null, 41.1702::float8, -73.2201::float8, 'Sample Waterside Turf', 'outdoor', 'turf', '$40/hr', 'Reserve on the town site', 'waterside.example.com', 'Lit until 10pm.'),
  ('00000000-0000-4000-8000-0000000000a2', 'correction', 'sample-riverside-park', 'wrong_price', null, null, null, null, null, 'Free', null, null, 'It is free on weekdays.'),
  ('00000000-0000-4000-8000-0000000000a3', 'correction', 'sample-hillcrest-hs', 'closed', null, null, null, null, null, null, null, null, 'Gate is locked, field is being rebuilt.')
) as v(id, kind, venue_key, problem, lat, lon, name, setting, surface, price_note, permit_note, website, note)
on conflict (id) do update set status = 'pending', reviewed_by = null, reviewed_at = null, created_venue_key = null;

commit;

-- Undo:
-- delete from public.venue_suggestions where id::text like '00000000-0000-4000-8000-0000000000a_';
-- delete from public.venues where venue_key like 'player-00000000-0000-4000-8000-0000000000a_';
