-- Let any signed-in user read approved, non-banned profiles (player directory, follows, etc.).
-- Own-row and admin-wide policies remain; RLS ORs SELECT policies.

drop policy if exists profiles_select_approved_directory on public.profiles;
create policy profiles_select_approved_directory
  on public.profiles
  for select
  to authenticated
  using (approved = true and is_banned = false);

comment on policy profiles_select_approved_directory on public.profiles is
  'Approved player directory: any authenticated user can read approved, non-banned rows.';
