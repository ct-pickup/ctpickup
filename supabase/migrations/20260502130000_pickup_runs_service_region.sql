-- Regional featured runs: mobile + /api/pickup/public?region=CT filter on this column.
-- Null keeps legacy single-hub behavior when no region is requested.

alter table public.pickup_runs
  add column if not exists service_region text;

comment on column public.pickup_runs.service_region is 'USPS state hub (NY, CT, NJ, MD). Null = legacy / not scoped to a state.';

alter table public.pickup_runs
  drop constraint if exists pickup_runs_service_region_check;

do $$
begin
  alter table public.pickup_runs
    add constraint pickup_runs_service_region_check
    check (service_region is null or service_region in ('NY', 'CT', 'NJ', 'MD'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_pickup_runs_service_region_current
  on public.pickup_runs (service_region, is_current)
  where is_current = true;
