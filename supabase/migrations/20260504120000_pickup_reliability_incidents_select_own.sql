-- Let each player read their own reliability incidents (late cancel / no-show rows only).
-- Needed for mobile scoring fallback when PostgREST reads counts with the anon/authenticated role.

drop policy if exists "pickup_reliability_incidents_select_own" on public.pickup_reliability_incidents;

create policy "pickup_reliability_incidents_select_own"
  on public.pickup_reliability_incidents
  for select
  to authenticated
  using (user_id = auth.uid());
