-- Feature flags for the retention and analytics work. All start OFF. Needs 20261024000000_app_flags.sql.
-- Additive and idempotent (on conflict do nothing: re-running never switches a flag back off or on).
--
--   notification_settings  per-category push switches and quiet hours in Settings
--   analytics_client       the app sends views and taps to first-party analytics (players can opt out in Settings)
--   play_again             "Play with this group again" on the recap and "Repeat this game" when hosting
--   host_follow_alerts     followers get a push when a host they follow posts a new game
--
-- Verify after running:
--   select key, enabled from public.app_flags where key in ('notification_settings','analytics_client','play_again','host_follow_alerts') order by key;   -- 4 rows, all false
-- Rollback (manual):
--   delete from public.app_flags where key in ('notification_settings','analytics_client','play_again','host_follow_alerts');
begin;

insert into public.app_flags (key, enabled, note) values
  ('notification_settings', false, 'Per-category push switches and quiet hours'),
  ('analytics_client', false, 'App sends views and taps to first-party analytics'),
  ('play_again', false, 'Play with this group again; Repeat this game'),
  ('host_follow_alerts', false, 'Push followers when a followed host posts a game')
on conflict (key) do nothing;

commit;
