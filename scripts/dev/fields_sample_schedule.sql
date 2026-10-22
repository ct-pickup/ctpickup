-- DEV ONLY. Not a migration. Never run this on production.
--
-- Sample schedule data for the Schedule, Events and Venue calendars screens. Run it AFTER scripts/dev/fields_sample_venues.sql
-- (it needs the five sample- venues) and the fields migrations. Times are relative to now, in Eastern time, so the data is
-- always "this week". Re-running first clears the sample- rows this file owns, so it is safe to repeat.
--
--   psql "$DEV_DATABASE_URL" -f scripts/dev/fields_sample_schedule.sql
--
-- What it sets up:
--   * Riverside Park: calendar LIVE (synced just now), so free hours show Open.
--   * Hillcrest HS:   calendar NOT connected, but two bookings we know about (Booked) and everything else Unknown.
--   * Lakeview SC:    calendar FAILED, shows Unknown.
--   * Oak Hill MS:    calendar not connected, no link yet.

begin;

delete from public.field_events where venue_key like 'sample-%';
delete from public.schedule_slots where venue_key like 'sample-%';
delete from public.venue_calendars where venue_key like 'sample-%';

-- Local midnight today (Eastern) as a timestamptz
with d as (select (date_trunc('day', now() at time zone 'America/New_York')) as day0)
insert into public.venue_calendars (venue_key, provider, calendar_url, sync_status, last_synced_at, last_error, last_error_at, connected_at)
select * from (values
  ('sample-riverside-park', 'ical',   'https://example.org/riverside.ics', 'live',          now(),                      null::text, null::timestamptz, now()),
  ('sample-lakeview-sc',    'google', 'https://calendar.google.com/x.ics', 'failed',        now() - interval '2 days',  'Calendar link stopped working.', now() - interval '2 days', now() - interval '30 days'),
  ('sample-oak-hill-ms',    null,     null,                                'not_connected', null,                       null, null, null)
) as v(venue_key, provider, calendar_url, sync_status, last_synced_at, last_error, last_error_at, connected_at);

-- Bookings we know about at Hillcrest (calendar not connected): Booked shows, the rest stays Unknown
with d as (select (date_trunc('day', now() at time zone 'America/New_York')) as day0)
insert into public.schedule_slots (venue_key, starts_at, ends_at, status, title, source)
select 'sample-hillcrest-hs', ((day0 + t.s) at time zone 'America/New_York'), ((day0 + t.e) at time zone 'America/New_York'), 'booked', t.title, 'manual'
from d, (values
  (interval '3 days 10 hours', interval '3 days 11 hours', 'Youth league'),
  (interval '3 days 14 hours', interval '3 days 16 hours', 'Varsity practice')
) as t(s, e, title);

-- One booking at Riverside (live calendar)
with d as (select (date_trunc('day', now() at time zone 'America/New_York')) as day0)
insert into public.schedule_slots (venue_key, starts_at, ends_at, status, title, source)
select 'sample-riverside-park', ((day0 + interval '3 days 16 hours') at time zone 'America/New_York'), ((day0 + interval '3 days 18 hours') at time zone 'America/New_York'), 'booked', 'Town adult league', 'calendar'
from d;

-- Events this week
with d as (select (date_trunc('day', now() at time zone 'America/New_York')) as day0)
insert into public.field_events (venue_key, title, event_type, starts_at, capacity, joined_count, price_cents, price_unit, source, source_note)
select e.venue_key, e.title, e.event_type, ((day0 + e.at) at time zone 'America/New_York'), e.capacity, e.joined, e.price_cents, e.price_unit, e.source, e.note
from d, (values
  ('sample-hillcrest-hs',   'Saturday pickup 7v7',        'pickup',     interval '3 days 11 hours', 14, 8,  1000, 'player', 'manual',   null::text),
  ('sample-riverside-park', 'Open scrimmage',             'pickup',     interval '3 days 16 hours', 16, 5,  0,    null,     'manual',   null),
  ('sample-lakeview-sc',    'Town adult league, week 4',  'league',     interval '4 days 9 hours',  null::int, 0, null, null,  'imported', 'Imported from town calendar'),
  ('sample-hillcrest-hs',   'Fall 5v5 tournament',        'tournament', interval '4 days 13 hours', 8,  3,  8000, 'team',   'manual',   null)
) as e(venue_key, title, event_type, at, capacity, joined, price_cents, price_unit, source, note);

commit;
