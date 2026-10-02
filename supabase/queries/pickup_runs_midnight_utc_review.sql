-- Read-only review: pickup runs whose start_at is exactly 00:00:00 UTC.
-- The apps used to show these as "date only". They now show the real Eastern time: 8:00 PM EDT / 7:00 PM EST
-- on the PREVIOUS day. Use the signals below to decide which were real evening games (leave as is) and which
-- were meant as date-only (set time_tbd = true and start_at = noon America/New_York on the intended date).
-- Changes no rows. Optional columns are read through to_jsonb so the query works on any schema version.

with midnight_runs as (
  select r.*, to_jsonb(r) as j
  from public.pickup_runs r
  where r.start_at is not null
    and (r.start_at at time zone 'UTC')::time = time '00:00:00'
),
rsvp_status_counts as (
  select v.run_id, v.status, count(*) as n
  from public.pickup_run_rsvps v
  where v.run_id in (select id from midnight_runs)
  group by v.run_id, v.status
),
rsvps as (
  select
    run_id,
    sum(n) as rsvp_total,
    coalesce(sum(n) filter (where status in ('confirmed', 'pending_payment')), 0) as rsvp_reserved,
    string_agg(status || ': ' || n, ', ' order by status) as rsvp_by_status
  from rsvp_status_counts
  group by run_id
),
host_hours as (
  select
    o.created_by,
    count(*) as host_other_runs,
    mode() within group (order by extract(hour from o.start_at at time zone 'America/New_York')) as host_modal_hour_et
  from public.pickup_runs o
  where o.created_by in (select created_by from midnight_runs where created_by is not null)
    and o.start_at is not null
    and (o.start_at at time zone 'UTC')::time <> time '00:00:00'
  group by o.created_by
),
scored as (
  select
    m.*,
    concat_ws(' ', m.title, m.j ->> 'description', m.j ->> 'notes') as text_blob,
    extract(hour from m.start_at at time zone 'America/New_York') as et_hour,
    to_char(m.start_at at time zone 'America/New_York', 'FMHH12') as et_hour12
  from midnight_runs m
)
select
  -- Run id.
  s.id,
  -- Run title as the host entered it.
  s.title,
  -- Host user id (null for operator-created runs).
  s.created_by as host_id,
  -- Host display name from profiles.
  coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username) as host_name,
  -- What the apps show now: the Eastern date and time (8:00 PM EDT / 7:00 PM EST on the previous day).
  to_char(s.start_at at time zone 'America/New_York', 'Dy Mon FMDD YYYY, FMHH12:MI AM') || ' ET' as start_et,
  -- The UTC calendar date the apps used to show as "date only".
  (s.start_at at time zone 'UTC')::date as utc_date,
  -- Run status.
  s.status,
  -- RSVPs holding a spot (confirmed + pending_payment).
  coalesce(rv.rsvp_reserved, 0) as rsvp_reserved,
  -- All RSVP rows.
  coalesce(rv.rsvp_total, 0) as rsvp_total,
  -- RSVP rows by status, e.g. "confirmed: 8, waitlist: 2".
  rv.rsvp_by_status,
  -- When the run was created.
  s.created_at,
  -- Kickoff still in the future.
  s.start_at > now() as is_upcoming,
  -- Run type (public / select).
  s.run_type,
  -- Final poll slot; null while an availability poll is still open (old poll placeholders sat at midnight UTC).
  s.j ->> 'final_slot_id' as final_slot_id,
  -- Signal: first clock time mentioned in title / description / notes, e.g. "8pm".
  substring(lower(s.text_blob) from '(\d{1,2}(?::\d{2})?\s*(?:am|pm))') as text_time_signal,
  -- Signal: how many of the host's other (non-midnight) runs exist.
  coalesce(hh.host_other_runs, 0) as host_other_runs,
  -- Signal: most common Eastern kickoff hour (0 to 23) across the host's other runs.
  hh.host_modal_hour_et,
  -- Best guess at what the host meant. You decide.
  case
    when lower(s.text_blob) ~ ('\m' || s.et_hour12 || '(:00)?\s*pm') then 'likely 8pm/7pm ET evening game'
    when lower(s.text_blob) ~ '\d{1,2}(:\d{2})?\s*(am|pm)' then 'unclear'
    when s.j ->> 'final_slot_id' is null and s.status in ('planning', 'likely_on') then 'likely date-only'
    when hh.host_modal_hour_et = s.et_hour then 'likely 8pm/7pm ET evening game'
    when hh.host_modal_hour_et is not null then 'likely date-only'
    else 'unclear'
  end as suggested_intent
from scored s
left join rsvps rv on rv.run_id = s.id
left join host_hours hh on hh.created_by = s.created_by
left join public.profiles p on p.id = s.created_by
order by (s.start_at > now()) desc, s.start_at;
