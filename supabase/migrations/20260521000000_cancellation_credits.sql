-- Run cancellation credits: link free-run credits to the canceled pickup.

alter table public.pickup_credits
  drop constraint if exists pickup_credits_reason_check;

alter table public.pickup_credits
  add constraint pickup_credits_reason_check
    check (reason in ('referral', 'monthly_pod', 'monthly_attendance', 'cancellation'));

alter table public.pickup_credits
  add column if not exists cancelled_run_id uuid references public.pickup_runs (id) on delete set null;

create index if not exists pickup_credits_cancelled_run_id_idx
  on public.pickup_credits (cancelled_run_id)
  where cancelled_run_id is not null;

create unique index if not exists pickup_credits_user_cancelled_run_unique
  on public.pickup_credits (user_id, cancelled_run_id)
  where cancelled_run_id is not null;

comment on column public.pickup_credits.cancelled_run_id is
  'When set, this credit was issued because the referenced pickup run was canceled.';
