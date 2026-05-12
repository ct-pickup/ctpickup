-- Add `locked_at` to pickup_runs so we can record when a run is locked from
-- new RSVPs (set when an admin taps "Begin Pickup Now"). The server checks
-- this column (and `status = 'in_progress'`) before accepting new joins.

alter table public.pickup_runs
  add column if not exists locked_at timestamptz;

comment on column public.pickup_runs.locked_at is
  'When set, no new RSVPs are accepted for this run (admin began the pickup). Returns "This run has already started." to the client.';

create index if not exists idx_pickup_runs_locked_at
  on public.pickup_runs (locked_at)
  where locked_at is not null;
