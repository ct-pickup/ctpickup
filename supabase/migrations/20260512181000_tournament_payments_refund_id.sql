alter table public.tournament_payments
  add column if not exists refund_id text null;
