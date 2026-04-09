-- First-run member hub on `/` vs redirect to `/dashboard` for returning users.
alter table public.profiles add column if not exists has_seen_dashboard_home boolean;

-- Existing accounts: treat as already onboarded to the hub (no forced first-run on `/`).
update public.profiles
set has_seen_dashboard_home = true
where has_seen_dashboard_home is null;

alter table public.profiles alter column has_seen_dashboard_home set default false;
alter table public.profiles alter column has_seen_dashboard_home set not null;

comment on column public.profiles.has_seen_dashboard_home is
  'When false, logged-in user sees dashboard-style welcome on `/` instead of redirecting to `/dashboard`. Set true after first hub exposure (e.g. visiting /dashboard or completing welcome on `/`).';
