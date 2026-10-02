-- ============================================================
-- CT Pickup — points ledger (points_events)
--
-- Additive only. Replaces the old "rated sessions x tier" points with a
-- ledger of what each player earned per game:
--   played 10   a posted result and a team assignment (A, B or C) for that run
--   win     5   that team won (by score when both scores are set, else winning_team)
--   draw    2   equal scores, or no winning team
--   potd   10   the result's player_of_day
-- Values live in lib/pickup/points.ts (POINTS). No tier or star multiplier.
--
--   * One row per (user_id, run_id, reason). The server writes every row
--     through points_replace_run(), which deletes and reinserts one run's
--     rows in a single transaction, so edits and retries never double count.
--   * season is the game's season in Eastern time, from points_season_label().
--   * RLS on with no policies and no grants to anon/authenticated: only the
--     service role (server) reads or writes this table.
--   * Safe to re-run.
--
-- After this file, run supabase/queries/points_events_backfill.sql once to
-- build rows for games played before the ledger existed.
-- ============================================================

-- Season of a game from its kickoff, in Eastern time. Mirrors seasonForStartAt()
-- in lib/pickup/points.ts exactly; change both together.
--   Fall Sep–Nov "Fall 2026", Spring Mar–May "Spring 2027", Summer Jun–Aug "Summer 2027",
--   Winter Dec–Feb spans two years: Dec 2026–Feb 2027 is "Winter 2026–27".
--   Always the Eastern date: midnight UTC is a real evening kickoff (8pm EDT /
--   7pm EST the previous day). Time-TBD runs store noon Eastern on their day.
create or replace function public.points_season_label(p_start_at timestamptz)
returns text
language sql
immutable
set search_path = public
as $$
  with local as (
    select p_start_at at time zone 'America/New_York' as ts
  ), ym as (
    select extract(year from ts)::int as y, extract(month from ts)::int as m from local
  )
  select case
           when p_start_at is null then null
           when m between 9 and 11 then 'Fall ' || y
           when m between 3 and 5 then 'Spring ' || y
           when m between 6 and 8 then 'Summer ' || y
           when m = 12 then 'Winter ' || y || '–' || lpad(((y + 1) % 100)::text, 2, '0')
           else 'Winter ' || (y - 1) || '–' || lpad((y % 100)::text, 2, '0')
         end
  from ym
$$;

create table if not exists public.points_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  run_id uuid not null references public.pickup_runs (id) on delete cascade,
  reason text not null
    constraint points_events_reason_check
      check (reason in ('played', 'win', 'draw', 'potd')),
  points integer not null,
  season text not null,
  created_at timestamptz not null default now(),
  constraint points_events_user_run_reason_key unique (user_id, run_id, reason)
);

-- Leaderboard: season totals, then per-user totals; run_id for per-run replacement.
create index if not exists points_events_season_user_idx on public.points_events (season, user_id);
create index if not exists points_events_user_idx on public.points_events (user_id);
create index if not exists points_events_run_idx on public.points_events (run_id);

alter table public.points_events enable row level security;
revoke all on table public.points_events from public, anon, authenticated;
grant select, insert, update, delete on table public.points_events to service_role;

-- Replace one run's rows. p_rows is a JSON array of
-- {"user_id": uuid, "reason": text, "points": int, "season": text}; an empty
-- array clears the run (result removed). Runs as one transaction; the advisory
-- lock serialises concurrent saves of the same run.
create or replace function public.points_replace_run(p_run_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('points_events:' || p_run_id::text));
  delete from public.points_events where run_id = p_run_id;
  insert into public.points_events (user_id, run_id, reason, points, season)
  select (r ->> 'user_id')::uuid, p_run_id, r ->> 'reason', (r ->> 'points')::int, r ->> 'season'
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  where exists (select 1 from public.profiles p where p.id = (r ->> 'user_id')::uuid)
  on conflict (user_id, run_id, reason)
    do update set points = excluded.points, season = excluded.season;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.points_replace_run(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.points_replace_run(uuid, jsonb) to service_role;
