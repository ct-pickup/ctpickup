-- Lets a payer hold one cancellation credit per player spot on a run: their own spot and each friend's spot they
-- paid for. Additive only: existing rows keep credited_for_user_id null, which means the credit owner's own spot.
-- The wider index cannot fail on existing data because every row is already unique on (user_id, cancelled_run_id).

begin;

alter table public.pickup_credits
  add column if not exists credited_for_user_id uuid null references auth.users (id);

comment on column public.pickup_credits.credited_for_user_id is
  'Player whose spot this cancellation credit is for, when the credit owner paid for someone else. Null = the owner''s own spot.';

create unique index if not exists pickup_credits_user_cancelled_run_player_unique
  on public.pickup_credits (user_id, cancelled_run_id, coalesce(credited_for_user_id, user_id))
  where cancelled_run_id is not null;

drop index if exists public.pickup_credits_user_cancelled_run_unique;

commit;

-- Rollback (not run). Recreating the narrow index fails with a unique violation once any payer holds more than one
-- cancellation credit for the same run (e.g. their own spot plus a friend's). Check first:
--   select user_id, cancelled_run_id, count(*)
--   from public.pickup_credits
--   where cancelled_run_id is not null
--   group by user_id, cancelled_run_id
--   having count(*) > 1;
-- Those rows must be resolved by hand before rolling back.
--
-- begin;
-- create unique index if not exists pickup_credits_user_cancelled_run_unique
--   on public.pickup_credits (user_id, cancelled_run_id)
--   where cancelled_run_id is not null;
-- drop index if exists public.pickup_credits_user_cancelled_run_player_unique;
-- alter table public.pickup_credits drop column if exists credited_for_user_id;
-- commit;
