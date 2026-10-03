-- Competitive Together — Discover (1 of 1): weekly pick cache and search rate limit
-- Additive only. No changes to profiles or player_ratings.
--
-- discover_weekly_picks: the five picks for one user for one ET week. Written once
-- per user per week so the set never shifts mid-week as people join or ratings move.
--
-- discover_search_usage: a per-hour counter behind the exact-match search limit.

create table if not exists public.discover_weekly_picks (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  week_start date        not null,
  player_ids uuid[]      not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

comment on table public.discover_weekly_picks is
  'Discover picks for one user for one Eastern week (Monday start). Written once, then read all week.';

create index if not exists discover_weekly_picks_week_idx
  on public.discover_weekly_picks (week_start);

create table if not exists public.discover_search_usage (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  hour_start timestamptz not null,
  hits       integer     not null default 0,
  primary key (user_id, hour_start),
  constraint discover_search_usage_hits_positive check (hits >= 0)
);

comment on table public.discover_search_usage is
  'Rolling hourly counter for Discover search. Enforced in the API; rows older than a day can be pruned.';

create index if not exists discover_search_usage_hour_idx
  on public.discover_search_usage (hour_start);

-- Writes go through the Next.js API with the service role. Readers see only their
-- own rows, matching how chat_blocks is handled.
alter table public.discover_weekly_picks enable row level security;
alter table public.discover_search_usage enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'discover_weekly_picks'
       and policyname = 'discover_weekly_picks_own_select'
  ) then
    create policy discover_weekly_picks_own_select
      on public.discover_weekly_picks for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'discover_search_usage'
       and policyname = 'discover_search_usage_own_select'
  ) then
    create policy discover_search_usage_own_select
      on public.discover_search_usage for select
      using (auth.uid() = user_id);
  end if;
end $$;
