-- Ensure esports tournament registrations table exists in production.
-- This migration is intentionally idempotent to protect against "schema cache" drift
-- when a prior migration did not run in the remote Supabase project.

create table if not exists public.esports_tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tournament_id uuid not null references public.esports_tournaments (id) on delete cascade,

  -- Consent capture
  signed_full_name text not null,
  doc_version_official_rules text not null,
  doc_version_terms text not null,
  doc_version_privacy_publicity text not null,
  confirmations jsonb not null,
  consent_ip_address text,
  consent_user_agent text,
  consent_recorded_at timestamptz not null default now(),
  auth_email text,

  -- Payment tracking
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'checkout_started', 'paid', 'refunded')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,

  -- Link to tournament identity (may be null for legacy rows)
  esports_player_profile_id uuid references public.esports_player_profiles (id) on delete set null,

  unique (user_id, tournament_id)
);

create index if not exists esports_registrations_tournament_idx
  on public.esports_tournament_registrations (tournament_id, created_at desc);

create index if not exists esports_registrations_user_idx
  on public.esports_tournament_registrations (user_id, created_at desc);

create index if not exists esports_registrations_stripe_session_idx
  on public.esports_tournament_registrations (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists esports_registrations_profile_idx
  on public.esports_tournament_registrations (esports_player_profile_id);

comment on table public.esports_tournament_registrations is
  'Esports entry: typed consent with document versions, IP/UA audit, and payment state. Inserts via service role from API.';

alter table public.esports_tournament_registrations enable row level security;

-- Users can see their own registration rows; admin server actions use service role.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'esports_tournament_registrations'
      and policyname = 'esports_registrations_select_own'
  ) then
    create policy "esports_registrations_select_own"
      on public.esports_tournament_registrations
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

