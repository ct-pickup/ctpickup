-- Tier promotion suggestions (admin review queue)

create table if not exists public.tier_promotion_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  current_tier text,
  suggested_tier text not null,
  reason text,
  runs_attended int not null default 0,
  attendance_rate numeric not null default 0,
  no_show_count int not null default 0,
  created_at timestamptz not null default now(),
  reviewed boolean not null default false,
  accepted boolean null,
  reviewed_at timestamptz null,
  reviewed_by uuid references public.profiles (id) on delete set null
);

create index if not exists tier_promotion_suggestions_pending_idx
  on public.tier_promotion_suggestions (reviewed, created_at desc)
  where reviewed = false;

create index if not exists tier_promotion_suggestions_user_idx
  on public.tier_promotion_suggestions (user_id, created_at desc);

