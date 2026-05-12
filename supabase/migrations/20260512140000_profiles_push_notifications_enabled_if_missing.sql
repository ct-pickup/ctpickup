-- Idempotent guard for environments that have not applied earlier push-pref migrations.
alter table public.profiles
  add column if not exists push_notifications_enabled boolean default true;
