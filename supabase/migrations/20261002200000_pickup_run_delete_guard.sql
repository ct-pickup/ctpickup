-- A pickup run can only be hard deleted when nobody joined and nothing was paid; otherwise it must be cancelled
-- through the admin cancel route so players are refunded and notified. Also stops clients deleting runs or RSVPs
-- directly through PostgREST. Server routes use the service role and are unaffected by the policy changes.

create or replace function public.pickup_runs_block_delete_with_players()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.pickup_run_rsvps where run_id = old.id) then
    raise exception 'Pickup run % has RSVPs; cancel it instead of deleting it.', old.id
      using errcode = '23503';
  end if;
  if exists (
    select 1 from public.platform_payments
    where product_entity_id = old.id::text or metadata->>'run_id' = old.id::text
  ) then
    raise exception 'Pickup run % has payments; cancel it instead of deleting it.', old.id
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pickup_runs_block_delete_with_players on public.pickup_runs;
create trigger trg_pickup_runs_block_delete_with_players
  before delete on public.pickup_runs
  for each row execute function public.pickup_runs_block_delete_with_players();

drop policy if exists pickup_runs_delete_admin on public.pickup_runs;

drop policy if exists pickup_run_rsvps_admin_all on public.pickup_run_rsvps;

drop policy if exists pickup_run_rsvps_admin_select on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_select
  on public.pickup_run_rsvps
  for select
  to authenticated
  using (public.is_admin_uid(auth.uid()));

drop policy if exists pickup_run_rsvps_admin_insert on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_insert
  on public.pickup_run_rsvps
  for insert
  to authenticated
  with check (public.is_admin_uid(auth.uid()));

drop policy if exists pickup_run_rsvps_admin_update on public.pickup_run_rsvps;
create policy pickup_run_rsvps_admin_update
  on public.pickup_run_rsvps
  for update
  to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));
