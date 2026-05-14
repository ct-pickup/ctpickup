-- Player follow graph: followers see activity and receive pickup join notifications.

create table if not exists public.player_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  constraint player_follows_no_self check (follower_id <> following_id)
);

create index if not exists player_follows_follower_idx on public.player_follows (follower_id);
create index if not exists player_follows_following_idx on public.player_follows (following_id);

comment on table public.player_follows is
  'Directed edges: follower_id follows following_id. Mobile may read all rows; writes are own-follower rows only.';

alter table public.player_follows enable row level security;

drop policy if exists "Users can manage own follows" on public.player_follows;
create policy "Users can manage own follows"
  on public.player_follows
  for all
  to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

drop policy if exists "Users can read all follows" on public.player_follows;
create policy "Users can read all follows"
  on public.player_follows
  for select
  to authenticated
  using (true);
