-- Max radius (miles) for showing pickup runs near the player's ZIP on the Runs tab.
alter table public.profiles
  add column if not exists max_run_distance_miles integer default 30;

comment on column public.profiles.max_run_distance_miles is
  'Pickup Runs tab: show venues within this many miles of zip_code (10, 20, 30, 50, or 100).';
