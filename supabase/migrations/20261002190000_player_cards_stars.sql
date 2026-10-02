-- ============================================================
-- CT Pickup — player_cards exposes stars (Phase 4 Part C, step 3)
--
-- player_cards is the only way clients see other players' ratings.
-- It now exposes the half-star rating, the provisional flag and a
-- "Top X%" percentile. tier, verification, sessions and reliability
-- are dropped; score was never exposed and still is not.
--
--   * security_invoker = false: the view reads player_ratings as its
--     owner, so player_ratings RLS stays own-row only and clients get
--     no direct access to player_ratings.
--   * percentile (integer 1..100, shown as "Top X%"):
--       greatest(1, ceil(100 * percent_rank() over
--         (order by star_rating desc, score desc)))
--     percent_rank is (rank - 1) / (rows - 1), so the best player is 0
--     and the worst is 1. Ordering descending makes the top player
--     "Top 1%" after the clamp (never "Top 0%"); ceil keeps everyone
--     else from rounding up into a better bucket. score only breaks
--     ties between equal stars and is never returned. A single row
--     yields percent_rank 0, i.e. "Top 1%".
--   * Dependencies: no function, view or policy references
--     player_cards (checked across supabase/migrations). DROP VIEW is
--     left as RESTRICT so the migration fails instead of silently
--     dropping anything added outside migrations.
--   * Writes never went through player_cards (service role and
--     SECURITY DEFINER write player_ratings directly).
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
         )::integer as percentile
    from public.player_ratings pr;

comment on view public.player_cards is
  'Public player card: half-star rating, provisional flag and Top X% percentile. Never score, tier, verification or reliability.';

revoke all on table public.player_cards from public, anon, authenticated;
grant select on table public.player_cards to authenticated;

commit;

notify pgrst, 'reload schema';

-- ============================================================
-- Rollback (run manually if needed). Restores the definition from
-- 20260708000001_tier_system.sql.
--
-- begin;
-- drop view if exists public.player_cards restrict;
-- create view public.player_cards
--   with (security_invoker = false) as
--   select user_id, tier, verification, sessions, round(reliability) as reliability
--     from public.player_ratings;
-- revoke all on table public.player_cards from public, anon, authenticated;
-- grant select on table public.player_cards to authenticated;
-- commit;
-- notify pgrst, 'reload schema';
-- ============================================================
