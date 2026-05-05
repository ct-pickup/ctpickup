-- Planning availability: allow one row per (run, user, time slot) so players can select multiple windows.
-- Drops legacy uniqueness on (run_id, user_id) if present (name may vary by environment).

alter table public.pickup_run_availability
  drop constraint if exists pickup_run_availability_run_id_user_id_key;

alter table public.pickup_run_availability
  drop constraint if exists pickup_run_availability_user_id_run_id_key;

create unique index if not exists pickup_run_availability_run_user_slot_uidx
  on public.pickup_run_availability (run_id, user_id, slot_id)
  where slot_id is not null;
