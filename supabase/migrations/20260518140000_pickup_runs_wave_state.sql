-- Wave outreach state for select pickup runs (see lib/pickup/waveInviteSystem.ts).

alter table public.pickup_runs
  add column if not exists wave_state jsonb null;

comment on column public.pickup_runs.wave_state is
  'Select run tier waves: wave1_sent_at..wave4_sent_at, w1_to_w2_hours, w2_to_w3_hours, hours_until_at_promote.';
