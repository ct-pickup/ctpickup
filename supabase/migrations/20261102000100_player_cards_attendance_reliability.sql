-- ============================================================
-- CT Pickup: player_cards also exposes attendance_reliability
--
-- ROLLBACK (run manually if needed; restores the view from 20261102000000_player_cards_exact_rating.sql):
--
--   begin;
--   drop view if exists public.player_cards restrict;
--   create view public.player_cards
--     with (security_invoker = false) as
--     select pr.user_id, pr.star_rating, pr.star_provisional,
--            greatest(1, ceil(100 * percent_rank() over (order by pr.star_rating desc, pr.score desc)))::integer as percentile,
--            pr.tier, pr.verification, pr.sessions, round(pr.reliability) as reliability,
--            public.star_exact(pr.score, pr.star_rating)::numeric(4,2) as rating_exact,
--            (select count(*) from public.rating_events e where e.user_id = pr.user_id)::integer as rated_games,
--            public.star_settled_games() as settled_games
--       from public.player_ratings pr;
--   revoke all on table public.player_cards from public, anon, authenticated;
--   grant select on table public.player_cards to authenticated;
--   commit;
--   notify pgrst, 'reload schema';
--
-- What this adds: ONE column, appended after the existing eleven.
--   * attendance_reliability integer 0 to 100: player_ratings.reliability rounded. It is the show-up reliability the rating system
--     already keeps (starts at 92, +1 per settled game up to 100, -7 per no-show down to 0). Nothing about how it is computed changes.
--     It is a new, non-legacy name so the app never has to read the legacy `reliability` column, which goes away on 2026-12-01.
--
-- View safety (same as the previous version of player_cards):
--   * CREATE OR REPLACE VIEW keeps the owner, the grants and the dependencies. The first eleven columns keep their names, types, order and
--     expressions, the legacy `reliability` column included.
--   * WITH (security_invoker = false) is restated, so the view still reads player_ratings and rating_events as its owner and their RLS
--     stays own-row only. No grant or revoke is issued here, so SELECT stays with authenticated only.
-- Safe to run twice.
-- ============================================================

begin;

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
         public.star_settled_games() as settled_games,
         least(100, greatest(0, round(pr.reliability)))::integer as attendance_reliability
    from public.player_ratings pr;

comment on view public.player_cards is
  'Public player card: half-star rating, provisional flag, Top X% percentile, the exact two decimal rating, rated games, the games needed to settle and attendance reliability (0 to 100). tier, verification, sessions and reliability are legacy columns for App Store v1.3.5 only; remove on 2026-12-01. Never score.';

commit;

notify pgrst, 'reload schema';
