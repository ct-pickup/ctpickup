-- Promoted "live" run for pickup hub (/api/pickup/public, admin tools).
-- Distinct from status (planning | likely_on | active), which controls RSVP and availability rules.
alter table public.pickup_runs
  add column if not exists is_current boolean not null default false;

create index if not exists idx_pickup_runs_is_current
  on public.pickup_runs (is_current)
  where is_current = true;
