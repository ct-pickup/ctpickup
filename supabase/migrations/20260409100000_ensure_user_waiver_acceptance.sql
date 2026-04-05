-- Idempotent: ensures waiver acceptance storage exists for /api/waiver/accept upserts.
-- PostgREST "Could not find the table ... in the schema cache" means DDL was not applied
-- to this database (run `supabase db push` / `supabase migration up` for the linked project).

create table if not exists public.user_waiver_acceptance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);

create index if not exists user_waiver_acceptance_user_id_idx
  on public.user_waiver_acceptance (user_id);

create index if not exists user_waiver_acceptance_version_idx
  on public.user_waiver_acceptance (version);

alter table public.user_waiver_acceptance enable row level security;

drop policy if exists "user_waiver_acceptance_insert_own" on public.user_waiver_acceptance;
create policy "user_waiver_acceptance_insert_own"
  on public.user_waiver_acceptance
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_waiver_acceptance_select_own" on public.user_waiver_acceptance;
create policy "user_waiver_acceptance_select_own"
  on public.user_waiver_acceptance
  for select
  to authenticated
  using (auth.uid() = user_id);
