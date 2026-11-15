-- ROLLBACK for 20261106000000_rated_tournaments.sql. Run it in the Supabase SQL editor. One transaction: all or nothing.
-- NOT RUN by anyone yet. Safe to run twice, and safe to run on a database where the migration was never applied (it then only restores
-- the two functions to the text of the earlier migrations, which they already are).
--
-- WHAT IT DOES, IN THIS ORDER
--   1. Takes every rating change a tournament made back out, tournament by tournament, and removes the hidden game records, the day rating
--      sessions and their zero movement events (public.tournament_unrate_tournament). Season points of those records go with them (they hang
--      off the hidden game and are deleted with it). Players end exactly where they were before the tournament matches, apart from changes
--      they earned in ordinary games since.
--   2. Removes the four hiding policies (tournament_match_runs_hidden on pickup_runs, pickup_run_results, pickup_run_rsvps,
--      pickup_run_team_assignments). Production's own policies are not touched.
--   3. Puts back the two functions this migration replaced, with the exact text of the migrations that defined them before:
--        apply_result_rating          from 20261101000300_rating_v2_expectations.sql
--        refresh_player_game_stats    from 20261101000200_player_game_stats.sql
--   4. Drops everything the migration added: the tournament functions, the two server-only tables, the daily cap row.
-- It does NOT touch tournaments.rated, tournaments.count_for_season or tournament_match_runs (those belong to 20261104000000), and it never
-- deletes a real game, a player, a profile or a rating of an ordinary game.
--
-- AFTER: select (select count(*) from pg_policy where polname = 'tournament_match_runs_hidden') = 0
--           and to_regprocedure('public.tournament_sync_match(uuid, uuid)') is null
--           and to_regclass('public.tournament_rating_days') is null
--           and (select prosrc not like '%TOURNAMENT%' from pg_proc where proname = 'apply_result_rating') as rolled_back;   -- true

begin;

-- 1. take every tournament effect back out, while the functions still exist
do $unrate$
declare
  r record;
begin
  if to_regprocedure('public.tournament_unrate_tournament(uuid)') is not null and to_regclass('public.tournament_match_runs') is not null then
    for r in
      select distinct m.tournament_id
        from public.tournament_match_runs l join public.tournament_matches m on m.id = l.match_id
    loop
      perform public.tournament_unrate_tournament(r.tournament_id);
    end loop;
  end if;
end
$unrate$;

-- 2. the hiding policies
do $policies$
begin
  if to_regclass('public.pickup_runs') is not null then drop policy if exists tournament_match_runs_hidden on public.pickup_runs; end if;
  if to_regclass('public.pickup_run_results') is not null then drop policy if exists tournament_match_runs_hidden on public.pickup_run_results; end if;
  if to_regclass('public.pickup_run_rsvps') is not null then drop policy if exists tournament_match_runs_hidden on public.pickup_run_rsvps; end if;
  if to_regclass('public.pickup_run_team_assignments') is not null then drop policy if exists tournament_match_runs_hidden on public.pickup_run_team_assignments; end if;
end
$policies$;

-- 3. the two functions, as they were
create or replace function public.refresh_player_game_stats(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $body$
declare
  sid     uuid;
  played  timestamptz;
  res     public.pickup_run_results%rowtype;
  scale_  numeric;
  two     boolean;
  n       integer;
begin
  select (to_jsonb(r) ->> 'tier_session_id')::uuid, r.start_at into sid, played from public.pickup_runs r where r.id = p_run_id;
  if sid is null then return 0; end if;
  select * into res from public.pickup_run_results where run_id = p_run_id;
  two := found and res.total_teams = 2;
  scale_ := coalesce((select value from public.rating_config where key = 'result_scale'), 12);
  -- Only two-team games: with a third team there is no single opponent.
  if exists (select 1 from public.pickup_run_team_assignments where run_id = p_run_id and team = 'C') then
    delete from public.player_game_stats where run_id = p_run_id;
    return 0;
  end if;

  with ev as (
    select re.user_id, re.score_before, a.team
      from public.rating_events re
      join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id and a.team in ('A', 'B')
     where re.session_id = sid
  ),
  tot as (select team, count(*) as n, sum(score_before) as s from ev group by team),
  calc as (
    select e.user_id, e.team,
           (select (t.s - e.score_before) / nullif(t.n - 1, 0) from tot t where t.team = e.team)  as partner_avg,
           (select t.s / t.n from tot t where t.team <> e.team)                                   as opp_avg,
           (select t.s / t.n from tot t where t.team = e.team)                                    as own_avg
      from ev e
  ),
  scored as (
    select c.*,
           case when two and c.opp_avg is not null then 1 / (1 + exp(-(c.own_avg - c.opp_avg) / scale_)) end as expected,
           case when two then case when res.winning_team is null then 0.5 when res.winning_team = c.team then 1 else 0 end end as actual
      from calc c
  ),
  up as (
    insert into public.player_game_stats (run_id, user_id, team, played_at, partner_avg, opponent_avg, expected, actual, outcome, result_signal, verified, updated_at)
    select p_run_id, s.user_id, s.team, played, round(s.partner_avg, 2), round(s.opp_avg, 2), round(s.expected, 4), s.actual,
           case when s.actual is null then null when s.actual = 1 then 'W' when s.actual = 0 then 'L' else 'D' end,
           case when s.expected is not null then round(s.actual - s.expected, 4) end,
           two and res.verified_at is not null, now()
      from scored s
    on conflict (run_id, user_id) do update
      set team = excluded.team, played_at = excluded.played_at, partner_avg = excluded.partner_avg, opponent_avg = excluded.opponent_avg,
          expected = excluded.expected, actual = excluded.actual, outcome = excluded.outcome, result_signal = excluded.result_signal,
          verified = excluded.verified, updated_at = now()
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$body$;
revoke all on function public.refresh_player_game_stats(uuid) from public, anon, authenticated;
grant execute on function public.refresh_player_game_stats(uuid) to service_role;

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
begin
  if not (public.rating_flag_on('rating_v2') and public.rating_flag_on('rating_results')) then return 0; end if;
  select r2.id into sid from (select (to_jsonb(r) ->> 'tier_session_id')::uuid as id from public.pickup_runs r where r.id = p_run_id) r2;
  if sid is null then return 0; end if;
  if not exists (select 1 from public.tier_sessions where id = sid and state = 'settled') then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('apply_result_rating:' || p_run_id::text));
  cfg := public.rating_config_all();

  select * into res from public.pickup_run_results where run_id = p_run_id;
  if found and res.verified_at is not null and res.total_teams = 2 then
    select count(*) into n_att from public.rating_events where session_id = sid;
    select count(*) filter (where a.team = 'A'), count(*) filter (where a.team = 'B'), count(*) filter (where a.team = 'C'),
           avg(re.score_before) filter (where a.team = 'A'), avg(re.score_before) filter (where a.team = 'B')
      into n_a, n_b, n_c, avg_a, avg_b
      from public.rating_events re
      join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id
     where re.session_id = sid;
    game_ok := n_att >= (cfg ->> 'result_min_attendance')::numeric
           and n_c = 0 and n_a >= 1 and n_b >= 1
           and abs(n_a - n_b) <= (cfg ->> 'result_max_team_diff')::numeric;
    if game_ok then
      exp_a := 1 / (1 + exp(-(avg_a - avg_b) / (cfg ->> 'result_scale')::numeric));
      act_a := case when res.winning_team is null then 0.5 when res.winning_team = 'A' then 1 else 0 end;
    end if;
  end if;

  for rec in
    select re.user_id, re.k_factor, a.team, adj.delta as old_delta,
           (select count(*) from public.pickup_run_results r3
              join public.pickup_run_team_assignments a3 on a3.run_id = r3.run_id and a3.user_id = re.user_id
             where game_ok and coalesce(r3.posted_by, r3.created_by) is not distinct from coalesce(res.posted_by, res.created_by)
               and r3.created_at between res.created_at - interval '30 days' and res.created_at) as host_results
      from public.rating_events re
      left join public.pickup_run_team_assignments a on a.run_id = p_run_id and a.user_id = re.user_id
      left join public.rating_result_adjustments adj on adj.run_id = p_run_id and adj.user_id = re.user_id
     where re.session_id = sid
  loop
    target := 0;
    if game_ok and rec.team in ('A', 'B') and rec.host_results <= (cfg ->> 'result_host_max_30d')::numeric then
      target := greatest(-(cfg ->> 'result_max_delta')::numeric, least((cfg ->> 'result_max_delta')::numeric,
                  (cfg ->> 'result_k_share')::numeric * rec.k_factor
                  * case when rec.team = 'A' then act_a - exp_a else (1 - act_a) - (1 - exp_a) end));
      target := round(target, 2);
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
  return moved;
end;
$body$;
revoke all on function public.apply_result_rating(uuid) from public, anon, authenticated;
grant execute on function public.apply_result_rating(uuid) to service_role;

-- 4. what the migration added
drop function if exists public.tournament_unrate_tournament(uuid);
drop function if exists public.tournament_forget_matches(uuid[]);
drop function if exists public.tournament_sync_tournament(uuid, uuid);
drop function if exists public.tournament_sync_match(uuid, uuid);
drop function if exists public.tournament_revert_run(uuid);
drop function if exists public.tournament_reapply_day(uuid);
drop function if exists public.tournament_day_session(uuid, date, uuid);
drop function if exists public.tournament_run_counts_for_season(uuid);
drop function if exists public.is_tournament_run(uuid);
drop function if exists public.tournament_daily_max_delta();
drop table if exists public.tournament_match_rating;
drop table if exists public.tournament_rating_days;
do $cfg$
begin
  if to_regclass('public.rating_config') is not null then
    delete from public.rating_config where key = 'tournament_daily_max_delta';
  end if;
end
$cfg$;

commit;
