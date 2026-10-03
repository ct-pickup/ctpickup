-- Report photo: players flag another player's profile photo; admins remove it or dismiss.
-- Reads and writes go through /api/profile-photo/report and /api/admin/photo-reports with the
-- service role, so RLS is on with no policies (anon and authenticated see nothing).
-- The avatars bucket itself comes from 20260405120000_profile_avatar.sql.
-- Safe to paste into the Supabase SQL editor more than once.

create table if not exists public.photo_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_user_id uuid not null references auth.users (id) on delete cascade,
  photo_url text,
  reason text,
  status text not null default 'open',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint photo_reports_reason_check check (reason is null or reason in ('not_them', 'inappropriate', 'other')),
  constraint photo_reports_status_check check (status in ('open', 'removed', 'dismissed')),
  constraint photo_reports_not_self check (reporter_id <> reported_user_id)
);

comment on table public.photo_reports is
  'Profile photo reports. photo_url is a snapshot of profiles.avatar_url when reported.';

-- One open report per reporter per player.
create unique index if not exists photo_reports_one_open_per_pair
  on public.photo_reports (reporter_id, reported_user_id)
  where status = 'open';

create index if not exists photo_reports_open_by_user
  on public.photo_reports (reported_user_id, created_at desc)
  where status = 'open';

create index if not exists photo_reports_removed_by_user
  on public.photo_reports (reported_user_id, reviewed_at desc)
  where status = 'removed';

alter table public.photo_reports enable row level security;

revoke all on public.photo_reports from anon, authenticated;
