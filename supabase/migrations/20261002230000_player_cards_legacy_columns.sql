-- ============================================================
-- CT Pickup — player_cards keeps legacy columns for App Store v1.3.5
--
-- ALREADY APPLIED in production by hand. This file records that change
-- so the repo matches the live schema.
--
-- 20261002190000_player_cards_stars.sql removed tier, verification,
-- sessions and reliability from player_cards. The App Store build
-- v1.3.5 still reads player_cards(tier) for peer voting, and that broke.
-- This migration adds the legacy columns back after the star columns.
-- They exist only for v1.3.5. New code must not read them; see
-- scripts/check-player-cards.mjs.
--
-- TODO: Remove the legacy columns on 2026-12-01, or once v1.3.5 usage is
-- near zero, by recreating the view exactly as in
-- 20261002190000_player_cards_stars.sql. Do this together with deleting
-- lib/api/appVersion.ts.
--
--   * Safe to re-run: the drop and create happen in one transaction
--     and always produce the same definition and grants.
--   * security_invoker = false and SELECT for authenticated only, as
--     in 20261002190000. score is still never exposed.
--   * DROP VIEW stays RESTRICT so it fails instead of silently
--     dropping anything that came to depend on player_cards.
-- ============================================================

begin;

drop view if exists public.player_cards restrict;

create view public.player_cards
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
         round(pr.reliability) as reliability
    from public.player_ratings pr;

comment on view public.player_cards is
  'Public player card: half-star rating, provisional flag and Top X% percentile. tier, verification, sessions and reliability are legacy columns for App Store v1.3.5 only; remove on 2026-12-01. Never score.';

revoke all on table public.player_cards from public, anon, authenticated;
grant select on table public.player_cards to authenticated;

commit;

notify pgrst, 'reload schema';
