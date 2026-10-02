-- A run can have a day but no kickoff time yet. Additive; existing rows default to false.
alter table public.pickup_runs add column if not exists time_tbd boolean not null default false;

comment on column public.pickup_runs.time_tbd is
  'True when the run has a date but no kickoff time yet. start_at then holds noon America/New_York on that date; apps show the Eastern date with "Time TBD". Setting a real time sets this back to false.';
