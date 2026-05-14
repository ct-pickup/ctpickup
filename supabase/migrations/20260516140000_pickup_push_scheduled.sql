-- Deferred pickup push notifications (e.g. waitlist offer expiry reminder). Processed by Vercel cron (service role).

create table if not exists public.pickup_push_scheduled (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.pickup_runs (id) on delete cascade,
  send_at timestamptz not null,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists pickup_push_scheduled_due_idx
  on public.pickup_push_scheduled (send_at)
  where sent_at is null;

create index if not exists pickup_push_scheduled_user_run_kind_idx
  on public.pickup_push_scheduled (user_id, run_id, kind)
  where sent_at is null;

alter table public.pickup_push_scheduled enable row level security;

create policy "pickup_push_scheduled block anon"
  on public.pickup_push_scheduled
  for all
  to anon, authenticated
  using (false)
  with check (false);
