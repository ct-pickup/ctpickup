-- Enable RLS on profiles, pickup_runs, and pickup_run_rsvps with least-privilege policies.
-- Server routes use the service role; these policies protect direct PostgREST / client access.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using (public.is_admin_uid(auth.uid()));

-- UPDATE own row (may already exist from 20260515120000_profiles_authenticated_update_own.sql)
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- pickup_runs
-- ---------------------------------------------------------------------------

alter table public.pickup_runs enable row level security;

drop policy if exists pickup_runs_select_authenticated on public.pickup_runs;
create policy pickup_runs_select_authenticated
  on public.pickup_runs
  for select
  to authenticated
  using (true);

drop policy if exists pickup_runs_insert_admin on public.pickup_runs;
create policy pickup_runs_insert_admin
  on public.pickup_runs
  for insert
  to authenticated
  with check (public.is_admin_uid(auth.uid()));

drop policy if exists pickup_runs_update_admin on public.pickup_runs;
create policy pickup_runs_update_admin
  on public.pickup_runs
  for update
  to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

drop policy if exists pickup_runs_delete_admin on public.pickup_runs;
create policy pickup_runs_delete_admin
  on public.pickup_runs
  for delete
  to authenticated
  using (public.is_admin_uid(auth.uid()));

-- ---------------------------------------------------------------------------
-- pickup_run_rsvps
-- ---------------------------------------------------------------------------

alter table public.pickup_run_rsvps enable row level security;

drop policy if exists pickup_run_rsvps_select_own_or_run on public.pickup_run_rsvps;
create policy pickup_run_rsvps_select_own_or_run
  on public.pickup_run_rsvps
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin_uid(auth.uid())
  );

drop policy if exists pickup_run_rsvps_insert_own on public.pickup_run_rsvps;
create policy pickup_run_rsvps_insert_own
  on public.pickup_run_rsvps
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists pickup_run_rsvps_update_own on public.pickup_run_rsvps;
create policy pickup_run_rsvps_update_own
  on public.pickup_run_rsvps
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists pickup_run_rsvps_admin_all on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_all
  on public.pickup_run_rsvps
  for all
  to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));
