-- ============================================================
-- CT Pickup: player_cards also exposes the exact rating and the games behind it
--
-- ROLLBACK (run manually if needed; restores the view from 20261002230000_player_cards_legacy_columns.sql):
--
--   begin;
--   drop view if exists public.player_cards restrict;
--   create view public.player_cards
--     with (security_invoker = false) as
--     select pr.user_id, pr.star_rating, pr.star_provisional,
--            greatest(1, ceil(100 * percent_rank() over (order by pr.star_rating desc, pr.score desc)))::integer as percentile,
--            pr.tier, pr.verification, pr.sessions, round(pr.reliability) as reliability
--       from public.player_ratings pr;
--   revoke all on table public.player_cards from public, anon, authenticated;
--   grant select on table public.player_cards to authenticated;
--   drop function if exists public.star_exact(numeric, numeric);
--   drop function if exists public.star_settled_games();
--   commit;
--   notify pgrst, 'reload schema';
--   (The index rating_events_user_id_idx can stay; it is harmless.)
--
-- What this adds, all derived, nothing stored and no rating math changed:
--   * rating_exact  numeric(4,2): the score as a two decimal rating that always rounds (to the nearest half) to the stored star_rating.
--       Inside the star's band the score is placed linearly between star - 0.24 and star + 0.24, clamped to 0.50 .. 5.00, so
--       3.5 (78 to 84) shows 3.26 to 3.74 and 5.0 shows 4.76 to 5.00. The stored star decides the band, so hysteresis and the
--       verification / reliability caps can never make the decimal disagree with the stars. The raw score is not exposed (the
--       mapping is not reversible without the band, and the app never gets the band edges).
--   * rated_games   integer: rows in rating_events for the player, the same count the provisional rule uses.
--   * settled_games integer: star_provisional_events() (5 today). rated_games >= settled_games is exactly "not provisional".
--
-- View safety (same as every earlier version of player_cards):
--   * CREATE OR REPLACE VIEW keeps the owner, the grants and the dependencies. Existing columns keep their names, types and order;
--     the three new columns are appended AFTER the legacy ones, so a client that depends on column order (or select *) still gets
--     user_id, star_rating, star_provisional, percentile, tier, verification, sessions, reliability first and unchanged.
--   * WITH (security_invoker = false) is restated, so the view still reads player_ratings and rating_events as its owner and
--     their RLS stays own-row only. No grant or revoke is issued here, so SELECT stays with authenticated only.
--   * The helper functions are SECURITY DEFINER because star_bands and star_provisional_events() are not readable by players;
--     a function inside a view is checked against the player reading it, so they get EXECUTE (nothing else).
-- Safe to run twice.
-- ============================================================

begin;

-- Counting a player's games must not scan the whole table for each profile.
create index if not exists rating_events_user_id_idx on public.rating_events (user_id);

-- Placement of a score inside the band of the star it was given. Display only. Never sees or returns anything but a number.
create or replace function public.star_exact(p_score numeric, p_star numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when b.star is null or p_score is null then null
    else round(
      greatest(0.5, b.star - 0.24)
      + (least(5.0, b.star + 0.24) - greatest(0.5, b.star - 0.24))
        * greatest(0, least(1, (p_score - b.lower) / nullif(coalesce(b.upper, 100) - b.lower, 0))),
      2)
  end
  from (select 1) one left join public.star_bands b on b.star = p_star;
$$;
revoke all on function public.star_exact(numeric, numeric) from public, anon;
grant execute on function public.star_exact(numeric, numeric) to authenticated, service_role;

-- The games after which a rating stops being provisional. One source: the provisional rule itself.
create or replace function public.star_settled_games()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.star_provisional_events();
$$;
revoke all on function public.star_settled_games() from public, anon;
grant execute on function public.star_settled_games() to authenticated, service_role;

create or replace view public.player_cards
  with (security_invoker = false) as
  select pr.user_id,
         pr.star_rating,
         pr.star_provisional,
         greatest(
           1,
           ceil(100 * percent_rank() over (order by pr.star_rating desc, pr.score desc))
         )::integer as percentile,
         pr.tier,
         pr.verification,
         pr.sessions,
         round(pr.reliability) as reliability,
         public.star_exact(pr.score, pr.star_rating)::numeric(4,2) as rating_exact,
         (select count(*) from public.rating_events e where e.user_id = pr.user_id)::integer as rated_games,
         public.star_settled_games() as settled_games
    from public.player_ratings pr;

comment on view public.player_cards is
  'Public player card: half-star rating, provisional flag, Top X% percentile, the exact two decimal rating, rated games and the games needed to settle. tier, verification, sessions and reliability are legacy columns for App Store v1.3.5 only; remove on 2026-12-01. Never score.';

commit;

notify pgrst, 'reload schema';
