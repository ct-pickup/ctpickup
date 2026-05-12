-- Denormalized pickup win/loss counters updated server-side when a run result is posted.

alter table public.profiles add column if not exists pickup_wins_count integer not null default 0;
alter table public.profiles add column if not exists pickup_losses_count integer not null default 0;

update public.profiles set pickup_wins_count = coalesce(pickup_wins_count, 0);
update public.profiles set pickup_losses_count = coalesce(pickup_losses_count, 0);

comment on column public.profiles.pickup_wins_count is
  'Pickup wins from posted run results (server-maintained; see admin pickup result route).';
comment on column public.profiles.pickup_losses_count is
  'Pickup losses from posted run results (server-maintained).';
