-- ============================================================================================================================
-- Where ratings sit today. READ ONLY. Safe to run on PRODUCTION or DEV. Run it once before turning rating_v2 on, and again later to compare.
--
-- This file is ONE SELECT statement. It creates nothing, changes nothing, writes nothing and has no side effects. It reads only
-- public.player_ratings and public.rating_events, which production already has. It needs none of the rating v2 migrations.
--
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -X -f scripts/dev/rating_distribution_readonly.sql
-- In the Supabase SQL editor, paste the whole statement and run it.
--
-- Rows of (section, metric, value, n):
--   scale     how many players are rated, how many sit at exactly 0 and at exactly 100, at 5 or below and 95 or above, mean, spread, deciles
--   stars     how many players per star band (player_ratings.star_rating; "none" where it is not set or the column does not exist yet)
--   tier      how many players per internal tier column (internal only, never shown to players)
--   first5    among players with at least one rated session: how many reached 100 (and 95 or more, and 0) within their first 5 rated
--             sessions, how many did it in their very first session, and the median number of rated sessions they had played so far
--   sessions  how many rated sessions players have: none, 1 to 4, 5 to 9, 10 or more
-- A pile-up at 0 or 100, or many players at 100 within five sessions, means the current formula saturates.
-- "Rated session" = a row in rating_events (one per player per settled game). Order is by when the row was written.
-- ============================================================================================================================
with ratings as (
  select pr.user_id, pr.score, pr.sessions, pr.tier,
         nullif(to_jsonb(pr) ->> 'star_rating', '') as star_rating
    from public.player_ratings pr
),
ev as (
  select re.user_id, re.score_after,
         row_number() over (partition by re.user_id order by re.created_at, re.id) as nth
    from public.rating_events re
),
first5 as (
  select e.user_id,
         max(e.score_after) as best, min(e.score_after) as worst,
         bool_or(e.nth = 1 and e.score_after >= 100) as at100_first,
         min(e.nth) filter (where e.score_after >= 100) as nth_at100,
         count(*) as n_events
    from ev e where e.nth <= 5 group by e.user_id
),
rows_ as (
  select 'scale' as section, 'players rated' as metric, count(*)::text as value, count(*) as n from ratings
  union all select 'scale', 'at exactly 0', count(*) filter (where score = 0)::text, count(*) from ratings
  union all select 'scale', 'at exactly 100', count(*) filter (where score = 100)::text, count(*) from ratings
  union all select 'scale', 'at 5 or below (share)', round(100.0 * avg(case when score <= 5 then 1 else 0 end), 1)::text || '%', count(*) from ratings
  union all select 'scale', 'at 95 or above (share)', round(100.0 * avg(case when score >= 95 then 1 else 0 end), 1)::text || '%', count(*) from ratings
  union all select 'scale', 'mean score', round(avg(score), 1)::text, count(*) from ratings
  union all select 'scale', 'standard deviation', round(coalesce(stddev_samp(score), 0), 1)::text, count(*) from ratings
  union all select 'scale', 'score deciles (10th / 50th / 90th)',
         round(percentile_cont(0.1) within group (order by score)::numeric, 1)::text || ' / ' || round(percentile_cont(0.5) within group (order by score)::numeric, 1)::text
         || ' / ' || round(percentile_cont(0.9) within group (order by score)::numeric, 1)::text, count(*) from ratings
  union all select 'stars', 'star band ' || coalesce(star_rating, 'none'), count(*)::text, count(*) from ratings group by star_rating
  union all select 'tier', 'tier ' || coalesce(tier, 'none'), count(*)::text, count(*) from ratings group by tier
  union all select 'first5', 'players with at least one rated session', count(*)::text, count(*) from first5
  union all select 'first5', 'reached 100 within their first 5 rated sessions', count(*) filter (where best >= 100)::text, count(*) from first5
  union all select 'first5', 'reached 100 within the first 5, share', round(100.0 * avg(case when best >= 100 then 1 else 0 end), 1)::text || '%', count(*) from first5
  union all select 'first5', 'reached 95 or more within the first 5, share', round(100.0 * avg(case when best >= 95 then 1 else 0 end), 1)::text || '%', count(*) from first5
  union all select 'first5', 'fell to 0 within the first 5, share', round(100.0 * avg(case when worst <= 0 then 1 else 0 end), 1)::text || '%', count(*) from first5
  union all select 'first5', 'reached 100 in their very first rated session', count(*) filter (where at100_first)::text, count(*) from first5
  union all select 'first5', 'median rated session at which 100 was first reached', coalesce(round((percentile_cont(0.5) within group (order by nth_at100))::numeric, 1)::text, 'none'), count(nth_at100) from first5
  union all select 'sessions', 'no rated sessions', count(*)::text, count(*) from ratings r where not exists (select 1 from first5 f where f.user_id = r.user_id)
  union all select 'sessions', '1 to 4 rated sessions', count(*)::text, count(*) from first5 where n_events between 1 and 4
  union all select 'sessions', '5 or more rated sessions', count(*)::text, count(*) from first5 where n_events >= 5
)
select section, metric, value, n from rows_ order by section, metric;
