-- ============================================================
-- CT Pickup — Star ratings (Phase 4 Part C, step 2)
--
-- Adds a half-star rating (0.5..5.0) next to the existing tier on
-- player_ratings. Nothing reads these columns yet.
--
--   * Bands live in ONE place: star_bands. Half-open ranges
--     (score >= lower and < upper; upper null = open-ended).
--     star_of() reads the table; nothing else hard-codes thresholds.
--     Bands map 1:1 inside the existing tiers (bronze 0.5/1.0,
--     silver 1.5/2.0, gold 2.5/3.0, platinum 3.5/4.0, diamond
--     4.5/5.0) and use the same gates as tier_of(): 'verified' means
--     verification <> 'self'; unverified caps at 3.0; verified 90+
--     with reliability < 85 lands on 4.0.
--   * star_rating is kept current by a BEFORE trigger on
--     player_ratings. INSERT: star_of() with no damping. UPDATE OF
--     score, verification, reliability: score-boundary hysteresis
--     (star_hysteresis_margin(), the only place the margin lives);
--     eligibility caps (verification, reliability) apply immediately
--     and are never held over.
--   * star_provisional = fewer than star_provisional_events() rated
--     sessions (rows in rating_events, unique per session and user),
--     maintained by an AFTER INSERT/DELETE trigger on rating_events.
--     That trigger only writes star_provisional, which is not in the
--     star trigger's UPDATE OF list, so it never re-runs hysteresis.
--   * tier (generated) is unchanged.
--
-- Later steps (not in this migration):
--   * Points will be computed from the undamped band, star_of(), not
--     the damped star_rating; since stars map 1:1 within tiers,
--     points stay identical to today's tier-based points.
--   * Other players' stars will be exposed only through player_cards
--     (half-star and percentile only, never score, reliability or
--     verification). player_ratings RLS stays own-row only; the view
--     is not changed here.
--   * Step 6: pickup_runs.min_star numeric(2,1) for skill minimums.
--     Host-session skill values in open_tier_rank migrate
--     1->0.5, 2->1.5, 3->2.5, 4->3.5, 5->4.5, after which
--     open_tier_rank is wave-only. The column is not added here.
--   * sessions is incremented twice for a settled session (in
--     settle_session and in app/api/sessions/result/route.ts); fix
--     separately. star_provisional counts rating_events, not sessions,
--     so it is unaffected.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Bands. Mechanics only: players must never see thresholds.
-- ------------------------------------------------------------
create table if not exists public.star_bands (
  star              numeric(2,1) primary key
                      check (star between 0.5 and 5.0 and star * 2 = trunc(star * 2)),
  lower             numeric(5,2) not null check (lower between 0 and 100),
  upper             numeric(5,2) check (upper is null or (upper > lower and upper <= 100)),
  requires_verified boolean      not null default false,
  min_reliability   numeric(5,2) check (min_reliability is null or min_reliability between 0 and 100)
);

insert into public.star_bands (star, lower, upper, requires_verified, min_reliability) values
  (0.5,  0, 20, false, null),
  (1.0, 20, 40, false, null),
  (1.5, 40, 50, false, null),
  (2.0, 50, 60, false, null),
  (2.5, 60, 69, false, null),
  (3.0, 69, 78, false, null),
  (3.5, 78, 84, true,  null),
  (4.0, 84, 90, true,  null),
  (4.5, 90, 95, true,  85),
  (5.0, 95, null, true, 85)
on conflict (star) do update
  set lower = excluded.lower,
      upper = excluded.upper,
      requires_verified = excluded.requires_verified,
      min_reliability = excluded.min_reliability;

-- star_of() takes the highest eligible band whose lower bound the score
-- reaches, which is only correct if bands are contiguous and increasing
-- and the bottom band is open to everyone.
do $check$
declare
  bad integer;
begin
  select count(*) into bad
    from (
      select star, lower, upper,
             lead(lower) over (order by lower) as next_lower,
             lead(star)  over (order by lower) as next_star
        from public.star_bands
    ) b
   where (b.next_lower is null and b.upper is not null)
      or (b.next_lower is not null and b.upper is distinct from b.next_lower)
      or (b.next_star is not null and b.next_star <= b.star);
  if bad > 0 then
    raise exception 'star_bands must be contiguous, half-open and increasing (% bad rows)', bad;
  end if;
  if not exists (
    select 1 from public.star_bands
     where lower = 0 and not requires_verified and min_reliability is null
  ) then
    raise exception 'star_bands needs an ungated bottom band starting at 0';
  end if;
end;
$check$;

alter table public.star_bands enable row level security;
revoke all on table public.star_bands from anon, authenticated;

-- ------------------------------------------------------------
-- Constants. Each lives here and nowhere else.
-- ------------------------------------------------------------
create or replace function public.star_hysteresis_margin()
returns numeric
language sql immutable parallel safe as $body$
  select 1.0::numeric;
$body$;

create or replace function public.star_provisional_events()
returns integer
language sql immutable parallel safe as $body$
  select 5;
$body$;

-- ------------------------------------------------------------
-- Undamped star for a score and its eligibility gates.
-- ------------------------------------------------------------
create or replace function public.star_of(
  p_score        numeric,
  p_verification verification_level,
  p_reliability  numeric
) returns numeric
language plpgsql stable security definer set search_path = public as $body$
declare
  result numeric;
begin
  select max(b.star) into result
    from star_bands b
   where p_score >= b.lower
     and (not b.requires_verified or p_verification <> 'self')
     and (b.min_reliability is null or p_reliability >= b.min_reliability);
  if result is null then
    raise exception 'star_of: no band for score %, verification %, reliability %',
      p_score, p_verification, p_reliability;
  end if;
  return result;
end;
$body$;

-- ------------------------------------------------------------
-- Columns.
-- ------------------------------------------------------------
alter table public.player_ratings
  add column if not exists star_rating numeric(2,1),
  add column if not exists star_provisional boolean not null default true;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'player_ratings_star_rating_half_steps'
       and conrelid = 'public.player_ratings'::regclass
  ) then
    alter table public.player_ratings
      add constraint player_ratings_star_rating_half_steps
      check (star_rating between 0.5 and 5.0 and star_rating * 2 = trunc(star_rating * 2));
  end if;
end;
$constraint$;

-- Backfill without hysteresis. coalesce keeps an existing (damped) star
-- if this migration is re-run. updated_at is deliberately not touched.
update public.player_ratings pr
   set star_rating = coalesce(pr.star_rating, public.star_of(pr.score, pr.verification, pr.reliability)),
       star_provisional = (
         select count(*) from public.rating_events e where e.user_id = pr.user_id
       ) < public.star_provisional_events();

alter table public.player_ratings alter column star_rating set not null;

-- ------------------------------------------------------------
-- Keep star_rating current.
-- ------------------------------------------------------------
create or replace function public.player_ratings_set_star()
returns trigger
language plpgsql security definer set search_path = public as $body$
declare
  margin    numeric := star_hysteresis_margin();
  prev      numeric;
  up        numeric;
  down      numeric;
  cap       numeric;
  next_star numeric;
begin
  if tg_op = 'INSERT' then
    new.star_rating := star_of(new.score, new.verification, new.reliability);
    return new;
  end if;

  prev := coalesce(old.star_rating, star_of(new.score, new.verification, new.reliability));
  -- Move up only when the score clears the next boundary by the margin,
  -- down only when it falls below the current one by the margin.
  up   := star_of(greatest(new.score - margin, 0), new.verification, new.reliability);
  down := star_of(least(new.score + margin, 100), new.verification, new.reliability);
  next_star := case
    when up > prev   then up
    when down < prev then down
    else prev
  end;

  -- Eligibility caps apply immediately; hysteresis never holds a player above them.
  select max(b.star) into cap
    from star_bands b
   where (not b.requires_verified or new.verification <> 'self')
     and (b.min_reliability is null or new.reliability >= b.min_reliability);

  new.star_rating := least(next_star, cap);
  return new;
end;
$body$;

drop trigger if exists player_ratings_set_star on public.player_ratings;
create trigger player_ratings_set_star
  before insert or update of score, verification, reliability on public.player_ratings
  for each row execute function public.player_ratings_set_star();

-- ------------------------------------------------------------
-- Keep star_provisional current. rating_events is append-only;
-- DELETE is handled for safety (e.g. manual corrections).
-- ------------------------------------------------------------
create or replace function public.rating_events_set_star_provisional()
returns trigger
language plpgsql security definer set search_path = public as $body$
declare
  uid         uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  provisional boolean;
begin
  select count(*) < star_provisional_events() into provisional
    from rating_events e
   where e.user_id = uid;

  update player_ratings pr
     set star_provisional = provisional
   where pr.user_id = uid
     and pr.star_provisional is distinct from provisional;
  return null;
end;
$body$;

drop trigger if exists rating_events_set_star_provisional on public.rating_events;
create trigger rating_events_set_star_provisional
  after insert or delete on public.rating_events
  for each row execute function public.rating_events_set_star_provisional();

-- ------------------------------------------------------------
-- Players must not be able to probe thresholds through the functions.
-- ------------------------------------------------------------
revoke execute on function public.star_of(numeric, verification_level, numeric) from public, anon, authenticated;
revoke execute on function public.star_hysteresis_margin() from public, anon, authenticated;
revoke execute on function public.star_provisional_events() from public, anon, authenticated;
revoke execute on function public.player_ratings_set_star() from public, anon, authenticated;
revoke execute on function public.rating_events_set_star_provisional() from public, anon, authenticated;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop trigger if exists rating_events_set_star_provisional on public.rating_events;
-- drop trigger if exists player_ratings_set_star on public.player_ratings;
-- drop function if exists public.rating_events_set_star_provisional();
-- drop function if exists public.player_ratings_set_star();
-- alter table public.player_ratings drop constraint if exists player_ratings_star_rating_half_steps;
-- alter table public.player_ratings drop column if exists star_provisional;
-- alter table public.player_ratings drop column if exists star_rating;
-- drop function if exists public.star_of(numeric, verification_level, numeric);
-- drop function if exists public.star_provisional_events();
-- drop function if exists public.star_hysteresis_margin();
-- drop table if exists public.star_bands;
-- commit;
-- ============================================================
