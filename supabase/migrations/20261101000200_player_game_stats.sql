-- Profile transparency: for every settled game with teams, what each player's partners and opponents were rated, and how the result
-- compared with what the ratings expected. Shown on the profile whether or not the rating flags are on (it only reads).
-- Additive and idempotent. Needs 20261101000000_rating_v2.sql (rating_config), 20261101000100_rating_results.sql (verified_at),
-- the tier system (rating_events), star_bands (20261002150000) and pickup_run_team_assignments.
--
--   player_game_stats      one row per player per settled two-team game. Holds raw score averages, so it is server only.
--   player_card_stats      the public view: record (W-D-L), average partner and opponent as half stars, and performance against
--                          expectation (sum of result_signal over the last profile_perf_games verified games). Never a raw score.
--   refresh_player_game_stats(run)   recomputes one game. Called by triggers when a game is settled and when its result changes.
--   backfill_player_game_stats()     recomputes every settled game once (the end of this file runs it).
--
-- Partner and opponent averages use rating_events.score_before: what each player was rated going into that game. A game with no such
-- history for the teammates or the opponents leaves that average null; a game that was never settled has no row.
-- Performance counts verified results only, unless rating_config profile_include_unverified = 1 (display only; ratings never read it).
--
-- Verify after running:
--   select count(*) from public.player_game_stats;
--   select * from public.player_card_stats limit 5;
-- Rollback (manual):
--   begin;
--   drop view if exists public.player_card_stats;
--   drop trigger if exists player_game_stats_on_events on public.rating_events;
--   drop trigger if exists player_game_stats_on_results on public.pickup_run_results;
--   drop function if exists public.player_game_stats_events_trigger();
--   drop function if exists public.player_game_stats_results_trigger();
--   drop function if exists public.backfill_player_game_stats();
--   drop function if exists public.refresh_player_game_stats(uuid);
--   drop function if exists public.star_for_score(numeric);
--   drop table if exists public.player_game_stats;
--   commit;

begin;

create table if not exists public.player_game_stats (
  run_id         uuid          not null references public.pickup_runs (id) on delete cascade,
  user_id        uuid          not null references auth.users (id) on delete cascade,
  team           text          not null check (team in ('A', 'B')),
  played_at      timestamptz,
  partner_avg    numeric(5,2),
  opponent_avg   numeric(5,2),
  expected       numeric(6,4),
  actual         numeric(3,2),
  outcome        text check (outcome in ('W', 'D', 'L')),
  result_signal  numeric(6,4),
  verified       boolean       not null default false,
  updated_at     timestamptz   not null default now(),
  primary key (run_id, user_id)
);
create index if not exists player_game_stats_user_idx on public.player_game_stats (user_id, played_at desc);
comment on table public.player_game_stats is 'Per player per settled two-team game: partner and opponent average rating going in, expected and actual result. Raw scores: server only. Clients read player_card_stats.';
alter table public.player_game_stats enable row level security;
revoke all on public.player_game_stats from anon, authenticated;
grant all on public.player_game_stats to service_role;

-- A raw score as a half star, by the band it falls in. Display only; ignores the verification gates on purpose, because it describes an average.
create or replace function public.star_for_score(p_score numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select b.star from public.star_bands b where b.lower <= p_score order by b.lower desc limit 1;
$$;
-- Functions inside a view are checked against the person reading it, not the view's owner, so players need execute here. It only maps a number to a half star.
revoke all on function public.star_for_score(numeric) from public, anon;
grant execute on function public.star_for_score(numeric) to authenticated, service_role;

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

create or replace function public.backfill_player_game_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  total integer := 0;
begin
  for r in select p.id from public.pickup_runs p
            where (to_jsonb(p) ->> 'tier_session_id') is not null
              and exists (select 1 from public.rating_events re where re.session_id = (to_jsonb(p) ->> 'tier_session_id')::uuid)
  loop
    total := total + public.refresh_player_game_stats(r.id);
  end loop;
  return total;
end;
$$;
revoke all on function public.backfill_player_game_stats() from public, anon, authenticated;
grant execute on function public.backfill_player_game_stats() to service_role;

-- Keep it current. Both triggers swallow their own errors: a profile statistic must never block settling a game or posting a result.
create or replace function public.player_game_stats_events_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  sid uuid;
begin
  for sid in select distinct session_id from new_rows loop
    begin
      select p.id into rid from public.pickup_runs p where (to_jsonb(p) ->> 'tier_session_id') = sid::text limit 1;
      if rid is not null then perform public.refresh_player_game_stats(rid); end if;
    exception when others then
      raise warning 'refresh_player_game_stats failed for session %: %', sid, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
drop trigger if exists player_game_stats_on_events on public.rating_events;
create trigger player_game_stats_on_events after insert on public.rating_events
  referencing new table as new_rows for each statement execute function public.player_game_stats_events_trigger();

create or replace function public.player_game_stats_results_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.refresh_player_game_stats(new.run_id);
  exception when others then
    raise warning 'refresh_player_game_stats failed for run %: %', new.run_id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists player_game_stats_on_results on public.pickup_run_results;
create trigger player_game_stats_on_results after insert or update on public.pickup_run_results
  for each row execute function public.player_game_stats_results_trigger();

-- What a profile shows. Stars and counts only.
create or replace view public.player_card_stats
  with (security_invoker = false) as
with cfg as (
  select coalesce((select value from public.rating_config where key = 'profile_perf_games'), 20)::integer as perf_games,
         coalesce((select value from public.rating_config where key = 'profile_min_games'), 3)::integer as min_games,
         coalesce((select value from public.rating_config where key = 'profile_include_unverified'), 0) = 1 as include_unverified
),
perf as (
  select g.user_id, g.result_signal,
         row_number() over (partition by g.user_id order by g.played_at desc nulls last, g.run_id) as rn
    from public.player_game_stats g, cfg
   where g.result_signal is not null and (g.verified or cfg.include_unverified)
),
agg as (
  select g.user_id,
         count(*) filter (where g.outcome = 'W')::integer as wins,
         count(*) filter (where g.outcome = 'D')::integer as draws,
         count(*) filter (where g.outcome = 'L')::integer as losses,
         avg(g.partner_avg)  as partner_avg,
         avg(g.opponent_avg) as opponent_avg,
         count(g.partner_avg)::integer  as partner_games,
         count(g.opponent_avg)::integer as opponent_games
    from public.player_game_stats g
   group by g.user_id
)
select a.user_id, a.wins, a.draws, a.losses,
       public.star_for_score(a.partner_avg)  as partner_stars,
       public.star_for_score(a.opponent_avg) as opponent_stars,
       a.partner_games, a.opponent_games,
       (select count(*) from perf p where p.user_id = a.user_id and p.rn <= cfg.perf_games)::integer as perf_games,
       (select round(sum(p.result_signal), 1) from perf p where p.user_id = a.user_id and p.rn <= cfg.perf_games) as perf_vs_expected,
       cfg.min_games
  from agg a cross join cfg;
comment on view public.player_card_stats is 'Public: record (W-D-L), average partner and opponent as half stars, performance against expectation. Never a raw score.';
revoke all on public.player_card_stats from public, anon, authenticated;
grant select on public.player_card_stats to authenticated;
grant select on public.player_card_stats to service_role;

-- Fill it in for games that were settled before this migration. Safe to repeat.
do $$
begin
  perform public.backfill_player_game_stats();
exception when others then
  raise notice 'backfill_player_game_stats skipped: %', sqlerrm;
end;
$$;

commit;

notify pgrst, 'reload schema';
