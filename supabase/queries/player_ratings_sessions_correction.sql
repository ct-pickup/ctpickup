-- ONE-OFF WRITE. Sets player_ratings.sessions to the player's rating_events count.
--
-- RUN ONLY AFTER d4628d3 IS DEPLOYED TO PRODUCTION (the web app serving
-- POST /api/sessions/result). Before d4628d3 that route added +1 to
-- sessions for every confirmed/pending_payment attendee when a host posted
-- the first result, on top of settle_session's +1 per rated game. Running
-- this while the old route is live corrects the numbers and then the next
-- posted result inflates them again, and any result posted between the
-- route's bump and settle_session leaves a fresh +1 behind.
--
-- Run it on the day the new build ships with a forced update, and not
-- before. App Store v1.3.5 shows points as sessions x tier (the legacy API
-- branch still serves it sessions), so this roughly halves the points that
-- app displays for most players. The new app takes points from
-- points_events (9e247a1) and is unaffected.
--
-- Preview first: supabase/queries/player_ratings_sessions_preview.sql.
--
-- True count: rows in rating_events per user. settle_session inserts one
-- rating_events row per rated player and increments sessions for exactly
-- those rows in the same statement, so from here on both move together.
-- (unique (session_id, user_id): one row per settled session; no event types.)
--
-- Only sessions changes. score, tier, star_rating, star_provisional,
-- reliability and updated_at are not in the SET list:
--   * The only trigger on player_ratings in the migrations is
--     player_ratings_set_star, BEFORE INSERT OR UPDATE OF score,
--     verification, reliability (20261002150000_star_ratings.sql). A column
--     trigger fires only when one of its columns is in the UPDATE's SET
--     list, so UPDATE ... SET sessions does not fire it. There is no
--     updated_at trigger; updated_at is only written explicitly by
--     settle_session, apply_vouch and the admin routes. Step 2 checks the
--     live database and aborts if any enabled trigger would fire on an
--     UPDATE of sessions, rather than disabling triggers.
--   * tier is generated from score, verification and reliability, none of
--     which change, so it keeps its value.
--   * Nothing replays rating_events: past scores and stars stay as they are.
--     sessions only feeds settle_session's k factor and organizer weight for
--     future games, plus displays: the sessions count on profiles and
--     rankings, the legacy player_cards column, and v1.3.5 points.
--
-- In psql, run through step 5, read its output, then COMMIT or ROLLBACK.
-- The Supabase SQL editor runs the whole script at once: run the preview
-- first; steps 2 and 4 abort the transaction if anything is off.

begin;

set local lock_timeout = '10s';

-- Block settle_session (inserts into rating_events, then updates
-- player_ratings) until commit, so the counts cannot move under us.
-- Same order as settle_session takes them, so no deadlock.
lock table public.rating_events in share mode;
lock table public.player_ratings in share row exclusive mode;

-- 1. Backup. IF NOT EXISTS: a re-run keeps the original snapshot.
create table if not exists public.player_ratings_sessions_backup_20261002 as
  select user_id, sessions from public.player_ratings;

-- public schema is exposed through the API; keep the backup server-only.
alter table public.player_ratings_sessions_backup_20261002 enable row level security;
revoke all on table public.player_ratings_sessions_backup_20261002 from public, anon, authenticated;

-- 2. Abort if any enabled trigger on player_ratings fires on UPDATE of
--    sessions (an UPDATE trigger with no column list, or one listing sessions).
do $guard$
declare
  sessions_attnum smallint;
  offenders text;
begin
  select attnum into sessions_attnum
    from pg_attribute
   where attrelid = 'public.player_ratings'::regclass and attname = 'sessions';

  select string_agg(t.tgname, ', ') into offenders
    from pg_trigger t
   where t.tgrelid = 'public.player_ratings'::regclass
     and not t.tgisinternal
     and t.tgenabled <> 'D'
     and (t.tgtype & 16) <> 0
     and (cardinality(t.tgattr::int2[]) = 0 or sessions_attnum = any (t.tgattr::int2[]));

  if offenders is not null then
    raise exception 'Trigger(s) on player_ratings fire on UPDATE of sessions: %. Review before correcting.', offenders;
  end if;
end;
$guard$;

-- 3. The correction. One UPDATE, only rows whose numbers differ.
create temp table player_ratings_sessions_changed (
  user_id      uuid primary key,
  old_sessions integer not null,
  new_sessions integer not null
) on commit drop;

with rated as (
  select user_id, count(*)::int as true_sessions
    from public.rating_events
   group by user_id
),
target as (
  select pr.user_id, pr.sessions as old_sessions, coalesce(rt.true_sessions, 0) as new_sessions
    from public.player_ratings pr
    left join rated rt on rt.user_id = pr.user_id
   where pr.sessions <> coalesce(rt.true_sessions, 0)
),
updated as (
  update public.player_ratings pr
     set sessions = t.new_sessions
    from target t
   where pr.user_id = t.user_id
  returning pr.user_id, t.old_sessions, pr.sessions as new_sessions
)
insert into player_ratings_sessions_changed (user_id, old_sessions, new_sessions)
select user_id, old_sessions, new_sessions from updated;

-- 4. Every row now matches; otherwise abort and roll back.
do $verify$
declare
  remaining integer;
begin
  select count(*) into remaining
    from public.player_ratings pr
   where pr.sessions <> (select count(*) from public.rating_events e where e.user_id = pr.user_id);
  if remaining > 0 then
    raise exception '% player_ratings rows still differ from rating_events', remaining;
  end if;
end;
$verify$;

-- 5. Summary of affected rows (review before COMMIT).
select count(*)                                                       as rows_updated,
       count(*) filter (where old_sessions > new_sessions)            as rows_lowered,
       count(*) filter (where old_sessions < new_sessions)            as rows_raised,
       coalesce(sum(old_sessions - new_sessions), 0)                  as net_sessions_removed,
       max(old_sessions - new_sessions)                               as max_lowered_by
  from player_ratings_sessions_changed;

select c.user_id, p.first_name, p.last_name, c.old_sessions, c.new_sessions,
       c.old_sessions - c.new_sessions as removed
  from player_ratings_sessions_changed c
  left join public.profiles p on p.id = c.user_id
 order by removed desc, c.user_id;

commit;

-- ============================================================
-- Rollback (run manually if needed). Restores the backup snapshot exactly.
-- Games settled after the correction added +1 on top of the corrected value;
-- restoring the snapshot discards those increments, so roll back promptly
-- or add them back by hand.
--
-- begin;
-- update public.player_ratings pr
--    set sessions = b.sessions
--   from public.player_ratings_sessions_backup_20261002 b
--  where b.user_id = pr.user_id
--    and pr.sessions <> b.sessions;
-- commit;
--
-- Once no longer needed:
-- drop table if exists public.player_ratings_sessions_backup_20261002;
-- ============================================================
