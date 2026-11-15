-- Removes everything seed.sql created, and nothing else. NOT RUN by anyone yet.
--
-- It finds the test tournament by slug 'test-bracket-demo' AND title 'TEST Bracket Demo (delete me)'. If a tournament has that slug but a
-- different title it refuses, so it can never delete a real tournament that happens to share the slug.
--
-- Deletes, children first, every row that hangs off that one tournament: goals, MVP votes, match to game links, matches, group members,
-- groups, join requests, preliminary rosters, roster, captains, and then the tournament. Tables the database does not have are skipped.
-- The seed makes 4 captain-only teams and no roster rows, but roster rows are cleaned up too in case any were added.
-- Rows are matched by the tournament's id only, so anything real players added to this tournament while it was active goes too.
-- It removes data only: it does not touch any profile, and it sends no notification.
--
-- If the tournament was RATED and matches were scored, it first takes every rating change back out (public.tournament_unrate_tournament),
-- so the test accounts end exactly where they started, and removes the hidden game records and the day rating sessions it created.
--
-- It will NOT delete if the tournament has payment records (a real captain paid). It stops and rolls back so you can refund first.
--
-- It then counts what is left for the tournament in every table, and rolls back with an error if anything remains.
-- SAFE TO RUN TWICE: the second run finds nothing, says so, and changes nothing. One transaction: all or nothing.
-- Scores and standings live on the matches and group members, so they are removed with them. Push notifications already sent stay sent.

begin;

do $cleanup$
declare
  c_slug  constant text := 'test-bracket-demo';
  c_title constant text := 'TEST Bracket Demo (delete me)';
  v_tid   uuid;
  v_n     bigint;
  v_left  bigint;
  r       record;
begin
  if to_regclass('public.tournaments') is null then
    raise notice 'public.tournaments does not exist in this database. Nothing to clean up.';
    return;
  end if;

  select id into v_tid from public.tournaments where slug = c_slug and title = c_title;
  if v_tid is null then
    if exists (select 1 from public.tournaments where slug = c_slug) then
      raise exception 'A tournament with slug % exists but its title is not %. Refusing to delete it.', c_slug, c_title;
    end if;
    raise notice 'Nothing to clean up: no tournament with slug %.', c_slug;
    return;
  end if;

  -- Never delete money records. If a real payment exists, stop here.
  if to_regclass('public.tournament_payments') is not null then
    execute 'select count(*) from public.tournament_payments where tournament_id = $1' into v_n using v_tid;
    if v_n > 0 then
      raise exception 'The test tournament has % payment record(s). Refund them first. Nothing was deleted.', v_n;
    end if;
  end if;

  -- Rated test tournament: take every rating effect back out, and remove the hidden game records and rating sessions it made, BEFORE
  -- the links below are deleted. (Deleting the links first would leave those records behind and the ratings they moved unreversed.)
  -- Does nothing when the rated tournaments migration has not been applied.
  if to_regprocedure('public.tournament_unrate_tournament(uuid)') is not null then
    execute 'select public.tournament_unrate_tournament($1)' into v_n using v_tid;
    raise notice 'Took the rating effect of % scored match record(s) back out.', v_n;
  end if;

  -- Children first. Each row: table, and the condition that ties it to this tournament ($1 is the tournament id).
  for r in
    select * from (values
      (1,  'tournament_match_goals',   'tournament_id = $1'),
      (2,  'tournament_mvp_votes',     'match_id in (select id from public.tournament_matches where tournament_id = $1)'),
      (3,  'tournament_match_runs',    'match_id in (select id from public.tournament_matches where tournament_id = $1)'),
      (4,  'tournament_matches',       'tournament_id = $1'),
      (5,  'tournament_group_members', 'tournament_id = $1'),
      (6,  'tournament_groups',        'tournament_id = $1'),
      (7,  'tournament_join_requests', 'tournament_id = $1'),
      (8,  'tournament_roster_prelim', 'captain_id in (select id from public.tournament_captains where tournament_id = $1)'),
      (9,  'tournament_roster',        'tournament_id = $1'),
      (10, 'tournament_captains',      'tournament_id = $1'),
      (11, 'tournaments',              'id = $1')
    ) as x(step, tbl, cond)
    order by step
  loop
    if to_regclass('public.' || r.tbl) is null then
      raise notice 'Skipped % (table does not exist here).', r.tbl;
      continue;
    end if;
    execute format('delete from public.%I where %s', r.tbl, r.cond) using v_tid;
    get diagnostics v_n = row_count;
    raise notice 'Deleted % row(s) from %.', v_n, r.tbl;
  end loop;

  -- Verify: nothing may remain for this tournament in any of those tables.
  v_left := 0;
  for r in
    select * from (values
      ('tournament_match_goals',   'tournament_id = $1'),
      ('tournament_mvp_votes',     'match_id in (select id from public.tournament_matches where tournament_id = $1)'),
      ('tournament_match_runs',    'match_id in (select id from public.tournament_matches where tournament_id = $1)'),
      ('tournament_matches',       'tournament_id = $1'),
      ('tournament_group_members', 'tournament_id = $1'),
      ('tournament_groups',        'tournament_id = $1'),
      ('tournament_join_requests', 'tournament_id = $1'),
      ('tournament_roster_prelim', 'captain_id in (select id from public.tournament_captains where tournament_id = $1)'),
      ('tournament_roster',        'tournament_id = $1'),
      ('tournament_captains',      'tournament_id = $1'),
      ('tournaments',              'id = $1')
    ) as x(tbl, cond)
  loop
    if to_regclass('public.' || r.tbl) is null then
      continue;
    end if;
    execute format('select count(*) from public.%I where %s', r.tbl, r.cond) into v_n using v_tid;
    if v_n > 0 then
      raise warning '% row(s) still remain in %.', v_n, r.tbl;
    end if;
    v_left := v_left + v_n;
  end loop;

  if v_left > 0 then
    raise exception 'Cleanup is incomplete: % row(s) remain. Everything was rolled back.', v_left;
  end if;
  raise notice 'Cleanup verified: 0 rows remain for slug %.', c_slug;
end
$cleanup$;

commit;

-- Short result (the last thing the editor shows). Every number should be 0.
select (select count(*) from public.tournaments where slug = 'test-bracket-demo') as tournaments_left,
       (select count(*) from public.tournaments where title = 'TEST Bracket Demo (delete me)') as titled_left;
