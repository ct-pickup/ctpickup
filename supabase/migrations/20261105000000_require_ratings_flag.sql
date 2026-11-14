-- Feature flag for "Rate your last game first". Starts OFF. Needs 20261024000000_app_flags.sql.
-- Additive and idempotent (on conflict do nothing: re-running never switches the flag back off or on, and never touches its allowlist).
-- NOT applied by this change; it is a file only.
--
--   require_ratings   After a game, a player must submit their top 3 rating ballot before they can join, RSVP, book or create
--                     another game. A soft gate: the server answers 409 "Rate your last game first" and the app opens a sheet
--                     that goes straight to that game's ballot. The requirement expires 72 hours after kickoff. Admins are never
--                     blocked (this flag is the one exception to "admins are always on").
--
--   To try it on your own account first: leave enabled false and add your player id to the allowlist (admin Feature flags screen,
--   or: update public.app_flags set allowlist = allowlist || '<your user id>'::uuid where key = 'require_ratings';). Note that an
--   admin account is exempt from the gate, so test with a non-admin account.
--
-- Verify after running:
--   select key, enabled, allowlist from public.app_flags where key = 'require_ratings';   -- 1 row, enabled false
-- Rollback (manual; with no row the server treats the flag as off and nobody is blocked):
--   delete from public.app_flags where key = 'require_ratings';
begin;

insert into public.app_flags (key, enabled, note) values
  ('require_ratings', false, 'Players must submit their post-game rating ballot before joining or booking another game (admins exempt)')
on conflict (key) do nothing;

commit;
