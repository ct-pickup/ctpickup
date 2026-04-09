-- One-shot (same as supabase/migrations/20260408130000_profiles_has_seen_dashboard_home.sql)
-- if migrations were not applied remotely.

alter table public.profiles add column if not exists has_seen_dashboard_home boolean;

update public.profiles
set has_seen_dashboard_home = true
where has_seen_dashboard_home is null;

alter table public.profiles alter column has_seen_dashboard_home set default false;
alter table public.profiles alter column has_seen_dashboard_home set not null;
