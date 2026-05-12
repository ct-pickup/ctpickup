-- When row level security is enabled on public.profiles, PostgREST updates can return
-- zero rows with no error if no UPDATE policy matches (looks like a successful save in the app).
-- Allow authenticated users to update only their own row (id = auth.uid()).

drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
