-- TEST tournament seed: one clearly labeled bracket demo with 8 teams in 2 groups of 4 and the full group stage unscored.
-- NOT RUN by anyone yet. Read this header, paste your 40 user ids below, then run the whole file once.
--
-- WHAT IT CREATES (everything hangs off one tournaments row with slug 'test-bracket-demo'):
--   1 tournament        "TEST Bracket Demo (delete me)", start_at tomorrow 2:00 PM Eastern, rated false, count_for_season false
--   8 teams             tournament_captains "Test Team 1" to "Test Team 8", status confirmed, captain_verified true
--   32 roster players   tournament_roster, status accepted, 4 per team. With the captain that is 5 players per team, which is how
--                       the app counts a roster (captain + accepted players, minimum 5), and it is why you paste exactly 40 ids.
--   2 groups            tournament_groups A and B, 4 teams each (tournament_group_members, all zeros)
--   12 group matches    tournament_matches, every pairing in each group, no scores, scheduled 30 minutes apart from the start
--
-- BEFORE YOU RUN IT
--   1. Pick 40 user ids with the query just below, and paste them into the VALUES list in step 1.
--   2. USE STAFF OR TEST ACCOUNTS. Logging a score as admin sends a "Vote for Match MVP" push to every captain and roster player of the
--      two teams in that match. The "Generate Groups" button also pushes "Bracket is live" to all captains. Those are real people if you
--      pick real accounts. Their first name and last initial also show on the player bracket while the tournament is active.
--   3. Do NOT tap "Generate Groups" in the admin bracket screen. This file already made the groups and matches, and Generate Groups
--      deletes and reshuffles them (and sends the push above).
--
-- QUERY TO PICK 40 USER IDS (ids only, no names). Run it by itself, copy the single result cell, and paste it over the 40 rows in step 1:
--
--   select string_agg(format('  (%s, %L)', n, id), E',\n' order by n) as paste_me
--     from (select id, row_number() over (order by id) as n
--             from (select id from public.profiles where approved = true order by random() limit 40) picked) numbered;
--
--   If the text has fewer than 40 rows there are fewer than 40 approved profiles. End the pasted list with a semicolon, not a comma.
--   Users 1 to 8 become the captains. Users 9 to 40 become the roster, four per team in order.
--
-- IS THE TOURNAMENT VISIBLE?
--   Admin:  yes always. The admin Tournaments list shows every tournament, live or not, each with a Bracket button.
--   Player: only while is_active is true. The app shows one live tournament per region (it looks it up with maybeSingle, so TWO active
--           rows in the same region would break the real tournament page for everyone). So this file sets is_active true only when no
--           other tournament is already active in the same region (NULL region by default, see c_region). Otherwise it creates the
--           tournament inactive, prints a notice, and the admin can still use it. Do not use "Make live" in production while a real
--           tournament is live, because that turns the real one off.
--   Players cannot join it: it has max_teams 8 and 8 confirmed teams, so the captain claim route answers "captain slots full".
--
-- SAFE TO RUN TWICE: if a tournament with slug 'test-bracket-demo' already exists, the second run changes nothing and says so.
-- ALL OR NOTHING: one transaction. Any problem (missing table, bad id) rolls everything back.
-- TO REMOVE EVERYTHING: run cleanup.sql in this folder.

begin;

-- ------------------------------------------------------------------------------------------------------------------------------
-- STEP 1: PASTE YOUR 40 USER IDS HERE (profiles.id). The all-zero ids below are placeholders, and the script refuses to run with them.
-- ------------------------------------------------------------------------------------------------------------------------------
create temp table test_user_ids (
  n       integer primary key,
  user_id uuid not null unique
) on commit drop;

insert into test_user_ids (n, user_id) values
  (1, '00000000-0000-0000-0000-000000000001'),
  (2, '00000000-0000-0000-0000-000000000002'),
  (3, '00000000-0000-0000-0000-000000000003'),
  (4, '00000000-0000-0000-0000-000000000004'),
  (5, '00000000-0000-0000-0000-000000000005'),
  (6, '00000000-0000-0000-0000-000000000006'),
  (7, '00000000-0000-0000-0000-000000000007'),
  (8, '00000000-0000-0000-0000-000000000008'),
  (9, '00000000-0000-0000-0000-000000000009'),
  (10, '00000000-0000-0000-0000-000000000010'),
  (11, '00000000-0000-0000-0000-000000000011'),
  (12, '00000000-0000-0000-0000-000000000012'),
  (13, '00000000-0000-0000-0000-000000000013'),
  (14, '00000000-0000-0000-0000-000000000014'),
  (15, '00000000-0000-0000-0000-000000000015'),
  (16, '00000000-0000-0000-0000-000000000016'),
  (17, '00000000-0000-0000-0000-000000000017'),
  (18, '00000000-0000-0000-0000-000000000018'),
  (19, '00000000-0000-0000-0000-000000000019'),
  (20, '00000000-0000-0000-0000-000000000020'),
  (21, '00000000-0000-0000-0000-000000000021'),
  (22, '00000000-0000-0000-0000-000000000022'),
  (23, '00000000-0000-0000-0000-000000000023'),
  (24, '00000000-0000-0000-0000-000000000024'),
  (25, '00000000-0000-0000-0000-000000000025'),
  (26, '00000000-0000-0000-0000-000000000026'),
  (27, '00000000-0000-0000-0000-000000000027'),
  (28, '00000000-0000-0000-0000-000000000028'),
  (29, '00000000-0000-0000-0000-000000000029'),
  (30, '00000000-0000-0000-0000-000000000030'),
  (31, '00000000-0000-0000-0000-000000000031'),
  (32, '00000000-0000-0000-0000-000000000032'),
  (33, '00000000-0000-0000-0000-000000000033'),
  (34, '00000000-0000-0000-0000-000000000034'),
  (35, '00000000-0000-0000-0000-000000000035'),
  (36, '00000000-0000-0000-0000-000000000036'),
  (37, '00000000-0000-0000-0000-000000000037'),
  (38, '00000000-0000-0000-0000-000000000038'),
  (39, '00000000-0000-0000-0000-000000000039'),
  (40, '00000000-0000-0000-0000-000000000040');

-- ------------------------------------------------------------------------------------------------------------------------------
-- STEP 2: everything else. Nothing below needs editing, except c_region if you want a hub region instead of the legacy (null) hub.
-- ------------------------------------------------------------------------------------------------------------------------------
do $seed$
declare
  c_slug   constant text := 'test-bracket-demo';
  c_title  constant text := 'TEST Bracket Demo (delete me)';
  c_region constant text := null;          -- null = legacy hub (visible whichever state a player picks). Or 'CT', 'NY', 'NJ', 'MD'.
  v_tid     uuid;
  v_start   timestamptz;
  v_active  boolean;
  v_caps    uuid[] := '{}';
  v_cap     uuid;
  v_gid     uuid;
  v_group   text;
  v_base    integer;
  v_match   integer := 0;
  v_missing integer;
  t         text;
  i         integer;
  j         integer;
  k         integer;
  g         integer;
begin
  -- The production tournament tables must all be here. This database may not have them (DEV): stop with a clear message.
  foreach t in array array['tournaments', 'tournament_captains', 'tournament_roster', 'tournament_groups', 'tournament_group_members', 'tournament_matches'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Table public.% does not exist in this database. Nothing was created.', t;
    end if;
  end loop;

  -- Run twice: leave the first run alone.
  if exists (select 1 from public.tournaments where slug = c_slug) then
    raise notice 'Already seeded (slug %). Nothing changed. Run cleanup.sql first if you want a fresh copy.', c_slug;
    return;
  end if;

  -- The ids must be real, distinct profiles and not the placeholders.
  if exists (select 1 from test_user_ids where user_id::text like '00000000-0000-0000-0000-0000000000%') then
    raise exception 'The user ids are still the placeholders. Paste 40 real profiles.id values into STEP 1.';
  end if;
  select count(*) into v_missing from test_user_ids u where not exists (select 1 from public.profiles p where p.id = u.user_id);
  if v_missing > 0 then
    raise exception '% of the 40 ids are not in public.profiles. Nothing was created.', v_missing;
  end if;

  -- Tomorrow 2:00 PM Eastern.
  v_start := ((date_trunc('day', now() at time zone 'America/New_York') + interval '1 day 14 hours') at time zone 'America/New_York');

  -- Only one live tournament per region is allowed by the app. Do not take the slot if a real one holds it.
  v_active := not exists (select 1 from public.tournaments where is_active = true and service_region is not distinct from c_region);

  insert into public.tournaments
    (title, slug, is_active, service_region, target_teams, official_threshold, max_teams, start_at,
     venue, format_summary, entry_fee_cents, min_roster_players, staff_announcement)
  values
    (c_title, c_slug, v_active, c_region, 8, 8, 8, v_start,
     'TEST field (delete me)', 'TEST DATA: 8 teams, 2 groups of 4, then knockout.', 0, 5,
     'TEST DATA for the live bracket. Safe to ignore. Staff will delete it.')
  returning id into v_tid;

  -- The flags only exist after migration 20261104000000. Set them explicitly when they are there.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tournaments' and column_name in ('rated', 'count_for_season')) = 2 then
    execute 'update public.tournaments set rated = false, count_for_season = false where id = $1' using v_tid;
  else
    raise notice 'tournaments.rated and count_for_season do not exist yet (migration 20261104000000 not applied). Skipped setting them.';
  end if;

  -- 8 teams. Captains are users 1 to 8. They are paid and confirmed so they appear on the bracket.
  for i in 1..8 loop
    insert into public.tournament_captains
      (tournament_id, user_id, status, captain_verified, captain_name, captain_instagram, team_name,
       expected_players, players_paid, claim_submitted_at, payment_received_at)
    select v_tid, u.user_id, 'confirmed', true, 'Test Captain ' || i, 'test-captain-' || i, 'Test Team ' || i,
           5, 5, now(), now()
      from test_user_ids u where u.n = i
    returning id into v_cap;
    v_caps := v_caps || v_cap;

    -- 4 accepted roster players per team (users 9 to 40), so the team has 5 with its captain.
    for k in 1..4 loop
      insert into public.tournament_roster (tournament_id, captain_id, user_id, status, invited_at, responded_at)
      select v_tid, v_cap, u.user_id, 'accepted', now(), now()
        from test_user_ids u where u.n = 8 + (i - 1) * 4 + k;
    end loop;
  end loop;

  -- 2 groups of 4 and every pairing inside each group (6 matches per group, numbered 1 to 12 like the app's own generator).
  for g in 0..1 loop
    v_group := case when g = 0 then 'A' else 'B' end;
    v_base := g * 4;

    insert into public.tournament_groups (tournament_id, group_name) values (v_tid, v_group) returning id into v_gid;

    for i in 1..4 loop
      insert into public.tournament_group_members
        (group_id, tournament_id, team_id, wins, draws, losses, goals_for, goals_against, goal_difference, points)
      values (v_gid, v_tid, v_caps[v_base + i], 0, 0, 0, 0, 0, 0, 0);
    end loop;

    for i in 1..4 loop
      for j in (i + 1)..4 loop
        v_match := v_match + 1;
        insert into public.tournament_matches
          (tournament_id, stage, group_name, match_number, team_a_id, team_b_id, is_bye, scheduled_at)
        values
          (v_tid, 'group', v_group, v_match, v_caps[v_base + i], v_caps[v_base + j], false,
           v_start + (v_match - 1) * interval '30 minutes');
      end loop;
    end loop;
  end loop;

  raise notice 'Seeded tournament % (id %): % teams, % roster players, % group matches. is_active = %.',
    c_slug, v_tid,
    (select count(*) from public.tournament_captains where tournament_id = v_tid),
    (select count(*) from public.tournament_roster where tournament_id = v_tid),
    (select count(*) from public.tournament_matches where tournament_id = v_tid),
    v_active;
  if not v_active then
    raise notice 'Another tournament is already live in this region, so the test one was created INACTIVE. Admins see it; players will not.';
  end if;
end
$seed$;

commit;

-- Short result (the last thing the editor shows).
select t.id as tournament_id,
       t.slug,
       t.is_active,
       t.start_at,
       (select count(*) from public.tournament_captains c where c.tournament_id = t.id) as teams,
       (select count(*) from public.tournament_roster r where r.tournament_id = t.id) as roster_players,
       (select count(*) from public.tournament_groups gr where gr.tournament_id = t.id) as groups,
       (select count(*) from public.tournament_matches m where m.tournament_id = t.id) as matches
  from public.tournaments t
 where t.slug = 'test-bracket-demo';
