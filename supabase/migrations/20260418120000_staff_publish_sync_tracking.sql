-- Staff publish + sync tracking layer.
-- This is an idempotent safety migration for environments that were created
-- before `20260410120000_admin_publish_sync.sql` was applied.
--
-- What it provides (expected by the staff admin UI / automation):
-- - admin_publications: persisted publish messages (with optional idempotency key).
-- - admin_publication_deliveries: per-destination delivery tracking + last_error.
-- - admin_sync_jobs: background revalidation / retry jobs.
-- - admin_surface_health: per-surface last attempt + status.
-- - admin_audit_log: staff actions audit trail.
-- - tournaments.staff_announcement (+ _at): tournament hub announcement support.

do $$
begin
  -- Optional: tournament announcement fields (only if tournaments exists).
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'tournaments'
  ) then
    alter table public.tournaments add column if not exists staff_announcement text;
    alter table public.tournaments add column if not exists staff_announcement_at timestamptz;
  end if;
end $$;

create table if not exists public.admin_publications (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_by uuid references auth.users (id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint admin_publications_idempotency_key_unique unique (idempotency_key)
);

create index if not exists admin_publications_created_at_idx
  on public.admin_publications (created_at desc);

create table if not exists public.admin_publication_deliveries (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.admin_publications (id) on delete cascade,
  channel text not null check (channel in ('site_status', 'pickup_global', 'pickup_run', 'tournament_active')),
  entity_id uuid,
  sink_table text not null,
  sink_row_id uuid,
  sync_state text not null default 'synced' check (sync_state in ('pending', 'synced', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_publication_deliveries_pub_channel_entity_idx
  on public.admin_publication_deliveries (publication_id, channel, (coalesce(entity_id::text, '')));

create index if not exists admin_publication_deliveries_sync_state_idx
  on public.admin_publication_deliveries (sync_state)
  where sync_state <> 'synced';

create table if not exists public.admin_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('revalidate', 'retry_delivery')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 8,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_sync_jobs_status_created_idx
  on public.admin_sync_jobs (status, created_at desc);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create table if not exists public.admin_surface_health (
  surface_key text primary key,
  label text,
  sync_state text not null default 'synced' check (sync_state in ('synced', 'pending', 'failed')),
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.admin_publications enable row level security;
alter table public.admin_publication_deliveries enable row level security;
alter table public.admin_sync_jobs enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.admin_surface_health enable row level security;

-- Supabase/PostgREST schema cache refresh (harmless if PostgREST isn't present).
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    -- Ignore if pg_notify isn't permitted in this environment.
    null;
end $$;

