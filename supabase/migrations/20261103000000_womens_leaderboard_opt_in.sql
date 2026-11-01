-- ============================================================
-- CT Pickup: opt-in for the women's leaderboard, in its own private table (additive only)
--
-- ROLLBACK (run manually if needed):
--
--   begin;
--   drop table if exists public.womens_leaderboard_opt_in;
--   commit;
--   notify pgrst, 'reload schema';
--
-- What this adds
--   * public.womens_leaderboard_opt_in (user_id uuid primary key references auth.users on delete cascade, created_at).
--     A row means the player opted in; no row means not. Nobody is opted in until they choose.
--   * Row level security: a signed-in player can select, insert and delete ONLY their own row (auth.uid() = user_id). There is no update
--     policy (a row has nothing to change) and no other policy, so no other signed-in user can see who opted in. The leaderboard API
--     reads the table with the service role, which bypasses RLS, and never returns the flag.
--   * Why a table and not a profiles column: any signed-in user can read approved profiles, so a profiles column would be readable by others.
--
-- Safe on DEV even when DEV is behind: it needs only auth.users and auth.uid(), which every Supabase project has, and does not reference
-- any other migration's objects. Safe to run twice. Nothing here reads or writes gender or sex.
-- ============================================================

begin;

create table if not exists public.womens_leaderboard_opt_in (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.womens_leaderboard_opt_in is
  'A row means this player chose to appear on the women''s leaderboard. Private: only the owner can see their own row. Independent of every profile field.';

alter table public.womens_leaderboard_opt_in enable row level security;

-- Only the owner, only their own row, only these three actions.
revoke all on table public.womens_leaderboard_opt_in from public, anon, authenticated;
grant select, insert, delete on table public.womens_leaderboard_opt_in to authenticated;
grant all on table public.womens_leaderboard_opt_in to service_role;

drop policy if exists womens_optin_select_own on public.womens_leaderboard_opt_in;
create policy womens_optin_select_own on public.womens_leaderboard_opt_in
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists womens_optin_insert_own on public.womens_leaderboard_opt_in;
create policy womens_optin_insert_own on public.womens_leaderboard_opt_in
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists womens_optin_delete_own on public.womens_leaderboard_opt_in;
create policy womens_optin_delete_own on public.womens_leaderboard_opt_in
  for delete to authenticated using (auth.uid() = user_id);

commit;

notify pgrst, 'reload schema';
