-- Rated tournaments (Phase 2): a tournament match can move player ratings through the existing result rating path.
-- Additive and safe to run twice. NOT applied by this change; it is a file only. Needs, in this order:
--   20261101000000_rating_v2.sql, 20261101000100_rating_results.sql, 20261101000200_player_game_stats.sql,
--   20261101000300_rating_v2_expectations.sql (apply_result_rating is replaced here), and
--   20261104000000_tournament_rated_and_match_runs.sql (tournaments.rated, count_for_season, tournament_match_runs).
--
-- WHAT CHANGES FOR A TOURNAMENT THAT IS NOT RATED: nothing. Every new branch below is gated on "this game is linked to a tournament
-- match AND that tournament has rated = true". All other games take the same path through apply_result_rating they took before.
--
-- HOW A SCORED MATCH BECOMES A RATING (all through tournament_sync_match, one transaction, called by the admin score route):
--   1. A hidden game record: one pickup_runs row per scored match (status canceled, is_current false, no RSVPs, no time slots),
--      linked by tournament_match_runs. Status is canceled on purpose: the status column is an enum with no value for this, and
--      canceled keeps the record out of every list of upcoming or completed games, the completed game counts, and the compatibility
--      history, none of which look at a canceled run. Nothing is ever refunded or announced for it: no payment, RSVP or push exists. It exists only so the existing result path has a run to read. Players cannot see it: a
--      restrictive row level policy hides every run that is linked to a tournament match from clients (anon and authenticated).
--      The server (service role) is not affected by row level security and filters these runs where it lists games.
--   2. Its result and team lists: pickup_run_results (winner, and the score unless the match was decided on penalties, which has no
--      score on purpose) and pickup_run_team_assignments for the players on the two teams (the captain and accepted roster players).
--   3. ONE rating session per tournament day (America/New_York calendar day of the first score), kept in tournament_rating_days. It is
--      an ordinary tier_sessions row, created already settled, with one rating_events row per player who played that day and zero
--      peer or host movement (no votes, no host score, no reliability change, no sessions count change). It exists so the result
--      path has the rating each player had going in.
--   4. apply_result_rating runs on the hidden run. Rules for tournament runs only (everything else is unchanged):
--        - an admin entered score counts as VERIFIED (the bracket has no captain confirmations);
--        - the "at least result_min_attendance players" rule counts the players of THIS match (teams A and B), not the whole day;
--        - the "results one poster entered in 30 days" cap (result_host_max_30d) does not apply to tournament matches and tournament
--          matches are not counted by it for anyone;
--        - a daily cap: the total rating movement of one player across one tournament day stays between -X and +X, where X is
--          rating_config 'tournament_daily_max_delta' (default 3), in addition to the existing result_max_delta per game;
--        - the win value is the existing one (win 1, draw 0.5, loss 0). There is no goal margin in the formula, so a penalty winner is
--          a normal winner. A penalty decided match is stored with no score so it can never read as a blowout.
--      Everything else (the logistic expectation, result_k_share, result_max_delta, the evidence ceiling, two teams within
--      result_max_team_diff players) is the existing rule, unchanged.
--   5. Idempotent: apply_result_rating moves each player to "the adjustment this result should have", so saving the same score twice
--      changes nothing and a changed score replaces the old effect. A score that is cleared, or a match that is removed, takes its
--      effect back out (tournament_sync_match with the match unscored, tournament_forget_matches, tournament_unrate_tournament).
--
-- WHAT IS NEVER TOUCHED: raw scores are never returned (tournament_sync_match returns counted yes or no and a reason, never a number
-- from a rating). No pushes are sent from SQL. Reliability and attendance rows are written only for players on a team in a scored
-- match: nobody is ever marked absent. Season points (points_events) are not written here; the server writes them only when
-- tournaments.count_for_season is true.
--
-- Objects added:
--   rating_config 'tournament_daily_max_delta'  the daily cap, one named number (3 points)
--   tournament_daily_max_delta()                reads it; raises if the row was deleted rather than using a second copy of the number
--   tournament_rating_days                      (tournament_id, day) -> tier_sessions.id. Server only.
--   tournament_match_rating                     (match_id) -> counted, reason. Written by apply_result_rating. Server only.
--   is_tournament_run(run)                      true when a game is a tournament match record
--   tournament_sync_match(match, actor)         create, update or remove the hidden record for one match, then rate it
--   tournament_sync_tournament(tournament, actor)  the same for every match of a tournament (used when count_for_season changes)
--   tournament_forget_matches(match ids)        take effects back out and remove the records, BEFORE matches are deleted
--   tournament_unrate_tournament(tournament)    take every effect of a tournament back out and remove all of its records
--   tournament_revert_run(run)                  subtract what a tournament run applied to each player, whatever the switches are
--   apply_result_rating(run)                    REPLACED (same behavior for every game that is not a tournament match)
--   restrictive select policies on pickup_runs, pickup_run_results, pickup_run_team_assignments hiding tournament match records
--
-- Verify after running:
--   select value from public.rating_config where key = 'tournament_daily_max_delta';                  -- 3
--   select to_regclass('public.tournament_rating_days'), to_regclass('public.tournament_match_rating');
--   select polname from pg_policy where polname = 'tournament_match_runs_hidden';                     -- three rows
--   select public.is_tournament_run(gen_random_uuid());                                               -- false
--
-- Rollback (manual). Take the ratings back out FIRST, tournament by tournament, while the functions still exist:
--   select public.tournament_unrate_tournament(id) from public.tournaments where rated;
-- then:
--   begin;
--   drop policy if exists tournament_match_runs_hidden on public.pickup_runs;
--   drop policy if exists tournament_match_runs_hidden on public.pickup_run_results;
--   drop policy if exists tournament_match_runs_hidden on public.pickup_run_team_assignments;
--   drop function if exists public.tournament_unrate_tournament(uuid);
--   drop function if exists public.tournament_forget_matches(uuid[]);
--   drop function if exists public.tournament_sync_tournament(uuid, uuid);
--   drop function if exists public.tournament_sync_match(uuid, uuid);
--   drop function if exists public.tournament_revert_run(uuid);
--   drop function if exists public.tournament_reapply_day(uuid);
--   drop function if exists public.tournament_day_session(uuid, date, uuid);
--   drop function if exists public.is_tournament_run(uuid);
--   drop function if exists public.tournament_daily_max_delta();
--   drop table if exists public.tournament_match_rating;
--   drop table if exists public.tournament_rating_days;
--   delete from public.rating_config where key = 'tournament_daily_max_delta';
--   -- then re-run the apply_result_rating block of 20261101000300_rating_v2_expectations.sql to restore the earlier function
--   commit;

begin;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. The daily cap, as one named number.
-- ---------------------------------------------------------------------------------------------------------------------------
do $cfg$
begin
  if to_regclass('public.rating_config') is not null then
    insert into public.rating_config (key, value, note) values
      ('tournament_daily_max_delta', 3, 'Rated tournaments: the most one player''s rating can move, up or down in total, across all of one tournament day''s matches (on top of result_max_delta per game).')
    on conflict (key) do nothing;
  end if;
end
$cfg$;

create or replace function public.tournament_daily_max_delta()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v numeric;
begin
  select value into v from public.rating_config where key = 'tournament_daily_max_delta';
  if v is null then raise exception 'rating_config is missing tournament_daily_max_delta'; end if;
  return v;
end;
$$;
revoke all on function public.tournament_daily_max_delta() from public, anon, authenticated;
grant execute on function public.tournament_daily_max_delta() to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Tables. Server only (row level security on, no policies).
-- ---------------------------------------------------------------------------------------------------------------------------
do $tables$
begin
  if to_regclass('public.tournaments') is not null and to_regclass('public.tier_sessions') is not null then
    create table if not exists public.tournament_rating_days (
      tournament_id   uuid not null references public.tournaments (id) on delete cascade,
      day             date not null,
      tier_session_id uuid not null unique references public.tier_sessions (id) on delete cascade,
      created_at      timestamptz not null default now(),
      primary key (tournament_id, day)
    );
    comment on table public.tournament_rating_days is 'One rating session (tier_sessions) per tournament and Eastern calendar day. Server (service role) only.';
    alter table public.tournament_rating_days enable row level security;
    revoke all on table public.tournament_rating_days from anon, authenticated;
    grant all on table public.tournament_rating_days to service_role;
  end if;

  if to_regclass('public.tournament_matches') is not null then
    create table if not exists public.tournament_match_rating (
      match_id   uuid primary key references public.tournament_matches (id) on delete cascade,
      run_id     uuid,
      counted    boolean not null,
      reason     text,
      updated_at timestamptz not null default now()
    );
    comment on table public.tournament_match_rating is 'Whether a scored tournament match moved ratings, and if not, why (a short code). Never holds a rating. Server (service role) only.';
    alter table public.tournament_match_rating enable row level security;
    revoke all on table public.tournament_match_rating from anon, authenticated;
    grant all on table public.tournament_match_rating to service_role;
  end if;
end
$tables$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Is this game a tournament match record? Used by the policies below, so it must be callable by clients and read the link table
--    as its owner (the link table is closed to clients).
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.is_tournament_run(p_run_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.tournament_match_runs') is null then return false; end if;
  return exists (select 1 from public.tournament_match_runs l where l.run_id = p_run_id);
end;
$$;
revoke all on function public.is_tournament_run(uuid) from public;
grant execute on function public.is_tournament_run(uuid) to anon, authenticated, service_role;

-- Tournament match records are invisible to clients. A restrictive policy is ANDed with the existing ones and never widens access.
do $hide$
begin
  if to_regclass('public.tournament_match_runs') is not null then
    if to_regclass('public.pickup_runs') is not null then
      drop policy if exists tournament_match_runs_hidden on public.pickup_runs;
      create policy tournament_match_runs_hidden on public.pickup_runs as restrictive for select to anon, authenticated
        using (not public.is_tournament_run(id));
    end if;
    if to_regclass('public.pickup_run_results') is not null then
      drop policy if exists tournament_match_runs_hidden on public.pickup_run_results;
      create policy tournament_match_runs_hidden on public.pickup_run_results as restrictive for select to anon, authenticated
        using (not public.is_tournament_run(run_id));
    end if;
    if to_regclass('public.pickup_run_team_assignments') is not null then
      drop policy if exists tournament_match_runs_hidden on public.pickup_run_team_assignments;
      create policy tournament_match_runs_hidden on public.pickup_run_team_assignments as restrictive for select to anon, authenticated
        using (not public.is_tournament_run(run_id));
    end if;
  end if;
end
$hide$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. apply_result_rating, with the tournament rules. The body is the one from 20261101000300_rating_v2_expectations.sql; every change
--    is marked "TOURNAMENT" and does nothing for a game that is not a tournament match.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.apply_result_rating(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $body$
declare
  cfg      jsonb;
  res      public.pickup_run_results%rowtype;
  sid      uuid;
  n_att    integer;
  n_a      integer;
  n_b      integer;
  n_c      integer;
  avg_a    numeric;
  avg_b    numeric;
  exp_a    numeric;
  act_a    numeric;
  game_ok  boolean := false;
  moved    integer := 0;
  rec      record;
  target   numeric;
  old_t    numeric;
  cur      numeric;
  nxt      numeric;
  -- TOURNAMENT
  t_match  uuid;
  t_rated  boolean := false;
  t_done   boolean := false;
  t_at     timestamptz;
  t_no     integer;
  is_t     boolean := false;
  why      text;
  prior    numeric;
  day_cap  numeric;
begin
  if not (public.rating_flag_on('rating_v2') and public.rating_flag_on('rating_results')) then return 0; end if;
  select r2.id into sid from (select (to_jsonb(r) ->> 'tier_session_id')::uuid as id from public.pickup_runs r where r.id = p_run_id) r2;
  if sid is null then return 0; end if;
  if not exists (select 1 from public.tier_sessions where id = sid and state = 'settled') then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('apply_result_rating:' || p_run_id::text));
  cfg := public.rating_config_all();

  -- TOURNAMENT: is this game a tournament match, is the tournament rated, and has the match been scored?
  if to_regclass('public.tournament_match_runs') is not null then
    execute 'select l.match_id, coalesce(t.rated, false), (m.completed_at is not null and not coalesce(m.is_bye, false)), m.completed_at, m.match_number
               from public.tournament_match_runs l
               join public.tournament_matches m on m.id = l.match_id
               join public.tournaments t on t.id = m.tournament_id
              where l.run_id = $1'
      into t_match, t_rated, t_done, t_at, t_no using p_run_id;
    is_t := t_match is not null;
    if is_t then
      perform pg_advisory_xact_lock(hashtext('tournament_day:' || sid::text));
      day_cap := public.tournament_daily_max_delta();
      why := case when not t_rated then 'not_rated' when not t_done then 'not_scored' end;
    end if;
  end if;

  select * into res from public.pickup_run_results where run_id = p_run_id;
  if found and res.total_teams = 2
     -- TOURNAMENT: an admin entered score counts as verified. Everything else needs both captains.
     and (case when is_t then t_rated and t_done else res.verified_at is not null end) then
    select count(*) into n_att from public.rating_events where session_id = sid;
    select count(*) filter (where a.team = 'A'), count(*) filter (where a.team = 'B'), count(*) filter (where a.team = 'C'),
           avg(re.score_before) filter (where a.team = 'A'), avg(re.score_before) filter (where a.team = 'B')
      into n_a, n_b, n_c, avg_a, avg_b
      from public.rating_events re
      join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id
     where re.session_id = sid;
    -- TOURNAMENT: the day's session holds every player of the day; the minimum is about the players of this match.
    if is_t then n_att := coalesce(n_a, 0) + coalesce(n_b, 0); end if;
    game_ok := n_att >= (cfg ->> 'result_min_attendance')::numeric
           and n_c = 0 and n_a >= 1 and n_b >= 1
           and abs(n_a - n_b) <= (cfg ->> 'result_max_team_diff')::numeric;
    if is_t and not game_ok then
      why := case when n_att < (cfg ->> 'result_min_attendance')::numeric then 'too_few_players'
                  when n_c > 0 or n_a < 1 or n_b < 1 then 'teams_incomplete'
                  else 'teams_uneven' end;
    end if;
    if game_ok then
      exp_a := 1 / (1 + exp(-(avg_a - avg_b) / (cfg ->> 'result_scale')::numeric));
      act_a := case when res.winning_team is null then 0.5 when res.winning_team = 'A' then 1 else 0 end;
    end if;
  elsif is_t and why is null then
    why := 'not_scored';
  end if;

  for rec in
    select re.user_id, re.k_factor, a.team, adj.delta as old_delta,
           (select count(*) from public.pickup_run_results r3
              join public.pickup_run_team_assignments a3 on a3.run_id = r3.run_id and a3.user_id = re.user_id
             where game_ok and coalesce(r3.posted_by, r3.created_by) is not distinct from coalesce(res.posted_by, res.created_by)
               and r3.created_at between res.created_at - interval '30 days' and res.created_at
               -- TOURNAMENT: tournament matches are not counted by the poster cap
               and not public.is_tournament_run(r3.run_id)) as host_results
      from public.rating_events re
      left join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id
      left join public.rating_result_adjustments adj on adj.run_id = p_run_id and adj.user_id = re.user_id
     where re.session_id = sid
  loop
    target := 0;
    -- TOURNAMENT: the poster cap does not apply to a tournament match
    if game_ok and rec.team in ('A', 'B') and (is_t or rec.host_results <= (cfg ->> 'result_host_max_30d')::numeric) then
      target := greatest(-(cfg ->> 'result_max_delta')::numeric, least((cfg ->> 'result_max_delta')::numeric,
                  (cfg ->> 'result_k_share')::numeric * rec.k_factor
                  * case when rec.team = 'A' then act_a - exp_a else (1 - act_a) - (1 - exp_a) end));
      target := round(target, 2);
      -- TOURNAMENT: the daily cap. What this player's earlier matches of the same day already moved them leaves the room left.
      if is_t then
        select coalesce(sum(adj2.delta), 0) into prior
          from public.rating_result_adjustments adj2
          join public.tournament_match_runs l2 on l2.run_id = adj2.run_id
          join public.tournament_matches m2 on m2.id = l2.match_id
          join public.pickup_runs r2 on r2.id = adj2.run_id and (to_jsonb(r2) ->> 'tier_session_id') = sid::text
         where adj2.user_id = rec.user_id and adj2.run_id <> p_run_id
           and (m2.completed_at, m2.match_number) < (t_at, t_no);
        target := round(greatest(-day_cap - prior, least(day_cap - prior, target)), 2);
      end if;
    end if;
    old_t := coalesce(rec.old_delta, 0);
    if target <> old_t or (rec.old_delta is null and target <> 0) then
      select score into cur from public.player_ratings where user_id = rec.user_id for update;
      if cur is not null then
        nxt := greatest(0, least(100, cur + (target - old_t)));
        if target > old_t and not public.rating_evidence_ok(rec.user_id) and nxt > greatest(cur, (cfg ->> 'evidence_cap_score')::numeric) then
          nxt := greatest(cur, (cfg ->> 'evidence_cap_score')::numeric);
        end if;
        update public.player_ratings set score = round(nxt, 2), updated_at = now() where user_id = rec.user_id;
        moved := moved + 1;
      end if;
    end if;
    if target <> 0 or rec.old_delta is not null then
      insert into public.rating_result_adjustments (run_id, user_id, delta, result_signal, expected, result_version)
      values (p_run_id, rec.user_id, target,
              case when game_ok and rec.team in ('A', 'B') then case when rec.team = 'A' then act_a - exp_a else exp_a - act_a end end,
              case when game_ok and rec.team in ('A', 'B') then case when rec.team = 'A' then exp_a else 1 - exp_a end end,
              coalesce(res.result_version, 0))
      on conflict (run_id, user_id) do update
        set delta = excluded.delta, result_signal = excluded.result_signal, expected = excluded.expected,
            result_version = excluded.result_version, applied_at = now();
    end if;
  end loop;

  -- TOURNAMENT: remember whether this match counted, and if not why. A short code, never a rating.
  if is_t then
    insert into public.tournament_match_rating (match_id, run_id, counted, reason, updated_at)
    values (t_match, p_run_id, game_ok, case when game_ok then null else coalesce(why, 'not_counted') end, now())
    on conflict (match_id) do update set run_id = excluded.run_id, counted = excluded.counted, reason = excluded.reason, updated_at = now();
  end if;
  return moved;
end;
$body$;
revoke all on function public.apply_result_rating(uuid) from public, anon, authenticated;
grant execute on function public.apply_result_rating(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. The tournament day's rating session: one per tournament and Eastern calendar day, created already settled with no movement.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.tournament_day_session(p_tournament_id uuid, p_day date, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  select tier_session_id into sid from public.tournament_rating_days where tournament_id = p_tournament_id and day = p_day;
  if sid is not null then return sid; end if;
  insert into public.tier_sessions (organizer_id, venue, starts_at, capacity, min_tier, state, settled_at)
  values (p_actor, 'Tournament day', (p_day::timestamp at time zone 'America/New_York'), 30, 'bronze', 'settled', now())
  returning id into sid;
  insert into public.tournament_rating_days (tournament_id, day, tier_session_id) values (p_tournament_id, p_day, sid);
  return sid;
end;
$$;
revoke all on function public.tournament_day_session(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.tournament_day_session(uuid, date, uuid) to service_role;

-- Re-run the result rating for every match of one day, in the order they were scored, so the daily cap always sees the right
-- earlier matches. Also drops day rows (attendance and zero movement events) for players who are on no scored match that day.
create or replace function public.tournament_reapply_day(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select l.run_id
      from public.tournament_match_runs l
      join public.tournament_matches m on m.id = l.match_id
      join public.pickup_runs pr on pr.id = l.run_id
     where (to_jsonb(pr) ->> 'tier_session_id') = p_session_id::text
     order by m.completed_at nulls last, m.match_number
  loop
    perform public.apply_result_rating(r.run_id);
  end loop;

  -- Nobody keeps a day row they did not earn: attendance and the zero movement event go when the player is on no match of the day.
  delete from public.rating_events re
   where re.session_id = p_session_id and re.engine = 'tournament'
     and not exists (
       select 1 from public.pickup_run_team_assignments a
         join public.pickup_runs pr on pr.id = a.run_id and (to_jsonb(pr) ->> 'tier_session_id') = p_session_id::text
        where a.user_id = re.user_id and public.is_tournament_run(a.run_id));
  delete from public.session_attendance sa
   where sa.session_id = p_session_id
     and not exists (
       select 1 from public.pickup_run_team_assignments a
         join public.pickup_runs pr on pr.id = a.run_id and (to_jsonb(pr) ->> 'tier_session_id') = p_session_id::text
        where a.user_id = sa.user_id and public.is_tournament_run(a.run_id));
end;
$$;
revoke all on function public.tournament_reapply_day(uuid) from public, anon, authenticated;
grant execute on function public.tournament_reapply_day(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. One match: create, update or remove its hidden record and rate it. Returns a small jsonb: status, counted, reason. No ratings.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.tournament_sync_match(p_match_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $body$
declare
  m          record;
  keep       boolean;
  want_rate  boolean;
  flags_on   boolean;
  v_run      uuid;
  v_sid      uuid;
  v_old_sid  uuid;
  v_day      date;
  v_win      text;
  v_sa       integer;
  v_sb       integer;
  v_players  integer;
  r_counted  boolean;
  r_reason   text;
begin
  select mt.id, mt.tournament_id, mt.team_a_id, mt.team_b_id, mt.score_a, mt.score_b, mt.winner_id, coalesce(mt.is_bye, false) as is_bye,
         mt.completed_at, mt.match_number, coalesce(t.rated, false) as rated, coalesce(t.count_for_season, false) as count_for_season
    into m
    from public.tournament_matches mt join public.tournaments t on t.id = mt.tournament_id
   where mt.id = p_match_id;
  if not found then return jsonb_build_object('status', 'no_match'); end if;

  perform pg_advisory_xact_lock(hashtext('tournament_sync:' || m.tournament_id::text));

  select run_id into v_run from public.tournament_match_runs where match_id = p_match_id;
  if v_run is not null then
    select (to_jsonb(r) ->> 'tier_session_id')::uuid into v_old_sid from public.pickup_runs r where r.id = v_run;
  end if;

  keep := (m.rated or m.count_for_season)
          and m.completed_at is not null and not m.is_bye
          and m.team_a_id is not null and m.team_b_id is not null
          and m.score_a is not null and m.score_b is not null;

  -- Not (or no longer) counted: take any effect back out and remove the record.
  if not keep then
    if v_run is not null then
      perform public.tournament_revert_run(v_run);
      delete from public.pickup_run_results where run_id = v_run;
      delete from public.pickup_run_team_assignments where run_id = v_run;
      if to_regclass('public.player_game_stats') is not null then delete from public.player_game_stats where run_id = v_run; end if;
      delete from public.pickup_runs where id = v_run;
      if v_old_sid is not null then perform public.tournament_reapply_day(v_old_sid); end if;
    end if;
    delete from public.tournament_match_rating where match_id = p_match_id;
    return jsonb_build_object('status', case when m.rated or m.count_for_season then 'not_scored' else 'off' end, 'counted', false,
                              'reason', case when m.rated or m.count_for_season then 'not_scored' else null end);
  end if;

  -- The winner. By the score when there is one; level scores are a draw, or a penalty winner named by the admin.
  v_sa := m.score_a; v_sb := m.score_b;
  v_win := case when v_sa > v_sb then 'A' when v_sb > v_sa then 'B'
                when m.winner_id is not null and m.winner_id = m.team_a_id then 'A'
                when m.winner_id is not null and m.winner_id = m.team_b_id then 'B'
                else null end;
  -- A penalty winner has no score (level scores with a winner would break the score rule, and must never look like a blowout).
  if v_sa = v_sb and v_win is not null then v_sa := null; v_sb := null; end if;
  -- The results table only holds scores from 0 to 30.
  if v_sa is not null and (v_sa not between 0 and 30 or v_sb not between 0 and 30) then v_sa := null; v_sb := null; end if;

  flags_on := public.rating_flag_on('rating_v2') and public.rating_flag_on('rating_results');
  want_rate := m.rated and flags_on;

  -- 1. the hidden game record
  if v_run is null then
    insert into public.pickup_runs (title, run_type, is_current, status, start_at, capacity, fee_cents, admin_fee_cents, currency,
                                    invite_phase, auto_managed, created_by)
    values ('Tournament match', 'select', false, 'canceled', m.completed_at, 24, 0, 0, 'usd', 0, false, p_actor)
    returning id into v_run;
    insert into public.tournament_match_runs (match_id, run_id) values (p_match_id, v_run);
  end if;

  -- 2. its result. An admin entered score is verified (second statement: a changed score clears verified_at in a trigger).
  insert into public.pickup_run_results (run_id, total_teams, winning_team, score_a, score_b, created_by)
  values (v_run, 2, v_win, v_sa, v_sb, p_actor)
  on conflict (run_id) do update
    set total_teams = 2, winning_team = excluded.winning_team, score_a = excluded.score_a, score_b = excluded.score_b,
        created_by = excluded.created_by;
  update public.pickup_run_results set verified_at = now() where run_id = v_run and verified_at is null;

  -- 3. the teams: the captain and the accepted roster players of each team. A player named on both teams is on neither.
  delete from public.pickup_run_team_assignments where run_id = v_run;
  insert into public.pickup_run_team_assignments (run_id, user_id, team, created_by)
  with side as (
    select p.user_id, p.team
      from (
        select c.user_id, case when c.id = m.team_a_id then 'A' else 'B' end as team
          from public.tournament_captains c where c.id in (m.team_a_id, m.team_b_id) and c.user_id is not null
        union
        select r.user_id, case when r.captain_id = m.team_a_id then 'A' else 'B' end
          from public.tournament_roster r where r.captain_id in (m.team_a_id, m.team_b_id) and r.status = 'accepted' and r.user_id is not null
      ) p
  )
  select v_run, s.user_id, min(s.team), p_actor
    from side s
    where exists (select 1 from public.profiles pf where pf.id = s.user_id)
    group by s.user_id
    having count(distinct s.team) = 1;
  select count(*) into v_players from public.pickup_run_team_assignments where run_id = v_run;

  -- 4. the day's rating session, only for a rated tournament while the rating switches are on
  if want_rate then
    v_day := (m.completed_at at time zone 'America/New_York')::date;
    v_sid := public.tournament_day_session(m.tournament_id, v_day, coalesce(p_actor, (select created_by from public.pickup_runs where id = v_run)));
    update public.pickup_runs set tier_session_id = v_sid where id = v_run and tier_session_id is distinct from v_sid;

    insert into public.player_ratings (user_id)
    select a.user_id from public.pickup_run_team_assignments a where a.run_id = v_run
    on conflict (user_id) do nothing;

    insert into public.session_attendance (session_id, user_id, status)
    select v_sid, a.user_id, 'attended' from public.pickup_run_team_assignments a where a.run_id = v_run
    on conflict (session_id, user_id) do nothing;

    -- Zero movement events: only the rating each player had going in, and the k they would have. No votes, no host score.
    insert into public.rating_events (session_id, user_id, votes_received, votes_expected, organizer_score, peer_weight, k_factor, delta,
                                      score_before, score_after, engine, detail)
    select v_sid, pr.user_id, 0, 0, null, 0, round(16.0 * (0.35 + 0.65 * exp(-pr.sessions / 6.0)), 2), 0, pr.score, pr.score,
           'tournament', jsonb_build_object('tournament', true)
      from public.player_ratings pr
      join public.pickup_run_team_assignments a on a.user_id = pr.user_id and a.run_id = v_run
    on conflict (session_id, user_id) do nothing;
  elsif v_old_sid is not null then
    -- It stopped being rated (or the switches went off): leave the day session and take the effect back out.
    update public.pickup_runs set tier_session_id = null where id = v_run;
    perform public.tournament_revert_run(v_run);
    perform public.tournament_reapply_day(v_old_sid);
  end if;

  -- 5. rate it (and every other match of the day again, in order, so the daily cap stays right)
  if v_sid is not null then
    perform public.tournament_reapply_day(v_sid);
    if v_old_sid is not null and v_old_sid <> v_sid then perform public.tournament_reapply_day(v_old_sid); end if;
    select counted, reason into r_counted, r_reason from public.tournament_match_rating where match_id = p_match_id;
  end if;

  return jsonb_build_object(
    'status', case when not m.rated then 'recorded' when not flags_on then 'skipped' when coalesce(r_counted, false) then 'counted' else 'skipped' end,
    'counted', coalesce(r_counted, false),
    'reason', case when not m.rated then 'not_rated' when not flags_on then 'ratings_off' when coalesce(r_counted, false) then null else coalesce(r_reason, 'not_counted') end,
    'players', v_players
  );
end;
$body$;
revoke all on function public.tournament_sync_match(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_sync_match(uuid, uuid) to service_role;

-- Take a tournament run's rating effect back out: subtract what it applied to each player, from what it recorded. Works whatever the
-- rating switches are now, so switching them off never strands a rating that a tournament moved.
create or replace function public.tournament_revert_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  cur numeric;
begin
  for rec in select user_id, delta from public.rating_result_adjustments where run_id = p_run_id and delta <> 0 loop
    select score into cur from public.player_ratings where user_id = rec.user_id for update;
    if cur is not null then
      update public.player_ratings set score = round(greatest(0, least(100, cur - rec.delta)), 2), updated_at = now() where user_id = rec.user_id;
    end if;
  end loop;
  delete from public.rating_result_adjustments where run_id = p_run_id;
  delete from public.tournament_match_rating where run_id = p_run_id;
end;
$$;
revoke all on function public.tournament_revert_run(uuid) from public, anon, authenticated;
grant execute on function public.tournament_revert_run(uuid) to service_role;

-- Every match of one tournament (used when count_for_season is switched, so earlier matches follow the new setting).
create or replace function public.tournament_sync_tournament(p_tournament_id uuid, p_actor uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.tournament_matches where tournament_id = p_tournament_id order by completed_at nulls last, match_number loop
    perform public.tournament_sync_match(r.id, p_actor);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.tournament_sync_tournament(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_sync_tournament(uuid, uuid) to service_role;

-- Call this BEFORE matches are deleted (regenerating a bracket): their effect is taken back out and their records removed.
create or replace function public.tournament_forget_matches(p_match_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
  sids uuid[] := '{}';
  s uuid;
begin
  for r in
    select l.match_id, l.run_id, (to_jsonb(pr) ->> 'tier_session_id')::uuid as sid
      from public.tournament_match_runs l join public.pickup_runs pr on pr.id = l.run_id
     where l.match_id = any (p_match_ids)
  loop
    perform public.tournament_revert_run(r.run_id);
    delete from public.pickup_run_results where run_id = r.run_id;
    delete from public.pickup_run_team_assignments where run_id = r.run_id;
    if to_regclass('public.player_game_stats') is not null then delete from public.player_game_stats where run_id = r.run_id; end if;
    delete from public.pickup_runs where id = r.run_id;
    if r.sid is not null and not (r.sid = any (sids)) then sids := sids || r.sid; end if;
    n := n + 1;
  end loop;
  foreach s in array sids loop perform public.tournament_reapply_day(s); end loop;
  return n;
end;
$$;
revoke all on function public.tournament_forget_matches(uuid[]) from public, anon, authenticated;
grant execute on function public.tournament_forget_matches(uuid[]) to service_role;

-- Everything a tournament did, undone: ratings back, records removed, day sessions removed. For cleanup and for rolling back.
create or replace function public.tournament_unrate_tournament(p_tournament_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  r record;
begin
  select public.tournament_forget_matches(coalesce(array_agg(id), '{}')) into n from public.tournament_matches where tournament_id = p_tournament_id;
  for r in select tier_session_id from public.tournament_rating_days where tournament_id = p_tournament_id loop
    delete from public.rating_events where session_id = r.tier_session_id and engine = 'tournament';
    delete from public.tier_sessions ts where ts.id = r.tier_session_id
      and not exists (select 1 from public.rating_events re where re.session_id = ts.id);
  end loop;
  delete from public.tournament_rating_days where tournament_id = p_tournament_id;
  return coalesce(n, 0);
end;
$$;
revoke all on function public.tournament_unrate_tournament(uuid) from public, anon, authenticated;
grant execute on function public.tournament_unrate_tournament(uuid) to service_role;

commit;
