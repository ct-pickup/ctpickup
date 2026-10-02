-- ============================================================
-- CT Pickup — one-time backfill of points_events from posted results
--
-- Run once, by hand, AFTER supabase/migrations/20261003000000_points_events.sql.
-- It does not depend on 20261002220000_pickup_result_scores_draws.sql: score_a
-- and score_b are read through to_jsonb(), so they count when that migration
-- has run and are simply absent before it.
--
-- Builds the ledger from what actually happened (pickup_run_results and
-- pickup_run_team_assignments), never from player_ratings.sessions or the
-- profile counters.
--
-- Idempotent: delete-and-rebuild inside one transaction. Running it again
-- produces the same rows. Rows the app wrote since the migration are rebuilt
-- from the same results, so nothing is lost.
--
-- Mirrors the TypeScript definitions exactly (tested in __tests__/points):
--   attendance  a pickup_run_team_assignments row with team A, B or C and a
--               posted result for that run. This is the record's "games"
--               (lib/records/playerRecord.ts buildRecordSummaries).
--   winner      outcomeForTeam() in lib/pickup/resultOutcome.ts: when both
--               scores are set, the higher score wins and equal is a draw;
--               otherwise winning_team if it is A, B or C; otherwise a draw.
--   W / D / L   team = winner is a win; no winner is a draw; else a loss.
--   POTD        player_of_day, whether or not they were on a team.
--   points      POINTS in lib/pickup/points.ts: played 10, win 5, draw 2, potd 10.
--   season      points_season_label(start_at), falling back to the result's
--               created_at (pointsEventsForRun() in lib/points/ledger.ts).
--               Always the Eastern date: a midnight UTC start_at is an 8pm
--               EDT / 7pm EST game on the previous Eastern day.
-- ============================================================

begin;

lock table public.points_events in share row exclusive mode;

delete from public.points_events;

with res as (
  select
    r.run_id,
    r.player_of_day,
    r.winning_team,
    r.created_at,
    case when jsonb_typeof(to_jsonb(r) -> 'score_a') = 'number' then (to_jsonb(r) ->> 'score_a')::int end as score_a,
    case when jsonb_typeof(to_jsonb(r) -> 'score_b') = 'number' then (to_jsonb(r) ->> 'score_b')::int end as score_b
  from public.pickup_run_results r
),
decided as (
  select
    res.run_id,
    res.player_of_day,
    case
      when res.score_a is not null and res.score_b is not null then
        case when res.score_a > res.score_b then 'A' when res.score_b > res.score_a then 'B' end
      when res.winning_team in ('A', 'B', 'C') then res.winning_team
    end as winner,
    coalesce(
      public.points_season_label(pr.start_at),
      public.points_season_label(res.created_at),
      public.points_season_label(now())
    ) as season
  from res
  left join public.pickup_runs pr on pr.id = res.run_id
),
played as (
  select a.user_id, d.run_id, d.season, d.winner, a.team
  from decided d
  join public.pickup_run_team_assignments a on a.run_id = d.run_id and a.team in ('A', 'B', 'C')
),
events as (
  select user_id, run_id, 'played'::text as reason, 10 as points, season from played
  union all
  select user_id, run_id, 'win', 5, season from played where winner = team
  union all
  select user_id, run_id, 'draw', 2, season from played where winner is null
  union all
  select player_of_day, run_id, 'potd', 10, season from decided where player_of_day is not null
)
insert into public.points_events (user_id, run_id, reason, points, season)
select e.user_id, e.run_id, e.reason, e.points, e.season
from events e
where exists (select 1 from public.profiles p where p.id = e.user_id)
on conflict (user_id, run_id, reason) do nothing;

commit;


-- ============================================================
-- Verification (read-only). Run after the backfill. Expected: zero rows from
-- the mismatch query, and ledger_played_total equal to expected_played_total.
-- Expected points are recomputed from results the same way as the record
-- helper: 10 x games + 5 x wins + 2 x draws + 10 x POTD.
-- ============================================================

with res as (
  select
    r.run_id,
    r.player_of_day,
    case
      when jsonb_typeof(to_jsonb(r) -> 'score_a') = 'number' and jsonb_typeof(to_jsonb(r) -> 'score_b') = 'number' then
        case
          when (to_jsonb(r) ->> 'score_a')::int > (to_jsonb(r) ->> 'score_b')::int then 'A'
          when (to_jsonb(r) ->> 'score_b')::int > (to_jsonb(r) ->> 'score_a')::int then 'B'
        end
      when r.winning_team in ('A', 'B', 'C') then r.winning_team
    end as winner
  from public.pickup_run_results r
),
per_game as (
  select a.user_id,
         1 as games,
         (res.winner = a.team)::int as wins,
         (res.winner is null)::int as draws,
         0 as potd
  from res
  join public.pickup_run_team_assignments a on a.run_id = res.run_id and a.team in ('A', 'B', 'C')
  union all
  select res.player_of_day, 0, 0, 0, 1 from res where res.player_of_day is not null
),
expected as (
  select user_id,
         sum(games) as games, sum(wins) as wins, sum(draws) as draws, sum(potd) as potd,
         10 * sum(games) + 5 * sum(wins) + 2 * sum(draws) + 10 * sum(potd) as expected_points
  from per_game
  where exists (select 1 from public.profiles p where p.id = per_game.user_id)
  group by user_id
),
ledger as (
  select user_id,
         count(*) filter (where reason = 'played') as games,
         count(*) filter (where reason = 'win') as wins,
         count(*) filter (where reason = 'draw') as draws,
         count(*) filter (where reason = 'potd') as potd,
         sum(points) as ledger_points
  from public.points_events
  group by user_id
)
select coalesce(e.user_id, l.user_id) as user_id,
       e.games as expected_games, l.games as ledger_games,
       e.wins as expected_wins, l.wins as ledger_wins,
       e.draws as expected_draws, l.draws as ledger_draws,
       e.potd as expected_potd, l.potd as ledger_potd,
       e.expected_points, l.ledger_points
from expected e
full join ledger l on l.user_id = e.user_id
where coalesce(e.expected_points, 0) <> coalesce(l.ledger_points, 0)
   or coalesce(e.games, 0) <> coalesce(l.games, 0)
   or coalesce(e.potd, 0) <> coalesce(l.potd, 0)
order by user_id;

-- Summary: totals, players and points per season.
select
  (select count(*) from public.points_events) as ledger_rows,
  (select coalesce(sum(points), 0) from public.points_events) as ledger_total,
  (select count(distinct user_id) from public.points_events) as players,
  (select coalesce(sum(points), 0) from public.points_events where reason = 'played') as ledger_played_total,
  (
    select coalesce(sum(case when a.team in ('A', 'B', 'C') then 10 else 0 end), 0)
    from public.pickup_run_team_assignments a
    where exists (select 1 from public.pickup_run_results r where r.run_id = a.run_id)
      and exists (select 1 from public.profiles p where p.id = a.user_id)
  ) as expected_played_total;

select season, count(distinct user_id) as players, sum(points) as points
from public.points_events
group by season
order by season;
