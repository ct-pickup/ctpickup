alter table public.profiles
  add column if not exists current_streak integer default 0;

alter table public.profiles
  add column if not exists longest_streak integer default 0;

alter table public.profiles
  add column if not exists last_streak_run_at timestamptz;
