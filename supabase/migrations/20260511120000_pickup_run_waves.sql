-- Wave-based tier outreach scheduling (see /api/cron/pickup-waves).

alter table public.pickup_runs
  add column if not exists next_wave_at timestamptz null,
  add column if not exists current_wave integer null;

comment on column public.pickup_runs.next_wave_at is 'When the next tier wave opens (cron); null when no further waves.';
comment on column public.pickup_runs.current_wave is 'Outreach wave number: 1 after launch (tiers 1–2), then increments each cron-opened wave.';
