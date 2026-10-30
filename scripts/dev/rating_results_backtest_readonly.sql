-- ============================================================================================================================
-- Rating results backtest. READ ONLY. Safe to run on PRODUCTION or DEV.
--
-- This file is ONE SELECT statement. It creates nothing, changes nothing, writes nothing and has no side effects. It reads only tables
-- production already has: public.pickup_runs, public.pickup_run_results, public.pickup_run_team_assignments, public.rating_events,
-- public.player_ratings. It needs none of the rating v2 migrations.
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -f scripts/dev/rating_results_backtest_readonly.sql
-- In the Supabase SQL editor, paste the whole statement and run it.
--
-- Question: how well does the team average rating going into a game predict the recorded winner, and how many results would the
-- Phase C rules let count?  Team average = average of rating_events.score_before of the players assigned to the team who were
-- settled in that game's rating session. "Predicted winner" = the team with the higher average. Equal averages are not predictions.
--
-- Returns rows of (section, metric, value, n):
--   games        how many results there are and how many can be looked at at all
--   accuracy     share of decided games where the stronger team (by average) won: overall, by size of the edge, by how experienced
--                the players were (average number of rated games they had before this one), and by month
--   calibration  Brier score of the logistic prediction at scale 12 against always saying 50 percent (lower is better)
--   eligible     results that pass the structural Phase C rules (settled game, two teams, at least 8 attendees, teams within 1 player)
--                and how many players a host's 30 day entry limit (more than 6 results involving one player) would set aside
--   ratings      where today's ratings sit: share at either end, mean, spread. A pile-up at 0 or 100 means the current formula saturates.
-- Nothing here can be verified yet: two-sided confirmation does not exist until Phase C ships, so "eligible" ignores confirmation.
-- Change the numbers in `params` to look at other rules. Small n means a noisy number.
-- ============================================================================================================================
with params as (
  select 8 as min_attendance, 1 as max_team_diff, 6 as host_max_30d, 12.0::numeric as scale, 0.0::numeric as tie_eps
),
res as (
  select r.run_id, r.winning_team, r.total_teams, r.created_at, r.created_by,
         (to_jsonb(p) ->> 'tier_session_id')::uuid as sid, p.start_at
    from public.pickup_run_results r
    join public.pickup_runs p on p.id = r.run_id
),
players as (
  select s.run_id, a.user_id, a.team, re.score_before, re.created_at as rated_at,
         (select count(*) from public.rating_events e2 where e2.user_id = a.user_id and e2.created_at < re.created_at) as prior_games
    from res s
    join public.pickup_run_team_assignments a on a.run_id = s.run_id
    join public.rating_events re on re.session_id = s.sid and re.user_id = a.user_id
   where s.sid is not null
),
game as (
  select s.run_id, s.winning_team, s.total_teams, s.created_at, s.created_by, s.start_at, s.sid,
         count(pl.user_id) as n_players,
         count(*) filter (where pl.team = 'A') as n_a, count(*) filter (where pl.team = 'B') as n_b, count(*) filter (where pl.team = 'C') as n_c,
         avg(pl.score_before) filter (where pl.team = 'A') as avg_a, avg(pl.score_before) filter (where pl.team = 'B') as avg_b,
         avg(pl.prior_games) as avg_prior,
         (select count(*) from public.rating_events e where e.session_id = s.sid) as n_attendees
    from res s
    left join players pl on pl.run_id = s.run_id
   group by s.run_id, s.winning_team, s.total_teams, s.created_at, s.created_by, s.start_at, s.sid
),
decided as (
  select g.*, (g.avg_a - g.avg_b) as diff,
         case when g.avg_a > g.avg_b + (select tie_eps from params) then 'A' when g.avg_b > g.avg_a + (select tie_eps from params) then 'B' end as predicted,
         1 / (1 + exp(-(g.avg_a - g.avg_b) / (select scale from params))) as p_a,
         case g.winning_team when 'A' then 1.0 when 'B' then 0.0 end as a_won
    from game g
   where g.total_teams = 2 and g.winning_team in ('A', 'B') and g.n_a >= 1 and g.n_b >= 1 and g.n_c = 0
),
scored as (
  select d.*, (d.predicted = d.winning_team) as hit,
         case when abs(d.diff) < 5 then '1) edge under 5 points'
              when abs(d.diff) < 10 then '2) edge 5 to 10'
              when abs(d.diff) < 20 then '3) edge 10 to 20'
              else '4) edge 20 or more' end as edge_bucket,
         case when d.avg_prior < 3 then '1) under 3 rated games each'
              when d.avg_prior < 6 then '2) 3 to 5'
              when d.avg_prior < 11 then '3) 6 to 10'
              else '4) 11 or more' end as exp_bucket,
         to_char(date_trunc('month', coalesce(d.start_at, d.created_at)), 'YYYY-MM') as month
    from decided d
   where d.predicted is not null
),
host_counts as (
  -- for each result and each player in it: results the same entering account made involving that player in the 30 days up to this one
  select g.run_id, pl.user_id,
         (select count(*) from public.pickup_run_results r3
            join public.pickup_run_team_assignments a3 on a3.run_id = r3.run_id and a3.user_id = pl.user_id
           where r3.created_by is not distinct from g.created_by
             and r3.created_at between g.created_at - interval '30 days' and g.created_at) as host_results
    from game g join players pl on pl.run_id = g.run_id
),
structural as (
  select g.* from game g, params p
   where g.sid is not null and g.total_teams = 2 and g.n_c = 0 and g.n_a >= 1 and g.n_b >= 1
     and g.n_attendees >= p.min_attendance and abs(g.n_a - g.n_b) <= p.max_team_diff
),
rows_ as (
  select 'games' as section, 'results posted' as metric, count(*)::text as value, count(*) as n from public.pickup_run_results
  union all select 'games', 'results with a settled rating session', count(*)::text, count(*) from game where sid is not null
  union all select 'games', 'two-team results with a decided winner and both team averages', count(*)::text, count(*) from decided
  union all select 'games', 'draws (no winner recorded)', count(*)::text, count(*) from res where winning_team is null
  union all select 'games', 'three-team results', count(*)::text, count(*) from res where total_teams = 3
  union all select 'accuracy', 'stronger team won, all games', round(100.0 * avg(case when hit then 1 else 0 end), 1)::text || '%', count(*) from scored
  union all select 'accuracy', 'coin flip would be', '50.0%', count(*) from scored
  union all select 'accuracy', edge_bucket, round(100.0 * avg(case when hit then 1 else 0 end), 1)::text || '%', count(*) from scored group by edge_bucket
  union all select 'accuracy', exp_bucket, round(100.0 * avg(case when hit then 1 else 0 end), 1)::text || '%', count(*) from scored group by exp_bucket
  union all select 'accuracy', 'month ' || month, round(100.0 * avg(case when hit then 1 else 0 end), 1)::text || '%', count(*) from scored group by month
  union all select 'calibration', 'Brier score of the logistic prediction (scale ' || (select scale from params)::text || ')', round(avg(power(d.p_a - d.a_won, 2)), 4)::text, count(*) from decided d
  union all select 'calibration', 'Brier score of always saying 50 percent', '0.2500', count(*) from decided
  union all select 'eligible', 'results passing the structural rules (settled, two teams, minimum attendance, even teams)', count(*)::text, count(*) from structural
  union all select 'eligible', 'of those, share of all results', round(100.0 * (select count(*) from structural) / nullif((select count(*) from res), 0), 1)::text || '%', (select count(*) from res)
  union all select 'eligible', 'results failing on attendance', count(*)::text, count(*) from game, params where sid is not null and total_teams = 2 and n_attendees < min_attendance
  union all select 'eligible', 'results failing on uneven teams', count(*)::text, count(*) from game, params where sid is not null and total_teams = 2 and abs(n_a - n_b) > max_team_diff
  union all select 'eligible', 'results with no settled rating session (never rated)', count(*)::text, count(*) from game where sid is null
  union all select 'eligible', 'player slots a host entry limit would set aside', count(*)::text, (select count(*) from host_counts)
    from host_counts, params where host_results > host_max_30d
  union all select 'eligible', 'structural results where the limit sets aside at least one player', count(distinct s.run_id)::text, (select count(*) from structural)
    from structural s join host_counts h on h.run_id = s.run_id, params where h.host_results > host_max_30d
  union all select 'ratings', 'players rated', count(*)::text, count(*) from public.player_ratings
  union all select 'ratings', 'share at 5 or below', round(100.0 * avg(case when score <= 5 then 1 else 0 end), 1)::text || '%', count(*) from public.player_ratings
  union all select 'ratings', 'share at 95 or above', round(100.0 * avg(case when score >= 95 then 1 else 0 end), 1)::text || '%', count(*) from public.player_ratings
  union all select 'ratings', 'mean score', round(avg(score), 1)::text, count(*) from public.player_ratings
  union all select 'ratings', 'standard deviation', round(coalesce(stddev_samp(score), 0), 1)::text, count(*) from public.player_ratings
  union all select 'ratings', 'score deciles (10th, 50th, 90th)', round(percentile_cont(0.1) within group (order by score)::numeric, 1)::text || ' / '
         || round(percentile_cont(0.5) within group (order by score)::numeric, 1)::text || ' / ' || round(percentile_cont(0.9) within group (order by score)::numeric, 1)::text, count(*) from public.player_ratings
)
select section, metric, value, n from rows_ order by section, metric;
