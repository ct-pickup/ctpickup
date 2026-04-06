-- Pickup player standing: operational status (automatic + manual), history, and reliability incidents.

create table if not exists public.pickup_player_standing (
  user_id uuid not null primary key references public.profiles (id) on delete cascade,

  -- Manual override (null = automatic only)
  manual_standing text
    constraint pickup_player_standing_manual_check
      check (manual_standing is null or manual_standing in ('good', 'warning', 'suspended', 'banned')),
  manual_reason text,
  staff_notes text,
  manual_updated_by uuid references auth.users (id) on delete set null,
  manual_updated_at timestamptz,

  -- Cached automatic evaluation (recomputed in app)
  auto_standing text not null default 'good'
    constraint pickup_player_standing_auto_check
      check (auto_standing in ('good', 'warning', 'suspended', 'banned')),
  auto_codes text[] not null default '{}'::text[],
  rollup_no_shows_90d integer not null default 0,
  rollup_late_cancels_90d integer not null default 0,
  rollup_pickup_payment_issues_90d integer not null default 0,
  waiver_current boolean not null default false,

  effective_standing text not null default 'good'
    constraint pickup_player_standing_effective_check
      check (effective_standing in ('good', 'warning', 'suspended', 'banned')),
  pickup_eligible boolean not null default true,

  updated_at timestamptz not null default now()
);

create index if not exists pickup_player_standing_effective_idx
  on public.pickup_player_standing (effective_standing);

create index if not exists pickup_player_standing_eligible_idx
  on public.pickup_player_standing (pickup_eligible);

comment on table public.pickup_player_standing is
  'Pickup participation standing: manual override, cached automatic evaluation, and eligibility.';

-- Append-only audit trail (admin actions + material auto changes)
create table if not exists public.pickup_standing_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null
    constraint pickup_standing_history_event_check
      check (event_type in ('manual_set', 'manual_clear', 'auto_changed', 'system_note')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pickup_standing_history_user_idx
  on public.pickup_standing_history (user_id, created_at desc);

comment on table public.pickup_standing_history is
  'Audit log for pickup standing changes.';

-- Factual reliability events (no-shows, late cancels); payment issues are derived from platform_payments at recompute time
create table if not exists public.pickup_reliability_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  run_id uuid references public.pickup_runs (id) on delete set null,
  kind text not null
    constraint pickup_reliability_incidents_kind_check
      check (kind in ('no_show', 'late_cancel')),
  source text not null
    constraint pickup_reliability_incidents_source_check
      check (source in ('attendance', 'admin')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists pickup_reliability_incidents_user_created_idx
  on public.pickup_reliability_incidents (user_id, created_at desc);

create index if not exists pickup_reliability_incidents_user_kind_created_idx
  on public.pickup_reliability_incidents (user_id, kind, created_at desc);

create unique index if not exists pickup_reliability_incidents_run_kind_unique
  on public.pickup_reliability_incidents (user_id, run_id, kind)
  where run_id is not null;

comment on table public.pickup_reliability_incidents is
  'Pickup reliability events used to compute automatic standing (no-shows, late cancellations).';

alter table public.pickup_player_standing enable row level security;
alter table public.pickup_standing_history enable row level security;
alter table public.pickup_reliability_incidents enable row level security;
