create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, approved boolean default false, is_admin boolean default false, first_name text, last_name text, username text);
create table if not exists public.pickup_runs (id uuid primary key default gen_random_uuid(), title text, location_text text, start_at timestamptz, capacity int, status text default 'open', created_by uuid references public.profiles(id), tier_session_id uuid);
create table if not exists public.pickup_run_rsvps (run_id uuid references public.pickup_runs(id) on delete cascade, user_id uuid, status text, primary key (run_id, user_id));
create or replace function public.is_admin_uid(u uuid) returns boolean language sql stable as $$ select coalesce((select is_admin from public.profiles where id=u), false) $$;
