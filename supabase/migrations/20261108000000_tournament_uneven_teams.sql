-- Rated tournaments: matches between teams of different sizes (for example 5 v 7 or 6 v 9) can count.
-- Additive and safe to run twice. NOT applied by this change; it is a file only.
-- Needs 20261106000000_rated_tournaments.sql (it replaces the apply_result_rating that file installed).
--
-- WHAT CHANGES: in apply_result_rating, for a TOURNAMENT MATCH ONLY, the rule "the two teams may differ by at most N players" reads N
-- from a new rating_config value 'tournament_max_team_diff' (default 8) instead of 'result_max_team_diff' (1). That is the only
-- change. Every other rule is untouched: at least result_min_attendance players in the match ('too_few_players'), no third team, both
-- teams have a player, the logistic expectation, result_k_share, the per game cap result_max_delta (2), the tournament daily cap
-- tournament_daily_max_delta (3), the evidence ceiling, idempotent edits. A match that is beyond even the tournament limit is still
-- not counted, with the reason 'teams_uneven'. A game that is not a tournament match takes the same branch and the same number as before.
--
-- Read before writing: the function below is the one in 20261106000000_rated_tournaments.sql section 4, with the one condition above
-- changed (marked TOURNAMENT UNEVEN TEAMS). No later migration redefines apply_result_rating.
--
-- ROLLBACK (manual). Restores the exact function from 20261106000000 and removes the config row. Run the block between the two marker
-- lines, after removing the leading "-- " from each line. It stops by itself if the rated tournaments migration is not there.
-- Matches already counted stay counted (their rating moves are not undone by this); to take a tournament's effect back out use
-- tournament_unrate_tournament as described in 20261106000000.
-- >>> ROLLBACK BEGIN
-- begin;
-- do $g$ begin
--   if to_regclass('public.tournament_match_rating') is null then raise exception 'rated tournaments migration is not applied; nothing to roll back to'; end if;
-- end $g$;
-- create or replace function public.apply_result_rating(p_run_id uuid)
-- returns integer
-- language plpgsql
-- security definer
-- set search_path = public
-- as $body$
-- declare
--   cfg      jsonb;
--   res      public.pickup_run_results%rowtype;
--   sid      uuid;
--   n_att    integer;
--   n_a      integer;
--   n_b      integer;
--   n_c      integer;
--   avg_a    numeric;
--   avg_b    numeric;
--   exp_a    numeric;
--   act_a    numeric;
--   game_ok  boolean := false;
--   moved    integer := 0;
--   rec      record;
--   target   numeric;
--   old_t    numeric;
--   cur      numeric;
--   nxt      numeric;
--   -- TOURNAMENT
--   t_match  uuid;
--   t_rated  boolean := false;
--   t_done   boolean := false;
--   t_at     timestamptz;
--   t_no     integer;
--   is_t     boolean := false;
--   why      text;
--   prior    numeric;
--   day_cap  numeric;
-- begin
--   if not (public.rating_flag_on('rating_v2') and public.rating_flag_on('rating_results')) then return 0; end if;
--   select r2.id into sid from (select (to_jsonb(r) ->> 'tier_session_id')::uuid as id from public.pickup_runs r where r.id = p_run_id) r2;
--   if sid is null then return 0; end if;
--   if not exists (select 1 from public.tier_sessions where id = sid and state = 'settled') then return 0; end if;
--   perform pg_advisory_xact_lock(hashtext('apply_result_rating:' || p_run_id::text));
--   cfg := public.rating_config_all();
--
--   -- TOURNAMENT: is this game a tournament match, is the tournament rated, and has the match been scored?
--   if to_regclass('public.tournament_match_runs') is not null then
--     execute 'select l.match_id, coalesce(t.rated, false), (m.completed_at is not null and not coalesce(m.is_bye, false)), m.completed_at, m.match_number
--                from public.tournament_match_runs l
--                join public.tournament_matches m on m.id = l.match_id
--                join public.tournaments t on t.id = m.tournament_id
--               where l.run_id = $1'
--       into t_match, t_rated, t_done, t_at, t_no using p_run_id;
--     is_t := t_match is not null;
--     if is_t then
--       perform pg_advisory_xact_lock(hashtext('tournament_day:' || sid::text));
--       day_cap := public.tournament_daily_max_delta();
--       why := case when not t_rated then 'not_rated' when not t_done then 'not_scored' end;
--     end if;
--   end if;
--
--   select * into res from public.pickup_run_results where run_id = p_run_id;
--   if found and res.total_teams = 2
--      -- TOURNAMENT: an admin entered score counts as verified. Everything else needs both captains.
--      and (case when is_t then t_rated and t_done else res.verified_at is not null end) then
--     select count(*) into n_att from public.rating_events where session_id = sid;
--     select count(*) filter (where a.team = 'A'), count(*) filter (where a.team = 'B'), count(*) filter (where a.team = 'C'),
--            avg(re.score_before) filter (where a.team = 'A'), avg(re.score_before) filter (where a.team = 'B')
--       into n_a, n_b, n_c, avg_a, avg_b
--       from public.rating_events re
--       join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id
--      where re.session_id = sid;
--     -- TOURNAMENT: the day's session holds every player of the day; the minimum is about the players of this match.
--     if is_t then n_att := coalesce(n_a, 0) + coalesce(n_b, 0); end if;
--     game_ok := n_att >= (cfg ->> 'result_min_attendance')::numeric
--            and n_c = 0 and n_a >= 1 and n_b >= 1
--            and abs(n_a - n_b) <= (cfg ->> 'result_max_team_diff')::numeric;
--     if is_t and not game_ok then
--       why := case when n_att < (cfg ->> 'result_min_attendance')::numeric then 'too_few_players'
--                   when n_c > 0 or n_a < 1 or n_b < 1 then 'teams_incomplete'
--                   else 'teams_uneven' end;
--     end if;
--     if game_ok then
--       exp_a := 1 / (1 + exp(-(avg_a - avg_b) / (cfg ->> 'result_scale')::numeric));
--       act_a := case when res.winning_team is null then 0.5 when res.winning_team = 'A' then 1 else 0 end;
--     end if;
--   elsif is_t and why is null then
--     why := 'not_scored';
--   end if;
--
--   for rec in
--     select re.user_id, re.k_factor, a.team, adj.delta as old_delta,
--            (select count(*) from public.pickup_run_results r3
--               join public.pickup_run_team_assignments a3 on a3.run_id = r3.run_id and a3.user_id = re.user_id
--              where game_ok and coalesce(r3.posted_by, r3.created_by) is not distinct from coalesce(res.posted_by, res.created_by)
--                and r3.created_at between res.created_at - interval '30 days' and res.created_at
--                -- TOURNAMENT: tournament matches are not counted by the poster cap
--                and not public.is_tournament_run(r3.run_id)) as host_results
--       from public.rating_events re
--       left join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id
--       left join public.rating_result_adjustments adj on adj.run_id = p_run_id and adj.user_id = re.user_id
--      where re.session_id = sid
--   loop
--     target := 0;
--     -- TOURNAMENT: the poster cap does not apply to a tournament match
--     if game_ok and rec.team in ('A', 'B') and (is_t or rec.host_results <= (cfg ->> 'result_host_max_30d')::numeric) then
--       target := greatest(-(cfg ->> 'result_max_delta')::numeric, least((cfg ->> 'result_max_delta')::numeric,
--                   (cfg ->> 'result_k_share')::numeric * rec.k_factor
--                   * case when rec.team = 'A' then act_a - exp_a else (1 - act_a) - (1 - exp_a) end));
--       target := round(target, 2);
--       -- TOURNAMENT: the daily cap. What this player's earlier matches of the same day already moved them leaves the room left.
--       if is_t then
--         select coalesce(sum(adj2.delta), 0) into prior
--           from public.rating_result_adjustments adj2
--           join public.tournament_match_runs l2 on l2.run_id = adj2.run_id
--           join public.tournament_matches m2 on m2.id = l2.match_id
--           join public.pickup_runs r2 on r2.id = adj2.run_id and (to_jsonb(r2) ->> 'tier_session_id') = sid::text
--          where adj2.user_id = rec.user_id and adj2.run_id <> p_run_id
--            and (m2.completed_at, m2.match_number) < (t_at, t_no);
--         target := round(greatest(-day_cap - prior, least(day_cap - prior, target)), 2);
--       end if;
--     end if;
--     old_t := coalesce(rec.old_delta, 0);
--     if target <> old_t or (rec.old_delta is null and target <> 0) then
--       select score into cur from public.player_ratings where user_id = rec.user_id for update;
--       if cur is not null then
--         nxt := greatest(0, least(100, cur + (target - old_t)));
--         if target > old_t and not public.rating_evidence_ok(rec.user_id) and nxt > greatest(cur, (cfg ->> 'evidence_cap_score')::numeric) then
--           nxt := greatest(cur, (cfg ->> 'evidence_cap_score')::numeric);
--         end if;
--         update public.player_ratings set score = round(nxt, 2), updated_at = now() where user_id = rec.user_id;
--         moved := moved + 1;
--       end if;
--     end if;
--     if target <> 0 or rec.old_delta is not null then
--       insert into public.rating_result_adjustments (run_id, user_id, delta, result_signal, expected, result_version)
--       values (p_run_id, rec.user_id, target,
--               case when game_ok and rec.team in ('A', 'B') then case when rec.team = 'A' then act_a - exp_a else exp_a - act_a end end,
--               case when game_ok and rec.team in ('A', 'B') then case when rec.team = 'A' then exp_a else 1 - exp_a end end,
--               coalesce(res.result_version, 0))
--       on conflict (run_id, user_id) do update
--         set delta = excluded.delta, result_signal = excluded.result_signal, expected = excluded.expected,
--             result_version = excluded.result_version, applied_at = now();
--     end if;
--   end loop;
--
--   -- TOURNAMENT: remember whether this match counted, and if not why. A short code, never a rating.
--   if is_t then
--     insert into public.tournament_match_rating (match_id, run_id, counted, reason, updated_at)
--     values (t_match, p_run_id, game_ok, case when game_ok then null else coalesce(why, 'not_counted') end, now())
--     on conflict (match_id) do update set run_id = excluded.run_id, counted = excluded.counted, reason = excluded.reason, updated_at = now();
--   end if;
--   return moved;
-- end;
-- $body$;
-- do $rb$ begin
--   if to_regclass('public.rating_config') is not null then delete from public.rating_config where key = 'tournament_max_team_diff'; end if;
-- end $rb$;
-- commit;
-- <<< ROLLBACK END
--
-- CHECKS (read only, safe on production; run the first one BEFORE the migration, the second and third AFTER):
--   -- before: does production still run the version in the repo? Expected md5 is in the PR description.
--   select md5(prosrc) from pg_proc where proname = 'apply_result_rating' and pronamespace = 'public'::regnamespace;
--   -- before: the config row must not exist yet (0 rows)
--   select key, value from public.rating_config where key = 'tournament_max_team_diff';
--   -- after: one row, value 8
--   select key, value from public.rating_config where key = 'tournament_max_team_diff';
--   -- after: the new function mentions the tournament limit (true) and its md5 changed from the one before
--   select prosrc like '%tournament_max_team_diff%' as has_tournament_limit, md5(prosrc)
--     from pg_proc where proname = 'apply_result_rating' and pronamespace = 'public'::regnamespace;
--   -- after: the ordinary limit is untouched (value 1)
--   select value from public.rating_config where key = 'result_max_team_diff';

begin;

do $need$
begin
  if to_regclass('public.tournament_match_rating') is null or to_regclass('public.rating_config') is null then
    raise exception 'needs 20261106000000_rated_tournaments.sql applied first';
  end if;
end
$need$;

-- 1. The tournament limit, as one named number. 8 means a tournament match counts while the teams differ by 8 players or fewer
--    (so 5 v 13 counts and 5 v 14 does not). Change it in this table; there is no second copy in code.
insert into public.rating_config (key, value, note) values
  ('tournament_max_team_diff', 8, 'Rated tournaments: two teams of a tournament match may differ by at most this many players and still count. Ordinary games keep result_max_team_diff.')
on conflict (key) do nothing;

-- 2. apply_result_rating: identical to 20261106000000 except for the one team size condition.
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
           -- TOURNAMENT UNEVEN TEAMS: a tournament match may use a wider limit (rating_config 'tournament_max_team_diff'). Every other game
           -- uses result_max_team_diff exactly as before. If the tournament row were ever deleted, the ordinary limit applies (the safe way).
           and abs(n_a - n_b) <= (case when is_t
                                       then coalesce((cfg ->> 'tournament_max_team_diff')::numeric, (cfg ->> 'result_max_team_diff')::numeric)
                                       else (cfg ->> 'result_max_team_diff')::numeric end);
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

commit;
