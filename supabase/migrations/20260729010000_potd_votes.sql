-- Attendee votes for Player of the Day (one vote per voter per run).

create table if not exists public.potd_votes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pickup_runs (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  nominee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (run_id, voter_id)
);

create index if not exists potd_votes_run_id_idx on public.potd_votes (run_id);
create index if not exists potd_votes_nominee_id_idx on public.potd_votes (nominee_id);

alter table public.potd_votes enable row level security;

drop policy if exists "attendees can vote" on public.potd_votes;
create policy "attendees can vote" on public.potd_votes
  for insert
  with check (auth.uid() = voter_id);

drop policy if exists "anyone can read" on public.potd_votes;
create policy "anyone can read" on public.potd_votes
  for select
  using (true);

comment on table public.potd_votes is
  'One Player of the Day ballot per attendee per pickup run. Winner resolved when host posts results.';
