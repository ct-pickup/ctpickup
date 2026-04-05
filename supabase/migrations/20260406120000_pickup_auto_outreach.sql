-- Auto-managed pickup outreach / checkpoint pipeline
alter table public.pickup_runs
  add column if not exists outreach_started_at timestamptz,
  add column if not exists auto_managed boolean not null default false,
  add column if not exists auto_cp_24h_at timestamptz,
  add column if not exists auto_cp_12h_at timestamptz,
  add column if not exists auto_cp_6h_at timestamptz,
  add column if not exists auto_cp_1h_at timestamptz;

comment on column public.pickup_runs.outreach_started_at is 'When admin launch_outreach completed (Tier 1 SMS wave).';
comment on column public.pickup_runs.auto_managed is 'If true, cron/checkpoint processor may expand waves and finalize/cancel.';
comment on column public.pickup_runs.auto_cp_24h_at is 'Idempotency: 24h-before-start checkpoint ran at this time.';
comment on column public.pickup_runs.auto_cp_12h_at is 'Idempotency: 12h-before-start checkpoint ran at this time.';
comment on column public.pickup_runs.auto_cp_6h_at is 'Idempotency: 6h-before-start checkpoint ran at this time.';
comment on column public.pickup_runs.auto_cp_1h_at is 'Idempotency: 1h-before-start finalize/cancel ran at this time.';
