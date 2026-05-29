-- Prize pool and payout tracking for captain tournaments.
-- prize_pool_cents is computed at query time from tournament_payments (status = 'captured'),
-- so no stored column is needed here.

alter table public.tournaments
  add column if not exists early_termination boolean not null default false;

alter table public.tournaments
  add column if not exists prizes_paid_at timestamptz null;

alter table public.tournaments
  add column if not exists prizes_paid_by uuid null references auth.users(id);

comment on column public.tournaments.early_termination is 'When true, prize split is 60/25/15 instead of 100% to winner.';
comment on column public.tournaments.prizes_paid_at is 'Timestamp when admin marked prizes as paid (cash payout).';
comment on column public.tournaments.prizes_paid_by is 'Admin user who recorded the prizes-paid action.';
