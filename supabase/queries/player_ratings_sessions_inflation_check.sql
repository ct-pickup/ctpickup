-- Read-only. How far player_ratings.sessions is above the number of rated games.
--
-- Until the fix, player_ratings.sessions was raised in two places:
--   * settle_session(): +1 per rated game, one rating_events row each time;
--   * POST /api/sessions/result (host posts the first result): +1 for every
--     confirmed or pending_payment RSVP, rated or not, or a new row with sessions = 1.
-- settle_session is now the only writer, so a correct value equals the
-- player's rating_events count. Nothing here writes. The backfill is
-- player_ratings_sessions_correction.sql (preview: player_ratings_sessions_preview.sql).
--
-- extra_sessions     = sessions - rated_games (the inflation; 0 when correct).
-- result_runs_upper  = runs with a posted result where the player has a
--                      confirmed/pending_payment RSVP today. Upper bound on the
--                      host-route bumps (admin-posted results never bumped,
--                      and RSVP status can change after the result).

with rated as (
  select user_id, count(*)::int as rated_games
    from public.rating_events
   group by user_id
),
result_runs as (
  select r.user_id, count(distinct r.run_id)::int as result_runs_upper
    from public.pickup_run_rsvps r
    join public.pickup_run_results res on res.run_id = r.run_id
   where r.status in ('confirmed', 'pending_payment')
   group by r.user_id
)
select pr.user_id,
       p.first_name,
       p.last_name,
       pr.sessions,
       coalesce(rt.rated_games, 0)                       as rated_games,
       pr.sessions - coalesce(rt.rated_games, 0)         as extra_sessions,
       coalesce(rr.result_runs_upper, 0)                 as result_runs_upper
  from public.player_ratings pr
  left join public.profiles p on p.id = pr.user_id
  left join rated rt on rt.user_id = pr.user_id
  left join result_runs rr on rr.user_id = pr.user_id
 where pr.sessions <> coalesce(rt.rated_games, 0)
 order by extra_sessions desc, pr.user_id;

-- Totals: how many players are affected and by how much.
with rated as (
  select user_id, count(*)::int as rated_games
    from public.rating_events
   group by user_id
)
select count(*)                                                         as players_with_ratings,
       count(*) filter (where pr.sessions > coalesce(rt.rated_games, 0)) as players_inflated,
       coalesce(sum(greatest(0, pr.sessions - coalesce(rt.rated_games, 0))), 0) as total_extra_sessions,
       max(pr.sessions - coalesce(rt.rated_games, 0))                   as max_extra_sessions,
       round(avg(pr.sessions::numeric / nullif(rt.rated_games, 0)), 2)  as avg_ratio_sessions_to_rated
  from public.player_ratings pr
  left join rated rt on rt.user_id = pr.user_id;
