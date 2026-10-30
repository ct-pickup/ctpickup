-- Rating results: a team result that BOTH teams have confirmed moves ratings a little. Behind 'rating_results' (needs 'rating_v2').
-- Additive and idempotent. Needs 20261101000000_rating_v2.sql, pickup_run_results and pickup_run_team_assignments.
--
-- What exists today: the host (or an admin) posts a result alone; nobody else confirms it; the host can edit it for 24 hours, an admin any
-- time; every edit is logged in pickup_run_result_edits. So nothing was two-sided. This adds the smallest version:
--   * Each team's CAPTAIN confirms the posted result. Captain = the first player named on the team (earliest team assignment, ties by id),
--     skipping the game's host so a host cannot confirm their own entry.
--   * pickup_run_results.result_version counts the posted result. Changing the winner, the score or the number of teams adds 1 and clears
--     verified_at: that reopens confirmation. Awards and other fields do not.
--   * pickup_run_result_confirmations keeps every confirmation with the version it confirmed, so reopened results keep their history.
--   * A result is verified when both teams confirmed the CURRENT version. Unverified results still show on the recap; ratings ignore them.
--   * apply_result_rating(run) applies, once and idempotently, the small result adjustment from the settled scores. It adds or removes
--     exactly the difference from what it applied before, so a reopened result takes its effect back out.
--
-- Verify after running:
--   select column_name from information_schema.columns where table_name = 'pickup_run_results' and column_name in ('result_version', 'verified_at');
--   select proname from pg_proc where proname in ('result_captain', 'apply_result_rating', 'rating_evidence_ok');
-- Rollback (manual; run apply_result_rating-driven corrections by hand first if rating_results was ever on):
--   begin;
--   drop trigger if exists pickup_results_version_bump on public.pickup_run_results;
--   drop trigger if exists pickup_results_reopened on public.pickup_run_results;
--   drop trigger if exists pickup_result_confirmed on public.pickup_run_result_confirmations;
--   drop function if exists public.pickup_results_version_bump();
--   drop function if exists public.pickup_results_reopened();
--   drop function if exists public.pickup_result_confirmed();
--   drop function if exists public.apply_result_rating(uuid);
--   drop function if exists public.rating_evidence_ok(uuid);
--   drop function if exists public.result_captain(uuid, text);
--   drop table if exists public.rating_result_adjustments;
--   drop table if exists public.pickup_run_result_confirmations;
--   alter table public.pickup_run_results drop column if exists verified_at, drop column if exists result_version;
--   commit;

begin;

alter table public.pickup_run_results
  add column if not exists result_version integer not null default 1,
  add column if not exists verified_at timestamptz;
comment on column public.pickup_run_results.result_version is 'Counts the posted result. Changing the winner, score or number of teams adds 1 and reopens confirmation.';
comment on column public.pickup_run_results.verified_at is 'Set when both teams'' captains confirmed the current result_version. Null while unconfirmed or reopened.';

create table if not exists public.pickup_run_result_confirmations (
  run_id         uuid        not null references public.pickup_runs (id) on delete cascade,
  team           text        not null check (team in ('A', 'B')),
  result_version integer     not null,
  confirmed_by   uuid        references public.profiles (id) on delete set null,
  confirmed_at   timestamptz not null default now(),
  primary key (run_id, team, result_version)
);
comment on table public.pickup_run_result_confirmations is 'A team captain confirming the posted result. One row per team and result version; old versions stay as history. Server (service role) writes only.';
alter table public.pickup_run_result_confirmations enable row level security;
revoke all on public.pickup_run_result_confirmations from anon, authenticated;
grant all on public.pickup_run_result_confirmations to service_role;

-- What a verified result has moved, per player. Lets apply_result_rating take its effect back out if the result is reopened.
create table if not exists public.rating_result_adjustments (
  run_id         uuid          not null references public.pickup_runs (id) on delete cascade,
  user_id        uuid          not null references auth.users (id) on delete cascade,
  delta          numeric(5,2)  not null,
  result_signal  numeric(6,4),
  expected       numeric(6,4),
  result_version integer       not null,
  applied_at     timestamptz   not null default now(),
  primary key (run_id, user_id)
);
comment on table public.rating_result_adjustments is 'The rating change a confirmed result applied to each player (delta, in points). Zero rows mean the result did not count. Server only.';
alter table public.rating_result_adjustments enable row level security;
revoke all on public.rating_result_adjustments from anon, authenticated;
grant all on public.rating_result_adjustments to service_role;

-- Captain of a team: the first player named on it, other than the game's host. Null when the team has nobody else.
create or replace function public.result_captain(p_run_id uuid, p_team text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id
    from public.pickup_run_team_assignments a
    join public.pickup_runs r on r.id = a.run_id
   where a.run_id = p_run_id and a.team = p_team
     and a.user_id is distinct from r.created_by
   order by a.created_at asc, a.user_id asc
   limit 1;
$$;
revoke all on function public.result_captain(uuid, text) from public, anon, authenticated;
grant execute on function public.result_captain(uuid, text) to service_role;

-- Editing the winner, score or number of teams reopens confirmation.
create or replace function public.pickup_results_version_bump()
returns trigger
language plpgsql
as $$
begin
  if new.winning_team is distinct from old.winning_team
     or new.total_teams is distinct from old.total_teams
     or (to_jsonb(new) -> 'score_a') is distinct from (to_jsonb(old) -> 'score_a')
     or (to_jsonb(new) -> 'score_b') is distinct from (to_jsonb(old) -> 'score_b') then
    new.result_version := old.result_version + 1;
    new.verified_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists pickup_results_version_bump on public.pickup_run_results;
create trigger pickup_results_version_bump before update on public.pickup_run_results
  for each row execute function public.pickup_results_version_bump();

-- When a result is reopened, take its rating effect back out.
create or replace function public.pickup_results_reopened()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.result_version is distinct from old.result_version then
    begin
      perform public.apply_result_rating(new.run_id);
    exception when others then
      raise warning 'apply_result_rating failed for %: %', new.run_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
drop trigger if exists pickup_results_reopened on public.pickup_run_results;
create trigger pickup_results_reopened after update on public.pickup_run_results
  for each row execute function public.pickup_results_reopened();

-- Both captains confirmed the current version: the result is verified, and counts once.
create or replace function public.pickup_result_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur integer;
begin
  select result_version into cur from public.pickup_run_results where run_id = new.run_id;
  if cur is null or cur <> new.result_version then return null; end if;
  if (select count(distinct team) from public.pickup_run_result_confirmations where run_id = new.run_id and result_version = cur) = 2 then
    update public.pickup_run_results set verified_at = now() where run_id = new.run_id and verified_at is null;
    begin
      perform public.apply_result_rating(new.run_id);
    exception when others then
      raise warning 'apply_result_rating failed for %: %', new.run_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
drop trigger if exists pickup_result_confirmed on public.pickup_run_result_confirmations;
create trigger pickup_result_confirmed after insert on public.pickup_run_result_confirmations
  for each row execute function public.pickup_result_confirmed();

-- Does the player have the distinct evidence the top bands need? Same test settle_session_v2 uses, from settled history.
create or replace function public.rating_evidence_ok(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg jsonb := public.rating_config_all();
  hosts_n integer;
  voters_n integer;
  games_n integer;
begin
  select count(distinct t.organizer_id) into hosts_n
    from public.rating_events re join public.tier_sessions t on t.id = re.session_id
   where re.user_id = p_user and t.organizer_id <> p_user;
  select count(distinct pv.voter_id) into voters_n
    from public.peer_votes pv
   where pv.votee_id = p_user and pv.session_id in (select session_id from public.rating_events where user_id = p_user);
  select count(*) into games_n from public.rating_events where user_id = p_user;
  return hosts_n >= (cfg ->> 'evidence_min_hosts')::numeric
     and voters_n >= (cfg ->> 'evidence_min_voters')::numeric
     and games_n >= (cfg ->> 'evidence_min_games')::numeric;
end;
$$;
revoke all on function public.rating_evidence_ok(uuid) from public, anon, authenticated;
grant execute on function public.rating_evidence_ok(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- The result adjustment. Idempotent: it moves each player to "the adjustment this result should have", so running it twice, or after
-- the result was reopened, never double counts. Does nothing unless both flags are on and the game has been settled.
--   expected  = logistic((team average - other team average) / result_scale), averages of score_before from rating_events
--   signal    = actual (win 1, draw 0.5, loss 0) - expected
--   delta     = clamp(result_k_share * k * signal, +-result_max_delta), k = the player's k for that game (rating_events.k_factor)
-- A result counts only when: verified, two teams, at least result_min_attendance attendees, team sizes within result_max_team_diff,
-- and (per player) the host who entered it has not entered more than result_host_max_30d results involving that player in 30 days.
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
             where game_ok and r3.created_by is not distinct from res.created_by
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

commit;
