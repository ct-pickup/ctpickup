-- Custom venue ZIP for drive-time / distance (5-digit US).

alter table public.pickup_runs
  add column if not exists venue_zip_code text;

alter table public.tournaments
  add column if not exists venue_zip_code text;

comment on column public.pickup_runs.venue_zip_code is
  '5-digit US ZIP for custom venues; used for drive-time estimates when set.';

comment on column public.tournaments.venue_zip_code is
  '5-digit US ZIP for custom venues; used for drive-time estimates when set.';
