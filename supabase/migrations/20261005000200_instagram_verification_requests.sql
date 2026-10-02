-- ============================================================
-- CT Pickup — Instagram verification (3 of 3): requests table
--
-- WARNING: approving a request sets 'instagram' on
-- player_ratings.verification, which unlocks stars above 3.0 and the
-- platinum/diamond tiers; see 20261005000000_verification_level_instagram.sql.
--
--   * The player asks for a code for their handle; the server stores
--     only code_hash (HMAC-SHA256 under INSTAGRAM_VERIFY_SECRET),
--     code_ciphertext (AES-256-GCM, readable only by the owner through
--     the API) and code_hint (last 2 characters, for the admin queue).
--   * code_hash is unique: a code is never issued twice.
--   * One pending request per user (partial unique index). The API marks
--     a pending request 'expired' once expires_at (7 days) has passed,
--     which frees the slot for a new one.
--   * Approve: the admin types the code from the DM and the server
--     checks it against code_hash. Reject needs a reason.
--   * RLS on with no policies and no client grants: service role only.
-- ============================================================

begin;

create table if not exists public.instagram_verification_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  handle          text not null check (handle ~ '^[a-z0-9._]{1,30}$'),
  code_hash       text not null,
  code_hint       text not null check (code_hint ~ '^[A-HJKMNP-Z2-9]{2}$'),
  code_ciphertext text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at      timestamptz not null,
  reject_reason   text,
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint ig_verify_code_hash_unique unique (code_hash),
  constraint ig_verify_expires_after_created check (expires_at > created_at),
  constraint ig_verify_reject_reason check (
    status <> 'rejected' or (reject_reason is not null and btrim(reject_reason) <> '')
  ),
  constraint ig_verify_reviewed check (
    status not in ('approved', 'rejected') or reviewed_at is not null
  )
);

create unique index if not exists ig_verify_one_pending_per_user
  on public.instagram_verification_requests (user_id)
  where status = 'pending';

create index if not exists ig_verify_pending_queue
  on public.instagram_verification_requests (created_at)
  where status = 'pending';

create index if not exists ig_verify_user_created
  on public.instagram_verification_requests (user_id, created_at desc);

alter table public.instagram_verification_requests enable row level security;
revoke all on table public.instagram_verification_requests from public, anon, authenticated;

comment on table public.instagram_verification_requests is
  'Instagram DM verification. Service role only. Never stores the code in the clear.';

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.instagram_verification_requests;
-- commit;
-- ============================================================
