-- Run banter rooms: venue + date title, Public/Select description.

alter table public.chat_rooms
  add column if not exists description text;

comment on column public.chat_rooms.description is
  'Optional room context; run_banter rooms use Public or Select from pickup_runs.run_type.';

-- Backfill generic "Run Chat …" titles from linked pickup runs.
update public.chat_rooms cr
set
  description = case
    when pr.run_type = 'public'::pickup_run_type then 'Public'
    when pr.run_type = 'select'::pickup_run_type then 'Select'
  end,
  title = trim(
    coalesce(
      nullif(split_part(trim(coalesce(pr.location_private, '')), E'\n', 1), ''),
      nullif(trim(coalesce(pr.title, '')), ''),
      'Pickup run'
    )
  ) || ' · ' || to_char(
    coalesce(pr.start_at, now()) at time zone 'America/New_York',
    'FMMonth FMDD'
  )
from public.pickup_runs pr
where cr.run_id = pr.id
  and cr.room_type = 'run_banter'
  and (
    cr.title ilike 'Run Chat%'
    or cr.description is null
  );
