-- Player development / guidance requests (experience-based, not licensed consulting)
create table if not exists public.guidance_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  plan text not null check (plan in ('foundation', 'development', 'elite')),
  message text not null check (char_length(message) <= 5000 and char_length(message) >= 1),
  status text not null default 'pending' check (status in ('pending', 'assigned', 'completed')),
  created_at timestamptz not null default now()
);

create index if not exists guidance_requests_user_id_idx on public.guidance_requests (user_id);
create index if not exists guidance_requests_created_at_idx on public.guidance_requests (created_at desc);

alter table public.guidance_requests enable row level security;

create policy "guidance_requests_insert_own"
  on public.guidance_requests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "guidance_requests_select_own"
  on public.guidance_requests
  for select
  to authenticated
  using (auth.uid() = user_id);
