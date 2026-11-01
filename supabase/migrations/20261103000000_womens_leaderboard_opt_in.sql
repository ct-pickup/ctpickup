-- ============================================================
-- CT Pickup: opt-in for the women's leaderboard (additive only)
--
-- ROLLBACK (run manually if needed):
--
--   begin;
--   drop index if exists public.profiles_womens_leaderboard_opt_in_idx;
--   alter table public.profiles drop column if exists womens_leaderboard_opt_in;
--   commit;
--   notify pgrst, 'reload schema';
--
-- What this adds
--   * profiles.womens_leaderboard_opt_in boolean not null default false. The player turns it on in Settings. Nobody is opted in until
--     they choose. It says nothing about gender and is not derived from gender, sex or gender_other (those are never read for this).
--   * A small partial index so the Women list can find opted-in players without scanning every profile.
--
-- Safe on DEV even when DEV is behind: it touches only public.profiles (which every environment has), uses IF NOT EXISTS, and does not
-- reference any other migration's objects. Safe to run twice. player_cards is NOT changed: the leaderboard API reads this column with
-- the service role, so no view needs it.
-- ============================================================

begin;

alter table public.profiles
  add column if not exists womens_leaderboard_opt_in boolean not null default false;

comment on column public.profiles.womens_leaderboard_opt_in is
  'Player chose to appear on the women''s leaderboard. Default false. Independent of every other profile field.';

create index if not exists profiles_womens_leaderboard_opt_in_idx
  on public.profiles (id)
  where womens_leaderboard_opt_in;

commit;

notify pgrst, 'reload schema';
