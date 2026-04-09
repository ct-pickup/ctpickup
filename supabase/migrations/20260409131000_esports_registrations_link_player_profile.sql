-- Link tournament registrations to the esports player profile (tournament identity).
alter table public.esports_tournament_registrations
  add column if not exists esports_player_profile_id uuid references public.esports_player_profiles (id) on delete set null;

create index if not exists esports_registrations_profile_idx
  on public.esports_tournament_registrations (esports_player_profile_id);

