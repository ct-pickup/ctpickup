create extension if not exists pgcrypto;

create table if not exists public.tournament_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  auth_email text,
  full_name text not null,
  page text not null default '/tournament',
  consent_version text not null default 'tournament_rules_v1',
  agreed boolean not null default true,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists tournament_consents_created_at_idx
  on public.tournament_consents (created_at desc);

create index if not exists tournament_consents_user_id_idx
  on public.tournament_consents (user_id);
