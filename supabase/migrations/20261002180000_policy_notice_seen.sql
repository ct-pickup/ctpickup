-- ============================================================
-- CT Pickup: cancellation policy notice (additive only)
--
--   * profiles.cancellation_policy_notice_seen_at: when the user
--     dismissed the one-time "We updated our cancellation policy"
--     notice. Null means not seen yet.
--   * Written by the signed-in user on their own row through the
--     existing "Users can update own profile" policy; no new policy.
--   * Until this runs the apps fall back to a per-device local flag.
-- ============================================================

begin;

alter table public.profiles
  add column if not exists cancellation_policy_notice_seen_at timestamptz;

comment on column public.profiles.cancellation_policy_notice_seen_at is
  'When the user dismissed the October 2026 cancellation policy notice. Null = not seen.';

commit;
