-- ============================================================
-- CT Pickup — Host invites for Fill your game (additive only)
--
--   * profiles.allow_host_invites: player opt-out for host invites.
--     Default true. The app treats a missing column as on.
--   * pickup_run_host_invites: one row per (run, invitee) sent from
--     Fill your game. Gives sent state and the per-game cap (20,
--     counted across all inviters). pickup_run_invites cannot serve
--     this: wave outreach bulk-inserts there and it has no inviter.
--     Until this table exists the invite endpoint returns 503 and
--     the candidate list shows nobody as invited.
--   * Service role only (API routes). No client access.
--   * The list endpoint's rate limit reuses api_rate_limit_buckets /
--     api_rate_limit_check from 20260520140000; nothing new here.
-- ============================================================

begin;

alter table public.profiles
  add column if not exists allow_host_invites boolean not null default true;

comment on column public.profiles.allow_host_invites is
  'When false, hosts cannot invite this player from Fill your game.';

create table if not exists public.pickup_run_host_invites (
  run_id     uuid        not null references public.pickup_runs (id) on delete cascade,
  invitee_id uuid        not null references auth.users (id) on delete cascade,
  inviter_id uuid        references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (run_id, invitee_id)
);

create index if not exists pickup_run_host_invites_invitee_idx
  on public.pickup_run_host_invites (invitee_id);

alter table public.pickup_run_host_invites enable row level security;
revoke all on table public.pickup_run_host_invites from anon, authenticated;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.pickup_run_host_invites;
-- alter table public.profiles drop column if exists allow_host_invites;
-- commit;
-- ============================================================
