-- Goalie of the Day award for pickup run results.

alter table public.pickup_run_results
  add column if not exists goalie_of_the_day uuid references public.profiles (id) on delete set null;

create index if not exists pickup_run_results_goalie_of_the_day_idx
  on public.pickup_run_results (goalie_of_the_day);

alter table public.profiles
  add column if not exists goalie_of_the_day_count integer not null default 0;

update public.profiles
set goalie_of_the_day_count = coalesce(goalie_of_the_day_count, 0);

comment on column public.pickup_run_results.goalie_of_the_day is
  'Goalie of the Day award winner for this pickup run.';

comment on column public.profiles.goalie_of_the_day_count is
  'Goalie of the Day awards from posted pickup run results (server-maintained).';
