-- Read-only. Preview of player_ratings_sessions_correction.sql: stored
-- player_ratings.sessions against the true count, per player and in total.
--
-- True count = the player's rows in rating_events.
--   * settle_session (20260708000001_tier_system.sql) inserts one
--     rating_events row per rated player and, in the same statement, does
--     sessions = sessions + 1 for exactly the rows it inserted
--     (update ... from written w). Nothing else inserts into rating_events
--     and, since d4628d3, nothing else changes sessions. So after the
--     correction, sessions and this count move together.
--   * rating_events has unique (session_id, user_id), so count(*) equals
--     count(distinct session_id). It has no event-type column: every row
--     is a settled session.
--   * Not settled attendance: settle_session skips attendees without an
--     organizer_score or without a player_ratings row, and does not count
--     no-shows, so attendance would overcount what settle_session counts.
--   * Rows created by the admin routes or by the ignoreDuplicates upserts
--     never set sessions (default 0) and have no rating_events, so they
--     come out correct and are untouched.
--
-- Points come from points_events (9e247a1), not sessions, except in the
-- App Store v1.3.5 app, which shows sessions x tier. For an inflated player
-- those old-app points fall by stored_sessions / true_sessions.

-- 1. Per player, only rows the correction would change.
with rated as (
  select user_id, count(*)::int as true_sessions
    from public.rating_events
   group by user_id
),
cmp as (
  select pr.user_id,
         pr.sessions                                  as stored_sessions,
         coalesce(rt.true_sessions, 0)                as true_sessions,
         pr.sessions - coalesce(rt.true_sessions, 0)  as difference
    from public.player_ratings pr
    left join rated rt on rt.user_id = pr.user_id
)
select c.user_id,
       p.first_name,
       p.last_name,
       c.stored_sessions,
       c.true_sessions,
       c.difference
  from cmp c
  left join public.profiles p on p.id = c.user_id
 where c.difference <> 0
 order by c.difference desc, c.user_id;

-- 2. Summary.
with rated as (
  select user_id, count(*)::int as true_sessions
    from public.rating_events
   group by user_id
),
cmp as (
  select pr.sessions - coalesce(rt.true_sessions, 0) as difference
    from public.player_ratings pr
    left join rated rt on rt.user_id = pr.user_id
)
select count(*)                                                  as players_with_ratings,
       count(*) filter (where difference = 0)                    as players_correct,
       count(*) filter (where difference > 0)                    as players_inflated,
       round(avg(difference) filter (where difference > 0), 2)   as avg_inflation,
       max(difference) filter (where difference > 0)             as max_inflation,
       coalesce(sum(difference) filter (where difference > 0), 0) as total_extra_sessions,
       count(*) filter (where difference < 0)                    as players_undercounted,
       min(difference) filter (where difference < 0)             as worst_undercount
  from cmp;

-- 3. rating_events for users with no player_ratings row (expected 0; the
--    correction cannot and does not create rows for them).
select count(distinct e.user_id) as users_without_ratings_row,
       count(*)                  as their_rating_events
  from public.rating_events e
 where not exists (select 1 from public.player_ratings pr where pr.user_id = e.user_id);

-- 4. Live triggers on player_ratings. The correction expects only
--    player_ratings_set_star (BEFORE INSERT OR UPDATE OF score, verification,
--    reliability). tgattr lists the UPDATE OF columns; empty means any column.
select t.tgname,
       t.tgenabled,
       (t.tgtype & 16) <> 0 as fires_on_update,
       array(select a.attname
               from unnest(t.tgattr::int2[]) as k(attnum)
               join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.attnum) as update_of_columns,
       pg_get_triggerdef(t.oid, true) as definition
  from pg_trigger t
 where not t.tgisinternal
   and t.tgrelid = 'public.player_ratings'::regclass
 order by t.tgname;
