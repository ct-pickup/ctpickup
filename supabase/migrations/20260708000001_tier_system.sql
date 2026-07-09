-- ============================================================
-- CT Pickup — Tier system
-- Migration 001: schema, policies, settlement engine
--
-- Design constraints this encodes:
--   1. Raw rating is never exposed to players. Only the tier.
--   2. Peer votes are write-only from the client. Nobody can read
--      who voted for whom, or the system gets gamed in a week.
--   3. Verification is a ceiling, not a bonus. Unverified caps at gold.
--   4. Reliability is a separate axis. A no-show diamond isn't a diamond.
--   5. Every rating change is an immutable row. Disputes need receipts.
-- ============================================================

create type verification_level as enum ('self', 'document', 'vouched');
create type attendance_status  as enum ('registered', 'attended', 'no_show', 'cancelled');
create type session_state      as enum ('open', 'locked', 'settled');

-- ------------------------------------------------------------
-- Tier resolution. Immutable so it can back a generated column.
-- ------------------------------------------------------------
create or replace function tier_of(
  score       numeric,
  verified    verification_level,
  reliability numeric
) returns text
language sql immutable parallel safe as $body$
  select case
    when score >= 90 and verified <> 'self' and reliability >= 85 then 'diamond'
    when score >= 78 and verified <> 'self'                       then 'platinum'
    when score >= 60                                              then 'gold'
    when score >= 40                                              then 'silver'
    else                                                               'bronze'
  end;
$body$;

-- ------------------------------------------------------------
-- Ratings. One row per player.
-- ------------------------------------------------------------
create table player_ratings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  score        numeric(5,2) not null default 50.00 check (score between 0 and 100),
  sessions     integer      not null default 0,
  reliability  numeric(5,2) not null default 92.00 check (reliability between 0 and 100),
  verification verification_level not null default 'self',
  tier         text generated always as (tier_of(score, verification, reliability)) stored,
  updated_at   timestamptz  not null default now()
);

create index on player_ratings (tier);

-- ------------------------------------------------------------
-- Tier sessions (rating-system sessions, distinct from pickup_runs)
-- ------------------------------------------------------------
create table tier_sessions (
  id             uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null references auth.users(id),
  venue          text not null,
  starts_at      timestamptz not null,
  capacity       integer not null check (capacity between 4 and 30),
  min_tier       text not null default 'bronze',
  state          session_state not null default 'open',
  votes_close_at timestamptz,
  settled_at     timestamptz,
  created_at     timestamptz not null default now()
);

create table session_attendance (
  session_id      uuid not null references tier_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          attendance_status not null default 'registered',
  organizer_score numeric(3,1) check (organizer_score between 1 and 10),
  primary key (session_id, user_id)
);

-- ------------------------------------------------------------
-- Peer votes. Each attendee names the three best players
-- on the pitch other than themselves, in order.
-- ------------------------------------------------------------
create table peer_votes (
  session_id uuid not null references tier_sessions(id) on delete cascade,
  voter_id   uuid not null references auth.users(id) on delete cascade,
  votee_id   uuid not null references auth.users(id) on delete cascade,
  rank       smallint not null check (rank between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (session_id, voter_id, rank),
  unique (session_id, voter_id, votee_id),
  check (voter_id <> votee_id)
);

create index on peer_votes (session_id, votee_id);

-- ------------------------------------------------------------
-- Audit trail. Append-only.
-- ------------------------------------------------------------
create table rating_events (
  id              bigserial primary key,
  session_id      uuid not null references tier_sessions(id),
  user_id         uuid not null references auth.users(id),
  votes_received  integer not null,
  votes_expected  numeric(4,2) not null,
  organizer_score numeric(3,1),
  peer_weight     numeric(4,3) not null,
  k_factor        numeric(5,2) not null,
  delta           numeric(5,2) not null,
  score_before    numeric(5,2) not null,
  score_after     numeric(5,2) not null,
  created_at      timestamptz not null default now(),
  unique (session_id, user_id)
);

-- ------------------------------------------------------------
-- Verification.
-- ------------------------------------------------------------
create table verification_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  claim        text not null,
  evidence_url text not null,
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected')),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table vouches (
  voucher_id uuid not null references auth.users(id) on delete cascade,
  vouchee_id uuid not null references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  primary key (voucher_id, vouchee_id),
  check (voucher_id <> vouchee_id)
);

create or replace function apply_vouch() returns trigger
language plpgsql security definer set search_path = public as $body$
declare
  voucher_tier text;
  n_vouches    integer;
begin
  select tier into voucher_tier from player_ratings where user_id = new.voucher_id;
  if voucher_tier <> 'diamond' then
    raise exception 'Only diamond players can vouch';
  end if;

  select count(*) into n_vouches
  from vouches v
  join player_ratings pr on pr.user_id = v.voucher_id
  where v.vouchee_id = new.vouchee_id and pr.tier = 'diamond';

  if n_vouches >= 2 then
    update player_ratings
       set verification = 'vouched', updated_at = now()
     where user_id = new.vouchee_id and verification = 'self';
  end if;
  return new;
end;
$body$;

create trigger vouch_promotes after insert on vouches
  for each row execute function apply_vouch();

-- ============================================================
-- THE ENGINE
-- ============================================================
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

-- ============================================================
-- RLS
-- ============================================================
alter table player_ratings        enable row level security;
alter table peer_votes            enable row level security;
alter table session_attendance    enable row level security;
alter table tier_sessions         enable row level security;
alter table rating_events         enable row level security;
alter table verification_requests enable row level security;
alter table vouches               enable row level security;

create policy own_rating on player_ratings
  for select using (auth.uid() = user_id);

create policy cast_vote on peer_votes
  for insert with check (
    auth.uid() = voter_id
    and exists (
      select 1 from session_attendance a
       where a.session_id = peer_votes.session_id
         and a.user_id = auth.uid()
         and a.status = 'attended'
    )
    and exists (
      select 1 from tier_sessions s
       where s.id = peer_votes.session_id
         and s.state <> 'settled'
         and (s.votes_close_at is null or now() < s.votes_close_at)
    )
  );

create policy read_own_votes on peer_votes
  for select using (auth.uid() = voter_id);

create policy read_own_events on rating_events
  for select using (auth.uid() = user_id);

create policy read_tier_sessions on tier_sessions for select using (true);
create policy read_attendance on session_attendance for select using (true);

create policy own_verification on verification_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy read_vouches on vouches for select using (true);
create policy give_vouch on vouches
  for insert with check (auth.uid() = voucher_id);

-- ------------------------------------------------------------
-- The public card. Tier and reliability only — never the score.
-- ------------------------------------------------------------
create view player_cards
  with (security_invoker = false) as
  select user_id, tier, verification, sessions, round(reliability) as reliability
    from player_ratings;

grant select on player_cards to authenticated;

-- ------------------------------------------------------------
-- Seat pricing.
-- ------------------------------------------------------------
create table tier_pricing (
  tier       text primary key,
  seat_cents integer not null
);

insert into tier_pricing (tier, seat_cents) values
  ('bronze',   2200),
  ('silver',   2800),
  ('gold',     3500),
  ('platinum',    0),
  ('diamond', -2000);
