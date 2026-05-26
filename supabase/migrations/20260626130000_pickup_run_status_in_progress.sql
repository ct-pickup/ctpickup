-- "Begin Pickup Now" sets status to in_progress (and locked_at). The app lifecycle
-- distinguishes confirmed (active) from live (in_progress); the enum was missing this value.

do $$
begin
  if exists (
    select 1
    from pg_type
    where typname = 'pickup_run_status'
      and typnamespace = 'public'::regnamespace
  ) then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on e.enumtypid = t.oid
      where t.typname = 'pickup_run_status'
        and t.typnamespace = 'public'::regnamespace
        and e.enumlabel = 'in_progress'
    ) then
      alter type public.pickup_run_status add value 'in_progress';
    end if;
  end if;
end
$$;
