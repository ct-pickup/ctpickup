-- Rating v2: a second settlement formula, behind the 'rating_v2' flag. The current formula stays the default.
-- Additive and idempotent. Needs: tier_system (settle_session, tier_sessions, session_attendance, peer_votes, player_ratings,
-- rating_events), public.app_flags (20261024000000) and public.is_admin_uid().
--
-- What this adds
--   * Flags 'rating_v2' and 'rating_results', both OFF. The switch is global (the 'enabled' column): a game is settled by one formula
--     whoever triggers it, so an allowlist cannot decide it. 'rating_results' does nothing unless 'rating_v2' is also on.
--   * rating_config: every tunable constant, one row each, read at settle time. Change a number with an UPDATE; no deploy.
--   * rating_events gets audit columns (engine, field_avg, field_factor, host_weight, weighted_votes, detail).
--   * settle_session_v2(): field strength, weighted votes, host limits, repeated-pair damping, distinct-evidence ceiling.
--   * settle_session() now picks the engine: v2 when 'rating_v2' is on, otherwise exactly the old body (copied unchanged below).
--
-- The formulas are documented in lib/rating/ratingMath.ts (the TypeScript twin) and tested against this SQL.
--
-- Verify after running:
--   select key, value from public.rating_config order by key;                       -- 31 rows
--   select key, enabled from public.app_flags where key in ('rating_v2', 'rating_results');   -- both false
--   select proname from pg_proc where proname in ('settle_session', 'settle_session_v2', 'rating_config_all');
--   -- with the flag off, settle_session behaves as before.
-- Rollback (manual; nothing depends on the new objects except settle_session, restore it from 20260708000001_tier_system.sql first):
--   begin;
--   -- 1. re-run the create or replace function settle_session(...) block from 20260708000001_tier_system.sql
--   drop function if exists public.settle_session_v2(uuid, numeric, numeric);
--   drop function if exists public.rating_config_all();
--   drop function if exists public.rating_flag_on(text);
--   drop table if exists public.rating_config;
--   alter table public.rating_events drop column if exists engine, drop column if exists field_avg, drop column if exists field_factor,
--     drop column if exists host_weight, drop column if exists weighted_votes, drop column if exists detail;
--   delete from public.app_flags where key in ('rating_v2', 'rating_results');
--   commit;

begin;

insert into public.app_flags (key, enabled, note) values
  ('rating_v2', false, 'Rating v2: field strength, weighted votes, host limits, collusion damping, distinct evidence'),
  ('rating_results', false, 'Rating results: confirmed team results move ratings a little (needs rating_v2)')
on conflict (key) do nothing;

-- True when the flag's global switch is on. No row, no table or any doubt => false.
create or replace function public.rating_flag_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.enabled from public.app_flags f where f.key = p_key), false);
$$;
revoke all on function public.rating_flag_on(text) from public, anon, authenticated;
grant execute on function public.rating_flag_on(text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Tunable constants. Seeded once (on conflict do nothing): a value you changed is never overwritten by re-running this file.
-- ---------------------------------------------------------------------------------------------------------------------------
create table if not exists public.rating_config (
  key        text primary key,
  value      numeric     not null,
  note       text        not null,
  updated_at timestamptz not null default now()
);
comment on table public.rating_config is 'Every tunable number of the v2 rating formula. Read at settle time. Starting values are in the migration that seeded them.';

insert into public.rating_config (key, value, note) values
  -- Field strength: compare a player with the average score of the other players in the game.
  ('field_gain_scale', 15,   'Points above the field average over which gains shrink by a factor of e (15: 10 above keeps about half, 30 above keeps about 14%).'),
  ('field_loss_amp',   0.5,  'Most extra weight a loss gets when a stronger player does badly against a weaker field (0.5 = losses up to 1.5x).'),
  ('field_loss_scale', 15,   'Points above the field average over which that extra weight builds up.'),
  -- Weight of one peer vote = score factor x reliability factor x new account factor x repeated pair factor.
  ('vote_score_ref',   50,   'A voter at this score has a score factor of 1. Factor = voter score / this, held between vote_w_min and vote_w_max.'),
  ('vote_w_min',       0.5,  'Lowest score factor of a voter.'),
  ('vote_w_max',       1.5,  'Highest score factor of a voter.'),
  ('vote_rel_ref',     90,   'Reliability at or above this has a reliability factor of 1. Factor = reliability / this, held between vote_rel_min and 1.'),
  ('vote_rel_min',     0.5,  'Lowest reliability factor.'),
  ('vote_new_sessions',5,    'Rated games before an account counts fully as a voter.'),
  ('vote_new_floor',   0.4,  'Weight factor of a voter with no rated games yet; rises in a straight line to 1 at vote_new_sessions.'),
  -- Same voter naming the same player again.
  ('pair_window_days', 30,   'Look-back for repeated voter and player pairs.'),
  ('pair_decay',       0.6,  'Each earlier game in the window where this voter already named this player multiplies the vote weight by this.'),
  ('pair_floor',       0.1,  'Lowest the repeated pair factor goes.'),
  -- Host score.
  ('host_max_share',   0.7,  'The host score can move a player by at most this share of that game''s k, whatever the weights say.'),
  ('host_pair_days',   60,   'Look-back for the same host and the same player.'),
  ('host_pair_decay',  0.75, 'Each earlier game of this player under this host in the window multiplies the host score weight by this.'),
  ('host_pair_floor',  0.25, 'Lowest the repeated host factor goes.'),
  ('org_anchor',       0,    '0 = the host score is read against the middle of the scale (as today). 1 = read against the player''s own score, so ratings settle where the host sees the player. Values between blend.'),
  -- Distinct evidence for the top bands.
  ('evidence_min_hosts',  3, 'Distinct hosts who have rated the player before a score can go above evidence_cap_score.'),
  ('evidence_min_voters', 6, 'Distinct voters who have named the player before a score can go above evidence_cap_score.'),
  ('evidence_min_games',  8, 'Rated games before a score can go above evidence_cap_score.'),
  ('evidence_cap_score',  89.9, 'Without that evidence a score cannot rise above this (89.9 keeps it under the 4.5 star band). A score already above it is held, not cut.'),
  -- Results (rating_results).
  ('result_scale',     12,   'Logistic scale in points of team average difference: a team 12 points stronger is expected to win about 73%.'),
  ('result_k_share',   0.15, 'Share of the game''s k that a result can move a player (the brief asks for 10 to 20 percent).'),
  ('result_max_delta', 2,    'Hard cap, in points, on how far one result can move one player.'),
  ('result_min_attendance', 8, 'Games with fewer attendees than this never count a result.'),
  ('result_max_team_diff',  1, 'Teams may differ by at most this many players.'),
  ('result_host_max_30d',   6, 'Results one host entered that involve one player in 30 days; the player''s results beyond this number are ignored.'),
  -- Profile.
  ('profile_include_unverified', 0, '0 = profile performance counts verified results only. 1 = also counts results nobody has confirmed yet (display only; never affects ratings).'),
  ('profile_perf_games', 20, 'How many of the most recent verified games the performance number sums.'),
  ('profile_min_games',  3,  'Fewer games than this show "not enough games yet" instead of a number.')
on conflict (key) do nothing;

alter table public.rating_config enable row level security;
revoke all on public.rating_config from anon, authenticated;
grant select, update on public.rating_config to authenticated;
grant all on public.rating_config to service_role;
drop policy if exists rating_config_admin_read on public.rating_config;
create policy rating_config_admin_read on public.rating_config for select to authenticated using (public.is_admin_uid(auth.uid()));
drop policy if exists rating_config_admin_update on public.rating_config;
create policy rating_config_admin_update on public.rating_config for update to authenticated
  using (public.is_admin_uid(auth.uid())) with check (public.is_admin_uid(auth.uid()));

-- All constants as one jsonb. Fails loudly if a row was deleted, rather than rating with a missing number.
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
    'field_gain_scale','field_loss_amp','field_loss_scale','vote_score_ref','vote_w_min','vote_w_max','vote_rel_ref','vote_rel_min',
    'vote_new_sessions','vote_new_floor','pair_window_days','pair_decay','pair_floor','host_max_share','host_pair_days','host_pair_decay',
    'host_pair_floor','org_anchor','evidence_min_hosts','evidence_min_voters','evidence_min_games','evidence_cap_score',
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

-- Audit columns on the existing append-only log. Old rows read as engine 'v1' with nulls.
alter table public.rating_events
  add column if not exists engine         text not null default 'v1',
  add column if not exists field_avg      numeric(5,2),
  add column if not exists field_factor   numeric(6,3),
  add column if not exists host_weight    numeric(5,3),
  add column if not exists weighted_votes numeric(7,2),
  add column if not exists detail         jsonb;

-- ---------------------------------------------------------------------------------------------------------------------------
-- settle_session_v2. Same inputs, checks and side effects as settle_session; different numbers.
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
  c_gain       numeric := (cfg ->> 'field_gain_scale')::numeric;
  c_loss_amp   numeric := (cfg ->> 'field_loss_amp')::numeric;
  c_loss_scale numeric := (cfg ->> 'field_loss_scale')::numeric;
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
  c_anchor     numeric := (cfg ->> 'org_anchor')::numeric;
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
           greatest(t.total_w / n_attendees, 0.5 * case when t.total_votes > 0 then t.total_w / t.total_votes else 1 end) as expected,
           (t.n_voters::numeric / n_attendees) < 0.60 as thin,
           (sum(a.score_before) over () - a.score_before) / nullif(count(*) over () - 1, 0) as field_avg,
           p_k_base * (0.35 + 0.65 * exp(-a.sessions / 6.0)) as k,
           greatest(c_hp_floor, power(c_hp_decay, coalesce(hp.n, 0))) as host_factor,
           (a.user_id = sess.organizer_id) as is_host,
           e.hosts_n, e.voters_n, e.games_n
      from attendees a
      cross join tot t
      left join vote_in vi on vi.votee_id = a.user_id
      left join host_prior hp on hp.user_id = a.user_id
      join evidence e on e.user_id = a.user_id
  ),
  sig as (
    select b.*,
           greatest(-1, least(1, (b.wvotes - b.expected) / b.expected)) as vote_signal,
           case when b.is_host then 0
                else greatest(-1, least(1, (b.organizer_score
                       - ((1 - c_anchor) * 5.5 + c_anchor * (1 + 9 * b.score_before / 100.0))) / 4.5)) end as org_signal,
           (case when b.thin then 1.0 else p_org_floor + (0.95 - p_org_floor) * exp(-b.sessions / 5.0) end) * b.host_factor as w_eff,
           coalesce(b.field_avg, b.score_before) as field_avg_c
      from base b
  ),
  parts as (
    select s.*,
           greatest(-c_host_max, least(c_host_max, s.w_eff * s.org_signal)) as host_part,
           case when s.thin then 0 else (1 - s.w_eff) * s.vote_signal end as vote_part
      from sig s
  ),
  scored as (
    select p.*,
           (p.host_part + p.vote_part) as raw,
           case when (p.host_part + p.vote_part) >= 0
                then exp(-greatest(p.score_before - p.field_avg_c, 0) / c_gain)
                else 1 + c_loss_amp * (1 - exp(-greatest(p.score_before - p.field_avg_c, 0) / c_loss_scale)) end as field_factor,
           (p.hosts_n >= c_ev_hosts and p.voters_n >= c_ev_voters and p.games_n >= c_ev_games) as evidence_ok
      from parts p
  ),
  final as (
    select sc.*,
           greatest(0, least(100, sc.score_before + sc.k * sc.raw * sc.field_factor)) as unc_after
      from scored sc
  ),
  written as (
    insert into public.rating_events (
      session_id, user_id, votes_received, votes_expected, organizer_score,
      peer_weight, k_factor, delta, score_before, score_after,
      engine, field_avg, field_factor, host_weight, weighted_votes, detail
    )
    select p_session_id, f.user_id, f.votes, round(f.expected, 2), f.organizer_score,
           case when f.thin then 0 else 1 - f.w_eff end, f.k,
           round(case when f.evidence_ok or f.unc_after <= greatest(f.score_before, c_ev_cap) then f.unc_after
                      else greatest(f.score_before, c_ev_cap) end, 2) - f.score_before,
           f.score_before,
           round(case when f.evidence_ok or f.unc_after <= greatest(f.score_before, c_ev_cap) then f.unc_after
                      else greatest(f.score_before, c_ev_cap) end, 2),
           'v2', f.field_avg_c, f.field_factor, f.w_eff, f.wvotes,
           jsonb_build_object('host_part', f.host_part, 'vote_part', f.vote_part, 'raw', f.raw, 'thin', f.thin,
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

-- ---------------------------------------------------------------------------------------------------------------------------
-- settle_session: picks the engine. The body after the first `if` is the original function, unchanged.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function settle_session(
  p_session_id uuid,
  p_k_base     numeric default 16.0,
  p_org_floor  numeric default 0.45
) returns integer
language plpgsql security definer set search_path = public as $body$
declare
  s              tier_sessions%rowtype;
  n_attendees    integer;
  n_voters       integer;
  total_votes    integer;
  expected       numeric;
  thin_turnout   boolean;
  rows_written   integer;
begin
  if public.rating_flag_on('rating_v2') then
    return public.settle_session_v2(p_session_id, p_k_base, p_org_floor);
  end if;

  select * into s from tier_sessions where id = p_session_id for update;
  if not found then raise exception 'No such session'; end if;
  if s.state = 'settled' then return 0; end if;
  if auth.uid() is distinct from s.organizer_id and auth.role() <> 'service_role' then
    raise exception 'Only the organizer can settle this session';
  end if;
  if s.votes_close_at is not null and now() < s.votes_close_at then
    raise exception 'Voting is still open';
  end if;

  select count(*) into n_attendees
    from session_attendance where session_id = p_session_id and status = 'attended';
  if n_attendees < 4 then raise exception 'Not enough attendees to rate'; end if;

  select count(distinct voter_id), count(*) into n_voters, total_votes
    from peer_votes where session_id = p_session_id;

  thin_turnout := (n_voters::numeric / n_attendees) < 0.60;
  expected     := greatest(total_votes::numeric / n_attendees, 0.5);

  with attendees as (
    select a.user_id,
           a.organizer_score,
           pr.score    as score_before,
           pr.sessions,
           coalesce(v.n, 0) as votes
      from session_attendance a
      join player_ratings pr on pr.user_id = a.user_id
      left join (
        select votee_id, count(*)::integer as n
          from peer_votes where session_id = p_session_id
         group by votee_id
      ) v on v.votee_id = a.user_id
     where a.session_id = p_session_id
       and a.status = 'attended'
       and a.organizer_score is not null
  ),
  signals as (
    select user_id, organizer_score, score_before, sessions, votes,
           greatest(-1, least(1, (votes - expected) / expected))       as vote_signal,
           greatest(-1, least(1, (organizer_score - 5.5) / 4.5))       as org_signal,
           case when thin_turnout then 1.0
                else p_org_floor + (0.95 - p_org_floor) * exp(-sessions / 5.0)
           end                                                          as w_org,
           p_k_base * (0.35 + 0.65 * exp(-sessions / 6.0))             as k
      from attendees
  ),
  deltas as (
    select *,
           k * (w_org * org_signal + (1 - w_org) * vote_signal) as delta
      from signals
  ),
  written as (
    insert into rating_events (
      session_id, user_id, votes_received, votes_expected, organizer_score,
      peer_weight, k_factor, delta, score_before, score_after
    )
    select p_session_id, user_id, votes, expected, organizer_score,
           1 - w_org, k, delta, score_before,
           greatest(0, least(100, score_before + delta))
      from deltas
    returning user_id, score_after
  )
  update player_ratings pr
     set score       = w.score_after,
         sessions    = pr.sessions + 1,
         reliability = least(100, pr.reliability + 1),
         updated_at  = now()
    from written w
   where pr.user_id = w.user_id;

  get diagnostics rows_written = row_count;

  update player_ratings pr
     set reliability = greatest(0, pr.reliability - 7), updated_at = now()
    from session_attendance a
   where a.session_id = p_session_id
     and a.status = 'no_show'
     and pr.user_id = a.user_id;

  update tier_sessions set state = 'settled', settled_at = now() where id = p_session_id;
  return rows_written;
end;
$body$;

commit;
