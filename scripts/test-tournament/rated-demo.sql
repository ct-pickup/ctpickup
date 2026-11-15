-- Makes the TEST tournament (slug 'test-bracket-demo', created by seed.sql) a RATED test, and gives two of its teams enough players for a
-- match to count. NOT RUN by anyone yet. Run seed.sql first. Nothing here touches any real tournament or any player who is not listed.
--
-- WHAT IT DOES (one transaction, safe to run twice):
--   1. Adds 3 accepted roster players to "Test Team 1" and 3 to "Test Team 2", so group A's match is 4 v 4: the smallest match the rating
--      rule counts (8 players in the match, teams within 1 player of each other).
--   2. Sets the tournament to rated = true, count_for_season = false.
--   Group B's teams stay captain only, so group B's match is 1 v 1: it is saved and shown like any match, but it does NOT count for ratings
--   ("Not counted: too few players"). That shows you both outcomes with 10 accounts in all (the 4 captains and 6 more).
--
-- WHOSE IDS: ids of staff or friends who agreed to be test accounts and know their rating will move a little (about 1 point at most per
-- match for a new player; never more than 3 points in a day). Never random players. Their ratings are put back by cleanup.sql.
--
-- STEP A (names to ids): use the same private SQL Editor query as seed.sql step A for the 6 extra people. Keep names out of this file.
-- STEP B: paste the 6 rows below. STEP C: run the whole file.
--
-- REFUSES TO RUN IF a match of the tournament already has a score. Rated cannot change after the first score (the app enforces it too).
-- THE RATING SWITCHES: ratings only move while the app-wide switches rating_v2 and rating_results are ON. If they are off, the match says
-- "Ratings are switched off for the whole app right now" and nothing moves. This file does not touch those switches.
--
-- TO UNDO EVERYTHING, INCLUDING THE RATINGS: run cleanup.sql. It takes every rating change back out before it deletes anything.

begin;

create temp table rated_demo_ids (n integer primary key, user_id uuid not null unique) on commit drop;
insert into rated_demo_ids (n, user_id) values
  (1, '00000000-0000-0000-0000-000000000011'),
  (2, '00000000-0000-0000-0000-000000000012'),
  (3, '00000000-0000-0000-0000-000000000013'),
  (4, '00000000-0000-0000-0000-000000000014'),
  (5, '00000000-0000-0000-0000-000000000015'),
  (6, '00000000-0000-0000-0000-000000000016');

do $rated$
declare
  c_slug  constant text := 'test-bracket-demo';
  c_title constant text := 'TEST Bracket Demo (delete me)';
  v_tid   uuid;
  v_n     integer;
  v_t1    uuid;
  v_t2    uuid;
begin
  if to_regclass('public.tournament_roster') is null or to_regclass('public.tournaments') is null then
    raise exception 'The tournament tables do not exist in this database. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tournaments' and column_name = 'rated') then
    raise exception 'tournaments.rated does not exist. Apply 20261104000000_tournament_rated_and_match_runs.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tournament_match_rating') is null then
    raise exception 'The rated tournaments migration (20261106000000) has not been applied. Nothing was changed.';
  end if;

  select id into v_tid from public.tournaments where slug = c_slug and title = c_title;
  if v_tid is null then
    raise exception 'The test tournament % does not exist. Run seed.sql first. Nothing was changed.', c_slug;
  end if;

  if exists (select 1 from public.tournament_matches where tournament_id = v_tid and completed_at is not null and coalesce(is_bye, false) = false) then
    raise exception 'A match of the test tournament already has a score, so Rated can no longer be changed. Nothing was changed.';
  end if;

  if exists (select 1 from rated_demo_ids where user_id::text like '00000000-0000-0000-0000-0000000000%') then
    raise exception 'The user ids are still the placeholders. Paste 6 real profiles.id values. Nothing was changed.';
  end if;
  select count(*) into v_n from rated_demo_ids u where not exists (select 1 from public.profiles p where p.id = u.user_id);
  if v_n > 0 then
    raise exception '% of the 6 ids are not in public.profiles. Nothing was changed.', v_n;
  end if;
  -- A player cannot be on two teams, and a captain of the test tournament is already on a team.
  if exists (select 1 from rated_demo_ids u join public.tournament_captains c on c.user_id = u.user_id and c.tournament_id = v_tid) then
    raise exception 'One of the 6 ids is already a captain of the test tournament. Use different people. Nothing was changed.';
  end if;

  select id into v_t1 from public.tournament_captains where tournament_id = v_tid and team_name = 'Test Team 1';
  select id into v_t2 from public.tournament_captains where tournament_id = v_tid and team_name = 'Test Team 2';
  if v_t1 is null or v_t2 is null then
    raise exception 'Test Team 1 or Test Team 2 was not found. Nothing was changed.';
  end if;

  insert into public.tournament_roster (tournament_id, captain_id, user_id, status, invited_at, responded_at)
  select v_tid, case when u.n <= 3 then v_t1 else v_t2 end, u.user_id, 'accepted', now(), now()
    from rated_demo_ids u
   where not exists (select 1 from public.tournament_roster r where r.captain_id in (v_t1, v_t2) and r.user_id = u.user_id);

  update public.tournaments set rated = true, count_for_season = false where id = v_tid;
  raise notice 'Done: test tournament is rated, does not count for the season, and group A is 4 v 4.';
end
$rated$;

commit;
