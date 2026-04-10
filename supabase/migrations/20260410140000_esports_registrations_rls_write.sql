-- Allow authenticated users to create and manage their own esports registrations.
-- Required for API routes that use the authenticated server client (RLS enforced).

alter table public.esports_tournament_registrations enable row level security;

drop policy if exists "esports_registrations_insert_own" on public.esports_tournament_registrations;
create policy "esports_registrations_insert_own"
  on public.esports_tournament_registrations
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "esports_registrations_update_own" on public.esports_tournament_registrations;
create policy "esports_registrations_update_own"
  on public.esports_tournament_registrations
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

