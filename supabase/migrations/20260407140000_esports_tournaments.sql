-- Esports (digital) tournaments — public listing for upcoming/active only via RLS
create table if not exists public.esports_tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  game text not null,
  prize text not null,
  start_date timestamptz not null,
  end_date timestamptz not null,
  status text not null check (status in ('upcoming', 'active', 'completed')),
  description text,
  created_at timestamptz not null default now()
);

create index if not exists esports_tournaments_start_date_idx
  on public.esports_tournaments (start_date asc);

create index if not exists esports_tournaments_status_idx
  on public.esports_tournaments (status);

alter table public.esports_tournaments enable row level security;

-- Anonymous and logged-in users: read only rows shown on the public hub
create policy "esports_tournaments_select_public"
  on public.esports_tournaments
  for select
  to anon, authenticated
  using (status in ('upcoming', 'active'));

-- Inserts/updates/deletes go through service role (admin server actions), which bypasses RLS
