-- Wave schedule columns on pickup_runs may exist in Postgres before PostgREST reloads its
-- schema cache. These RPCs read/write via SQL so hub promote and wave cron keep working.

create or replace function public.get_pickup_run_wave_schedule(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'next_wave_at', r.next_wave_at,
    'wave_state', r.wave_state,
    'current_wave', r.current_wave,
    'outreach_started_at', r.outreach_started_at
  )
  from public.pickup_runs r
  where r.id = p_run_id;
$$;

create or replace function public.update_pickup_run_wave_schedule(
  p_run_id uuid,
  p_updated_at timestamptz,
  p_open_tier_rank integer,
  p_current_wave integer,
  p_next_wave_at timestamptz,
  p_wave_state jsonb,
  p_outreach_started_at timestamptz default null,
  p_wave1_started_at timestamptz default null,
  p_auto_managed boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pickup_runs
  set
    updated_at = p_updated_at,
    open_tier_rank = p_open_tier_rank,
    current_wave = p_current_wave,
    next_wave_at = p_next_wave_at,
    wave_state = p_wave_state,
    outreach_started_at = coalesce(p_outreach_started_at, outreach_started_at),
    wave1_started_at = coalesce(p_wave1_started_at, wave1_started_at),
    auto_managed = coalesce(p_auto_managed, auto_managed)
  where id = p_run_id;

  if not found then
    raise exception 'pickup run not found: %', p_run_id;
  end if;
end;
$$;

revoke all on function public.get_pickup_run_wave_schedule(uuid) from public;
revoke all on function public.update_pickup_run_wave_schedule(
  uuid, timestamptz, integer, integer, timestamptz, jsonb, timestamptz, timestamptz, boolean
) from public;

grant execute on function public.get_pickup_run_wave_schedule(uuid) to service_role;
grant execute on function public.update_pickup_run_wave_schedule(
  uuid, timestamptz, integer, integer, timestamptz, jsonb, timestamptz, timestamptz, boolean
) to service_role;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end $$;
