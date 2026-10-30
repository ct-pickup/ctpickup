-- Rating v2, Phase F: expectation-based signals, and posted_by on results. Additive and idempotent. Supersedes the settle_session_v2 and
-- apply_result_rating bodies from 20261101000000 and 20261101000100 (it replaces both functions); apply it after 20261101000200.
-- Needs 20261101000000_rating_v2.sql and 20261101000100_rating_results.sql.
--
-- 1. Expectation-based signals. For each attendee, from their score going in against the average of the other attendees (gap):
--      expected votes = (total weighted votes) x exp(gap / vote_scale) / (the same summed over the game)      (logistic odds of the gap)
--      vote_signal    = clamp((weighted votes received - expected votes) / average votes per player)
--      expected host  = what the host gave the other players on average + host_span x tanh(gap / (2 x host_scale))
--                       (blended with 1 + 9 x score / 100 by host_abs_weight; 0 = relative only)
--      org_signal     = clamp((host score - expected host) / host_norm)
--    A player far above the field is expected to win the votes and the host score, so doing that earns nothing and falling short loses.
--    Weighted votes, host limits, repeated pair damping, the thin turnout rule and the evidence ceiling are unchanged.
--    The Phase B field strength factor is REMOVED: with anchored signals it only slowed honest strong players (see
--    docs/rating-v2-simulation.md). Its three constants and org_anchor stay in rating_config but are no longer read.
-- 2. pickup_run_results.posted_by: who first posted the result. result_host_max_30d now counts by posted_by, not created_by (which
--    is overwritten by whoever edits last). Filled by a trigger on insert; existing rows get created_by, the best that is known.
--
-- Verify after running:
--   select key, value from public.rating_config where key in ('vote_scale', 'host_scale', 'host_span', 'host_norm', 'host_abs_weight');
--   select count(*) from public.pickup_run_results where posted_by is null;     -- 0 (or rows whose creator was deleted)
--   select prosrc like '%exp_host%' from pg_proc where proname = 'settle_session_v2';          -- true
-- Rollback (manual): re-run 20261101000000_rating_v2.sql and 20261101000100_rating_results.sql (they recreate the earlier functions), then
--   begin;
--   drop trigger if exists pickup_results_posted_by on public.pickup_run_results;
--   drop function if exists public.pickup_results_posted_by();
--   alter table public.pickup_run_results drop column if exists posted_by;
--   delete from public.rating_config where key in ('vote_scale', 'host_scale', 'host_span', 'host_norm', 'host_abs_weight');
--   commit;

begin;

insert into public.rating_config (key, value, note) values
  ('vote_scale', 25, 'Expected votes: a player this many points above the other attendees is expected to draw e times (2.7x) the votes of an average player. Larger = flatter.'),
  ('host_scale', 20, 'Expected host score: gap in points at which the expectation reaches about 76% of host_span (tanh(gap / (2 x host_scale))).'),
  ('host_span',  5,  'Expected host score: host score points above or below what the host gave the other players that a very large rating gap is worth.'),
  ('host_norm',  4.5,'Host score points above or below the expectation that count as a full signal of +1 or -1.'),
  ('host_abs_weight', 0, 'Expected host score: 0 = relative to what the host gave the others; 1 = read from the player''s own rating alone (1 + 9 x score / 100). Between blends.')
on conflict (key) do nothing;

update public.rating_config set note = 'No longer read (Phase F removed the field strength factor). ' || note
 where key in ('field_gain_scale', 'field_loss_amp', 'field_loss_scale', 'org_anchor') and note not like 'No longer read%';

create or replace function public.rating_config_all()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg jsonb;
  need text[] := array[
    'vote_scale','host_scale','host_span','host_norm','host_abs_weight','vote_score_ref','vote_w_min','vote_w_max','vote_rel_ref','vote_rel_min',
    'vote_new_sessions','vote_new_floor','pair_window_days','pair_decay','pair_floor','host_max_share','host_pair_days','host_pair_decay',
    'host_pair_floor','evidence_min_hosts','evidence_min_voters','evidence_min_games','evidence_cap_score',
    'result_scale','result_k_share','result_max_delta','result_min_attendance','result_max_team_diff','result_host_max_30d'];
  k text;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into cfg from public.rating_config;
  foreach k in array need loop
    if not (cfg ? k) then raise exception 'rating_config is missing %', k; end if;
  end loop;
  return cfg;
end;
$$;
revoke all on function public.rating_config_all() from public, anon, authenticated;
grant execute on function public.rating_config_all() to service_role;

-- who first posted a result
alter table public.pickup_run_results add column if not exists posted_by uuid references public.profiles (id) on delete set null;
comment on column public.pickup_run_results.posted_by is 'Who first posted this result. created_by is overwritten by whoever edits it last; this is not.';
update public.pickup_run_results set posted_by = created_by where posted_by is null and created_by is not null;

create or replace function public.pickup_results_posted_by()
returns trigger
language plpgsql
as $$
begin
  if new.posted_by is null then new.posted_by := new.created_by; end if;
  return new;
end;
$$;
drop trigger if exists pickup_results_posted_by on public.pickup_run_results;
create trigger pickup_results_posted_by before insert on public.pickup_run_results
  for each row execute function public.pickup_results_posted_by();

-- ---------------------------------------------------------------------------------------------------------------------------
-- settle_session_v2 with expectation-based signals.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.settle_session_v2(
  p_session_id uuid,
  p_k_base     numeric default 16.0,
  p_org_floor  numeric default 0.45
) returns integer
language plpgsql security definer set search_path = public as $body$
declare
  sess         public.tier_sessions%rowtype;
  cfg          jsonb := public.rating_config_all();
  n_attendees  integer;
  rows_written integer;
  run_id_      uuid;
  c_vscale     numeric := (cfg ->> 'vote_scale')::numeric;
  c_hscale     numeric := (cfg ->> 'host_scale')::numeric;
  c_span       numeric := (cfg ->> 'host_span')::numeric;
  c_hnorm      numeric := (cfg ->> 'host_norm')::numeric;
  c_abs        numeric := (cfg ->> 'host_abs_weight')::numeric;
  c_vscore_ref numeric := (cfg ->> 'vote_score_ref')::numeric;
  c_vw_min     numeric := (cfg ->> 'vote_w_min')::numeric;
  c_vw_max     numeric := (cfg ->> 'vote_w_max')::numeric;
  c_vrel_ref   numeric := (cfg ->> 'vote_rel_ref')::numeric;
  c_vrel_min   numeric := (cfg ->> 'vote_rel_min')::numeric;
  c_vnew_n     numeric := (cfg ->> 'vote_new_sessions')::numeric;
  c_vnew_floor numeric := (cfg ->> 'vote_new_floor')::numeric;
  c_pair_days  numeric := (cfg ->> 'pair_window_days')::numeric;
  c_pair_decay numeric := (cfg ->> 'pair_decay')::numeric;
  c_pair_floor numeric := (cfg ->> 'pair_floor')::numeric;
  c_host_max   numeric := (cfg ->> 'host_max_share')::numeric;
  c_hp_days    numeric := (cfg ->> 'host_pair_days')::numeric;
  c_hp_decay   numeric := (cfg ->> 'host_pair_decay')::numeric;
  c_hp_floor   numeric := (cfg ->> 'host_pair_floor')::numeric;
  c_ev_hosts   numeric := (cfg ->> 'evidence_min_hosts')::numeric;
  c_ev_voters  numeric := (cfg ->> 'evidence_min_voters')::numeric;
  c_ev_games   numeric := (cfg ->> 'evidence_min_games')::numeric;
  c_ev_cap     numeric := (cfg ->> 'evidence_cap_score')::numeric;
begin
  select * into sess from public.tier_sessions where id = p_session_id for update;
  if not found then raise exception 'No such session'; end if;
  if sess.state = 'settled' then return 0; end if;
  if auth.uid() is distinct from sess.organizer_id and auth.role() <> 'service_role' then
    raise exception 'Only the organizer can settle this session';
  end if;
  if sess.votes_close_at is not null and now() < sess.votes_close_at then
    raise exception 'Voting is still open';
  end if;

  select count(*) into n_attendees
    from public.session_attendance where session_id = p_session_id and status = 'attended';
  if n_attendees < 4 then raise exception 'Not enough attendees to rate'; end if;

  with attendees as (
    select a.user_id, a.organizer_score, pr.score as score_before, pr.sessions, pr.reliability
      from public.session_attendance a
      join public.player_ratings pr on pr.user_id = a.user_id
     where a.session_id = p_session_id and a.status = 'attended' and a.organizer_score is not null
  ),
  -- who voted, and how much each voter's word weighs
  voter_facts as (
    select v.voter_id,
           coalesce(pr.score, 50) as score, coalesce(pr.sessions, 0) as sessions, coalesce(pr.reliability, 92) as reliability
      from (select distinct voter_id from public.peer_votes where session_id = p_session_id) v
      left join public.player_ratings pr on pr.user_id = v.voter_id
  ),
  pair_prior as (
    select pv.voter_id, pv.votee_id, count(distinct pv.session_id) as n
      from public.peer_votes pv
      join public.tier_sessions ts on ts.id = pv.session_id
      join (select voter_id, votee_id from public.peer_votes where session_id = p_session_id) cur
        on cur.voter_id = pv.voter_id and cur.votee_id = pv.votee_id
     where pv.session_id <> p_session_id
       and ts.starts_at <  sess.starts_at
       and ts.starts_at >= sess.starts_at - make_interval(days => c_pair_days::integer)
     group by pv.voter_id, pv.votee_id
  ),
  weighted as (
    select v.votee_id, v.voter_id,
           greatest(c_pair_floor, power(c_pair_decay, coalesce(pp.n, 0)))
           * least(1, greatest(c_vrel_min, vf.reliability / c_vrel_ref))
           * greatest(c_vw_min, least(c_vw_max, vf.score / c_vscore_ref))
           * (c_vnew_floor + (1 - c_vnew_floor) * least(1, vf.sessions / c_vnew_n)) as w
      from public.peer_votes v
      join voter_facts vf on vf.voter_id = v.voter_id
      left join pair_prior pp on pp.voter_id = v.voter_id and pp.votee_id = v.votee_id
     where v.session_id = p_session_id
  ),
  tot as (
    select coalesce(sum(w), 0) as total_w, count(*) as total_votes, count(distinct voter_id) as n_voters from weighted
  ),
  vote_in as (
    select votee_id, count(*)::integer as n, sum(w) as w from weighted group by votee_id
  ),
  host_prior as (
    select sa.user_id, count(distinct ts.id) as n
      from public.tier_sessions ts
      join public.session_attendance sa on sa.session_id = ts.id and sa.status = 'attended'
     where ts.organizer_id = sess.organizer_id and ts.id <> p_session_id and ts.state = 'settled'
       and ts.starts_at <  sess.starts_at
       and ts.starts_at >= sess.starts_at - make_interval(days => c_hp_days::integer)
       and sa.user_id in (select user_id from attendees)
     group by sa.user_id
  ),
  evidence as (
    select a.user_id,
      (select count(*) from (
          select t.organizer_id from public.rating_events re join public.tier_sessions t on t.id = re.session_id
           where re.user_id = a.user_id and t.organizer_id <> a.user_id
          union
          select sess.organizer_id where sess.organizer_id <> a.user_id) h) as hosts_n,
      (select count(*) from (
          select pv.voter_id from public.peer_votes pv
           where pv.votee_id = a.user_id
             and (pv.session_id = p_session_id
                  or pv.session_id in (select re.session_id from public.rating_events re where re.user_id = a.user_id))
          group by pv.voter_id) vv) as voters_n,
      (select count(*) from public.rating_events re where re.user_id = a.user_id) + 1 as games_n
      from attendees a
  ),
  base as (
    select a.user_id, a.organizer_score, a.score_before, a.sessions,
           coalesce(vi.n, 0) as votes, coalesce(vi.w, 0) as wvotes,
           t.total_w, t.total_votes, t.n_voters,
           greatest(t.total_w / n_attendees, 0.5 * case when t.total_votes > 0 then t.total_w / t.total_votes else 1 end) as avg_votes,
           (t.n_voters::numeric / n_attendees) < 0.60 as thin,
           coalesce((sum(a.score_before) over () - a.score_before) / nullif(count(*) over () - 1, 0), a.score_before) as field_avg,
           p_k_base * (0.35 + 0.65 * exp(-a.sessions / 6.0)) as k,
           greatest(c_hp_floor, power(c_hp_decay, coalesce(hp.n, 0))) as host_factor,
           (a.user_id = sess.organizer_id) as is_host,
           -- what the host gave the other players (not counting the host's own row)
           sum(case when a.user_id <> sess.organizer_id then a.organizer_score end) over () as host_sum,
           count(case when a.user_id <> sess.organizer_id then 1 end) over () as host_cnt,
           e.hosts_n, e.voters_n, e.games_n
      from attendees a
      cross join tot t
      left join vote_in vi on vi.votee_id = a.user_id
      left join host_prior hp on hp.user_id = a.user_id
      join evidence e on e.user_id = a.user_id
  ),
  -- Expectations. A player is expected to draw votes in proportion to exp(gap / vote_scale) (logistic odds of the gap to the field
  -- average), and to be scored by the host at what the host gave the others plus host_span x tanh(gap / (2 x host_scale)).
  expect as (
    select b.*,
           b.score_before - b.field_avg as gap,
           b.total_w * exp(least(20, greatest(-20, (b.score_before - b.field_avg) / c_vscale)))
             / sum(exp(least(20, greatest(-20, (b.score_before - b.field_avg) / c_vscale)))) over () as exp_votes,
           case when (b.host_cnt - case when b.is_host then 0 else 1 end) > 0
                then (b.host_sum - case when b.is_host then 0 else b.organizer_score end) / (b.host_cnt - case when b.is_host then 0 else 1 end)
                else 5.5 end as others_avg
      from base b
  ),
  sig as (
    select x.*,
           greatest(1, least(10, (1 - c_abs) * (x.others_avg + c_span * tanh((x.gap / (2 * c_hscale))::double precision)::numeric)
                                 + c_abs * (1 + 9 * x.score_before / 100.0))) as exp_host,
           greatest(-1, least(1, (x.wvotes - x.exp_votes) / x.avg_votes)) as vote_signal,
           (case when x.thin then 1.0 else p_org_floor + (0.95 - p_org_floor) * exp(-x.sessions / 5.0) end) * x.host_factor as w_eff
      from expect x
  ),
  sig2 as (
    select s.*,
           case when s.is_host then 0 else greatest(-1, least(1, (s.organizer_score - s.exp_host) / c_hnorm)) end as org_signal
      from sig s
  ),
  parts as (
    select s.*,
           greatest(-c_host_max, least(c_host_max, s.w_eff * s.org_signal)) as host_part,
           case when s.thin then 0 else (1 - s.w_eff) * s.vote_signal end as vote_part
      from sig2 s
  ),
  scored as (
    select p.*,
           (p.host_part + p.vote_part) as raw,
           (p.hosts_n >= c_ev_hosts and p.voters_n >= c_ev_voters and p.games_n >= c_ev_games) as evidence_ok
      from parts p
  ),
  final as (
    select sc.*,
           greatest(0, least(100, sc.score_before + sc.k * sc.raw)) as unc_after
      from scored sc
  ),
  written as (
    insert into public.rating_events (
      session_id, user_id, votes_received, votes_expected, organizer_score,
      peer_weight, k_factor, delta, score_before, score_after,
      engine, field_avg, field_factor, host_weight, weighted_votes, detail
    )
    select p_session_id, f.user_id, f.votes, round(f.exp_votes, 2), f.organizer_score,
           case when f.thin then 0 else 1 - f.w_eff end, f.k,
           round(case when f.evidence_ok or f.unc_after <= greatest(f.score_before, c_ev_cap) then f.unc_after
                      else greatest(f.score_before, c_ev_cap) end, 2) - f.score_before,
           f.score_before,
           round(case when f.evidence_ok or f.unc_after <= greatest(f.score_before, c_ev_cap) then f.unc_after
                      else greatest(f.score_before, c_ev_cap) end, 2),
           'v2', f.field_avg, null, f.w_eff, f.wvotes,
           jsonb_build_object('exp_votes', f.exp_votes, 'exp_host', f.exp_host, 'host_part', f.host_part, 'vote_part', f.vote_part, 'raw', f.raw, 'thin', f.thin,
                              'evidence_ok', f.evidence_ok, 'hosts', f.hosts_n, 'voters', f.voters_n, 'games', f.games_n,
                              'capped', not (f.evidence_ok or f.unc_after <= greatest(f.score_before, c_ev_cap)))
      from final f
    returning user_id, score_after
  )
  update public.player_ratings pr
     set score       = w.score_after,
         sessions    = pr.sessions + 1,
         reliability = least(100, pr.reliability + 1),
         updated_at  = now()
    from written w
   where pr.user_id = w.user_id;

  get diagnostics rows_written = row_count;

  update public.player_ratings pr
     set reliability = greatest(0, pr.reliability - 7), updated_at = now()
    from public.session_attendance a
   where a.session_id = p_session_id and a.status = 'no_show' and pr.user_id = a.user_id;

  update public.tier_sessions set state = 'settled', settled_at = now() where id = p_session_id;

  -- A result that was already confirmed before the game was settled counts now (rating_results only; the function checks the flags).
  if to_regprocedure('public.apply_result_rating(uuid)') is not null then
    select r.id into run_id_ from public.pickup_runs r where (to_jsonb(r) ->> 'tier_session_id') = p_session_id::text limit 1;
    if run_id_ is not null then
      execute 'select public.apply_result_rating($1)' using run_id_;
    end if;
  end if;

  return rows_written;
end;
$body$;


revoke all on function public.settle_session_v2(uuid, numeric, numeric) from public, anon;
grant execute on function public.settle_session_v2(uuid, numeric, numeric) to authenticated, service_role;

-- apply_result_rating, counting a host's entries by posted_by.
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

commit;
