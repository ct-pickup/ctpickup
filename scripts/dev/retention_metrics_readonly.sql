-- ============================================================================================================================
-- Retention headline numbers from the tables production already has. READ ONLY.
--
-- This file is ONE SELECT statement. It creates nothing, changes nothing, writes nothing and has no side effects, so it is safe to run
-- on PRODUCTION or DEV. It reads only: public.pickup_runs, public.pickup_run_rsvps, public.pickup_run_attendance, public.profiles.
-- It needs none of the new analytics tables or migrations, so you can run it today to get a baseline before anything else ships.
--
-- Run it (belt and braces: the session is read only, so even a typo cannot write):
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -f scripts/dev/retention_metrics_readonly.sql
-- In the Supabase SQL editor, paste the whole statement and run it.
--
-- It returns ONE row. How each number is worked out (change the three values in `params` to look at another window):
--
--   second_game_30d_pct      Players whose first game is at least 30 days old. Of those, the percent who played a DIFFERENT game within
--                            30 days after their first. "Played" means a pickup_run_attendance row with attended = true, dated by the
--                            game's start time. Players with no first game yet are not in the number.
--   median_days_to_first_game / avg_days_to_first_game
--                            Days from profiles.created_at (the account) to the start of the first game the player attended. This counts
--                            the wait for approval too. Only players who have played. (Approval time is not stored in the old tables;
--                            the new profiles.approved_at fixes that going forward.)
--   fill_pct                 For games that already started in the last `window_days` days and were not cancelled: average of
--                            confirmed RSVPs over capacity, held at 100. Games with no capacity are skipped.
--   full_games_pct           Percent of those games that reached at least 80 percent of capacity.
--   no_show_pct              Of attendance rows marked in the same window, the percent marked attended = false.
--
-- The supporting counts (n_*) say how many players, games and marks each percent is based on. A small n means a noisy number.
-- ============================================================================================================================
with params as (
  select 90 as window_days,           -- the look-back for fill and no-show
         30 as return_days,           -- "played again within" this many days
         0.8::numeric as full_share   -- a game counts as full at this share of capacity
),
played as (
  -- one row per (player, game they attended), dated by the game's start
  select a.user_id, a.run_id, r.start_at
    from public.pickup_run_attendance a
    join public.pickup_runs r on r.id = a.run_id
   where a.attended is true and r.start_at is not null
),
first_game as (
  select distinct on (user_id) user_id, run_id as first_run_id, start_at as first_start
    from played
   order by user_id, start_at, run_id
),
second_game as (
  select f.user_id, f.first_start,
         exists (
           select 1 from played p, params
            where p.user_id = f.user_id and p.run_id <> f.first_run_id
              and p.start_at > f.first_start
              and p.start_at <= f.first_start + make_interval(days => params.return_days)
         ) as came_back
    from first_game f, params
   where f.first_start <= now() - make_interval(days => params.return_days)   -- the 30 days are over for everyone counted
),
to_first as (
  select extract(epoch from (f.first_start - p.created_at)) / 86400.0 as days
    from first_game f
    join public.profiles p on p.id = f.user_id
   where p.created_at is not null and f.first_start >= p.created_at
),
recent_runs as (
  select r.id, r.capacity,
         (select count(*) from public.pickup_run_rsvps s where s.run_id = r.id and s.status = 'confirmed') as confirmed
    from public.pickup_runs r, params
   where r.start_at <= now() and r.start_at >= now() - make_interval(days => params.window_days)
     and coalesce(r.status, '') not in ('cancelled', 'canceled')
     and r.capacity > 0
),
recent_marks as (
  select a.attended
    from public.pickup_run_attendance a
    join public.pickup_runs r on r.id = a.run_id, params
   where r.start_at <= now() and r.start_at >= now() - make_interval(days => params.window_days)
     and a.attended is not null
)
select
  (select count(*) from second_game)                                                                        as n_players_30d_old,
  round(100.0 * (select count(*) filter (where came_back) from second_game)
        / nullif((select count(*) from second_game), 0), 1)                                                 as second_game_30d_pct,
  (select count(*) from to_first)                                                                           as n_players_played,
  round((select percentile_cont(0.5) within group (order by days) from to_first)::numeric, 1)               as median_days_to_first_game,
  round((select avg(days) from to_first)::numeric, 1)                                                       as avg_days_to_first_game,
  (select count(*) from recent_runs)                                                                        as n_games,
  round(100.0 * (select avg(least(1.0, confirmed::numeric / capacity)) from recent_runs), 1)                as fill_pct,
  round(100.0 * (select count(*) filter (where confirmed >= (select full_share from params) * capacity) from recent_runs)
        / nullif((select count(*) from recent_runs), 0), 1)                                                 as full_games_pct,
  (select count(*) from recent_marks)                                                                       as n_attendance_marks,
  round(100.0 * (select count(*) filter (where attended is false) from recent_marks)
        / nullif((select count(*) from recent_marks), 0), 1)                                                as no_show_pct;
