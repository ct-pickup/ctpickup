-- ============================================================
-- CT Pickup — Instagram verification (1 of 3): 'instagram' verification level
--
-- !! WARNING: THIS UNLOCKS STARS AND TIERS !!
-- star_of(), player_ratings_set_star() (20261002150000_star_ratings.sql)
-- and tier_of() (20260708000001_tier_system.sql) treat every
-- verification value other than 'self' as verified. Approving a player
-- through Instagram (player_ratings.verification = 'instagram') therefore
-- lifts the unverified 3.0 cap the moment the admin approves: the BEFORE
-- UPDATE OF verification trigger recomputes star_rating, moving up to
-- star_of(score - 1.0) (the hysteresis margin). Score 79+ -> 3.5 at once,
-- 85+ -> 4.0, 91+ with reliability >= 85 -> 4.5, 96+ -> 5.0; a score less
-- than 1.0 above a boundary waits for its next change. The generated tier
-- can become platinum or diamond at the same moment. star_of, star_bands
-- and every gate are deliberately unchanged.
--
-- Its own file with no transaction block: a new enum value cannot be
-- used in the transaction that adds it.
-- ============================================================

alter type public.verification_level add value if not exists 'instagram';

-- ============================================================
-- Rollback: Postgres cannot drop an enum value. Move rows back first
-- (update player_ratings set verification = 'self' where verification =
-- 'instagram'), then leave the unused value in place.
-- ============================================================
