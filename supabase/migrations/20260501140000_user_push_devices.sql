-- Push tokens for Expo / Apple (APNs). Writes go through Next.js API (service role); no client policies.
create table if not exists public.user_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists user_push_devices_user_id_idx on public.user_push_devices (user_id);

alter table public.user_push_devices enable row level security;

-- Block PostgREST access; server uses service role for upserts.
create policy "user_push_devices block anon"
  on public.user_push_devices
  for all
  to anon, authenticated
  using (false)
  with check (false);
