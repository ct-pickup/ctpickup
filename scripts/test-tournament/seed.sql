-- TEST tournament seed: the smallest bracket the app supports, clearly labeled, INACTIVE until you switch it on.
-- NOT RUN by anyone yet. Read this header, paste 4 user ids below, then run the whole file once.
--
-- WHAT IT CREATES (everything hangs off one tournaments row with slug 'test-bracket-demo'):
--   1 tournament      "TEST Bracket Demo (delete me)", start_at tomorrow 2:00 PM Eastern, is_active FALSE,
--                     rated false, count_for_season false, min_roster_players 1 (so a captain-only team is valid)
--   4 teams           tournament_captains "Test Team 1" to "Test Team 4", status confirmed, captain_verified true.
--                     Each team is its captain alone: there are no tournament_roster rows.
--   2 groups of 2     tournament_groups A (Test Team 1, 2) and B (Test Team 3, 4), with their tournament_group_members
--   2 group matches   tournament_matches, no scores, scheduled 30 minutes apart
--
-- WHY THIS SIZE: it is the smallest shape that still plays every part of the app. Group scores, then "Generate Knockout" (2 groups of
-- 2 send everyone through as 2 semi-finals), a semi-final that ends level and needs a penalty winner, and the final. Four user ids.
-- "Generate Groups" needs 8 to 12 teams, so on this tournament it just answers "Need 8-12 paid teams" and changes nothing.
--
-- WHOSE IDS: paste ids of staff or friends who agreed to be test accounts, never random players. Their first name and last initial
-- show on the player bracket while the tournament is active, and they are the captains.
--
-- NO NOTIFICATIONS: the server never sends a push for a tournament whose slug starts with "test-". Not "Tournament is live" (even from
-- Make live), not "Bracket is live", not "Vote for Match MVP", not reminders. This is checked in the one place every push goes through.
--
-- STEP A. FIND THE IDS BY NAME. Open a PRIVATE SQL Editor tab and run the query below, typing the 4 people's names into that tab.
--   The result contains names. Keep it in your private editor: do not save it, screenshot it, share it, or paste names into this file
--   or any file in the repo. From the result, copy only the paste_row values (they hold ids, not names).
--
--   with wanted(n, first_name, last_name) as (
--     values
--       (1, 'FIRST NAME 1', 'LAST NAME 1'),
--       (2, 'FIRST NAME 2', 'LAST NAME 2'),
--       (3, 'FIRST NAME 3', 'LAST NAME 3'),
--       (4, 'FIRST NAME 4', 'LAST NAME 4')
--   )
--   select w.n,
--          p.id,
--          p.first_name,
--          p.last_name,
--          count(*) over (partition by w.n) as matches_for_this_name,
--          format('  (%s, %L)', w.n, p.id) as paste_row
--     from wanted w
--     left join public.profiles p
--       on lower(trim(p.first_name)) = lower(trim(w.first_name))
--      and lower(trim(p.last_name))  = lower(trim(w.last_name))
--    order by w.n, p.id;
--
--   Each n must show matches_for_this_name = 1. 0 means no profile has that name (id is empty). 2 or more means two people share it:
--   tell them apart some other way (for example by the email on their account in Authentication) and use the right id.
--
-- STEP B. PASTE THE 4 ROWS into the VALUES list in step 1 below, replacing the placeholder rows. The last row ends with a semicolon.
--   Keep the filled-in copy in your editor. Do not commit this file with real ids in it.
--
-- STEP C. RUN THE WHOLE FILE ONCE. Safe to run twice: if the tournament already exists, the second run changes nothing and says so.
--   One transaction: any problem (missing table, an id that is not a profile) rolls everything back.
--
-- IS IT VISIBLE? It is created with is_active FALSE.
--   Admin, any time: Admin > Tournaments > the "Upcoming" tab (or "All"). The default "Active" tab will not list it. Tap Bracket.
--   Players, only after you switch it on. The app shows one live tournament per region and looks it up with maybeSingle, so TWO active
--   tournaments in the same region break the real tournament page for everyone. Switch it on only when no real tournament is live:
--
--     update public.tournaments set is_active = true
--      where slug = 'test-bracket-demo'
--        and not exists (select 1 from public.tournaments t2 where t2.is_active and t2.service_region is null);
--
--   (If it says UPDATE 0, another tournament is live in the same region. Do not force it.) While it is active, EVERY approved player sees
--   the "TEST Bracket Demo (delete me)" card on Home and in the Events tab, and can open the bracket. Switch it off again with:
--
--     update public.tournaments set is_active = false where slug = 'test-bracket-demo';
--
--   Do not use the app's "Make live" button for this while a real tournament is live: it turns that one off.
--
-- TO REMOVE EVERYTHING: run cleanup.sql in this folder.

begin;

-- ------------------------------------------------------------------------------------------------------------------------------
-- STEP 1: PASTE YOUR 4 USER IDS HERE (profiles.id). The all-zero ids below are placeholders, and the script refuses to run with them.
-- ------------------------------------------------------------------------------------------------------------------------------
create temp table test_user_ids (
  n       integer primary key,
  user_id uuid not null unique
) on commit drop;

insert into test_user_ids (n, user_id) values
  (1, '00000000-0000-0000-0000-000000000001'),
  (2, '00000000-0000-0000-0000-000000000002'),
  (3, '00000000-0000-0000-0000-000000000003'),
  (4, '00000000-0000-0000-0000-000000000004');

-- ------------------------------------------------------------------------------------------------------------------------------
-- STEP 2: everything else. Nothing below needs editing.
-- ------------------------------------------------------------------------------------------------------------------------------
do $seed$
declare
  c_slug   constant text := 'test-bracket-demo';
  c_title  constant text := 'TEST Bracket Demo (delete me)';
  c_region constant text := null;          -- null = legacy hub, visible whichever state a player picks once it is active
  v_tid     uuid;
  v_start   timestamptz;
  v_caps    uuid[] := '{}';
  v_cap     uuid;
  v_gid     uuid;
  v_group   text;
  v_base    integer;
  v_match   integer := 0;
  v_max     integer := 4;
  v_missing integer;
  t         text;
  i         integer;
  g         integer;
begin
  -- The production tournament tables must all be here. This database may not have them (DEV): stop with a clear message.
  foreach t in array array['tournaments', 'tournament_captains', 'tournament_groups', 'tournament_group_members', 'tournament_matches'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Table public.% does not exist in this database. Nothing was created.', t;
    end if;
  end loop;

  -- Run twice: leave the first run alone.
  if exists (select 1 from public.tournaments where slug = c_slug) then
    raise notice 'Already seeded (slug %). Nothing changed. Run cleanup.sql first if you want a fresh copy.', c_slug;
    return;
  end if;

  -- The ids must be real profiles and not the placeholders.
  if exists (select 1 from test_user_ids where user_id::text like '00000000-0000-0000-0000-0000000000%') then
    raise exception 'The user ids are still the placeholders. Paste 4 real profiles.id values into STEP 1.';
  end if;
  select count(*) into v_missing from test_user_ids u where not exists (select 1 from public.profiles p where p.id = u.user_id);
  if v_missing > 0 then
    raise exception '% of the 4 ids are not in public.profiles. Nothing was created.', v_missing;
  end if;

  -- Tomorrow 2:00 PM Eastern.
  v_start := ((date_trunc('day', now() at time zone 'America/New_York') + interval '1 day 14 hours') at time zone 'America/New_York');

  -- Created INACTIVE (is_active false). max_teams 4 with 4 confirmed teams means the captain claim route answers "slots full" once it is
  -- switched on. If the table has a check that wants at least 8 teams, fall back to 8 and say so.
  begin
    insert into public.tournaments
      (title, slug, is_active, service_region, target_teams, official_threshold, max_teams, start_at,
       venue, format_summary, entry_fee_cents, min_roster_players, staff_announcement)
    values
      (c_title, c_slug, false, c_region, 4, 4, 4, v_start,
       'TEST field (delete me)', 'TEST DATA: 4 teams, 2 groups of 2, then knockout.', 0, 1,
       'TEST DATA for the live bracket. Safe to ignore. Staff will delete it.')
    returning id into v_tid;
  exception when check_violation then
    v_max := 8;
    insert into public.tournaments
      (title, slug, is_active, service_region, target_teams, official_threshold, max_teams, start_at,
       venue, format_summary, entry_fee_cents, min_roster_players, staff_announcement)
    values
      (c_title, c_slug, false, c_region, 8, 8, 8, v_start,
       'TEST field (delete me)', 'TEST DATA: 4 teams, 2 groups of 2, then knockout.', 0, 1,
       'TEST DATA for the live bracket. Safe to ignore. Staff will delete it.')
    returning id into v_tid;
    raise notice 'This database wants max_teams of at least 8, so max_teams is 8 here. A real captain could claim a spot while it is active.';
  end;

  -- The flags only exist after migration 20261104000000. Set them explicitly when they are there.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tournaments' and column_name in ('rated', 'count_for_season')) = 2 then
    execute 'update public.tournaments set rated = false, count_for_season = false where id = $1' using v_tid;
  else
    raise notice 'tournaments.rated and count_for_season do not exist yet (migration 20261104000000 not applied). Skipped setting them.';
  end if;

  -- 4 teams, each its captain alone (users 1 to 4). Paid and confirmed so they appear on the bracket.
  for i in 1..4 loop
    insert into public.tournament_captains
      (tournament_id, user_id, status, captain_verified, captain_name, captain_instagram, team_name,
       expected_players, players_paid, claim_submitted_at, payment_received_at)
    select v_tid, u.user_id, 'confirmed', true, 'Test Captain ' || i, 'test-captain-' || i, 'Test Team ' || i,
           1, 1, now(), now()
      from test_user_ids u where u.n = i
    returning id into v_cap;
    v_caps := v_caps || v_cap;
  end loop;

  -- 2 groups of 2, and the one match inside each group (numbered 1 and 2, like the app's own generator).
  for g in 0..1 loop
    v_group := case when g = 0 then 'A' else 'B' end;
    v_base := g * 2;

    insert into public.tournament_groups (tournament_id, group_name) values (v_tid, v_group) returning id into v_gid;

    for i in 1..2 loop
      insert into public.tournament_group_members
        (group_id, tournament_id, team_id, wins, draws, losses, goals_for, goals_against, goal_difference, points)
      values (v_gid, v_tid, v_caps[v_base + i], 0, 0, 0, 0, 0, 0, 0);
    end loop;

    v_match := v_match + 1;
    insert into public.tournament_matches
      (tournament_id, stage, group_name, match_number, team_a_id, team_b_id, is_bye, scheduled_at)
    values
      (v_tid, 'group', v_group, v_match, v_caps[v_base + 1], v_caps[v_base + 2], false,
       v_start + (v_match - 1) * interval '30 minutes');
  end loop;

  raise notice 'Seeded tournament % (id %): % teams, % group matches, max_teams %. It is INACTIVE: admins see it, players do not.',
    c_slug, v_tid,
    (select count(*) from public.tournament_captains where tournament_id = v_tid),
    (select count(*) from public.tournament_matches where tournament_id = v_tid),
    v_max;
end
$seed$;

commit;

-- Short result (the last thing the editor shows).
select t.id as tournament_id,
       t.slug,
       t.is_active,
       t.start_at,
       (select count(*) from public.tournament_captains c where c.tournament_id = t.id) as teams,
       (select count(*) from public.tournament_groups gr where gr.tournament_id = t.id) as groups,
       (select count(*) from public.tournament_matches m where m.tournament_id = t.id) as matches
  from public.tournaments t
 where t.slug = 'test-bracket-demo';
