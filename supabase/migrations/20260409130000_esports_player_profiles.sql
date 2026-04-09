-- Esports tournament identity/profile.
create table if not exists public.esports_player_profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  user_id uuid not null references auth.users (id) on delete cascade,
  -- Canonical identity for tournaments
  legal_name text not null,
  contact_email text not null,
  state text not null,

  -- Platform identity
  platform text not null check (platform in ('playstation', 'xbox')),
  psn_id text,
  xbox_gamertag text,
  ea_account text,

  -- Eligibility evidence (pick one approach):
  -- - optional DOB (if you want to store it), and/or
  -- - affirmation that user is 18+ (required for registration)
  date_of_birth date,
  affirmed_18_plus boolean not null default false,

  unique (user_id)
);

create index if not exists esports_player_profiles_user_idx
  on public.esports_player_profiles (user_id);

comment on table public.esports_player_profiles is
  'Tournament identity for esports: platform IDs + legal/contact fields; collected only during tournament registration.';

alter table public.esports_player_profiles enable row level security;

-- Users can read and manage their own esports profile.
create policy "esports_player_profiles_select_own"
  on public.esports_player_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "esports_player_profiles_insert_own"
  on public.esports_player_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "esports_player_profiles_update_own"
  on public.esports_player_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

