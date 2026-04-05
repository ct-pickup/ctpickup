-- Canonical `profiles` shape for CT Pickup (signup, profile UI, pickup, admin).
-- Idempotent: safe to re-run on existing databases. Pure SQL only.

-- Ensure base table exists (older projects may have created it outside migrations).
create table if not exists public.profiles (
  id uuid not null,
  constraint profiles_pkey primary key (id)
);

-- FK to auth when possible (skip if already present with a different name).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
exception
  when duplicate_object then null;
end $$;

-- Identity & contact (signup + profile)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists instagram text;
alter table public.profiles add column if not exists avatar_url text;

-- Pickup / ops
alter table public.profiles add column if not exists tier text;
alter table public.profiles add column if not exists tier_rank integer;
alter table public.profiles add column if not exists approved boolean;
alter table public.profiles add column if not exists is_admin boolean;
alter table public.profiles add column if not exists confirmed_count integer;
alter table public.profiles add column if not exists attended_count integer;
alter table public.profiles add column if not exists strike_count integer;

-- Timestamps
alter table public.profiles add column if not exists created_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz;

-- Backfill then tighten constraints
update public.profiles set tier_rank = 6 where tier_rank is null;
update public.profiles set approved = coalesce(approved, false);
update public.profiles set is_admin = coalesce(is_admin, false);
update public.profiles set confirmed_count = coalesce(confirmed_count, 0);
update public.profiles set attended_count = coalesce(attended_count, 0);
update public.profiles set strike_count = coalesce(strike_count, 0);
update public.profiles set created_at = coalesce(created_at, now());
update public.profiles set updated_at = coalesce(updated_at, now());

alter table public.profiles alter column tier_rank set default 6;
alter table public.profiles alter column tier_rank set not null;

alter table public.profiles alter column approved set default false;
alter table public.profiles alter column approved set not null;

alter table public.profiles alter column is_admin set default false;
alter table public.profiles alter column is_admin set not null;

alter table public.profiles alter column confirmed_count set default 0;
alter table public.profiles alter column confirmed_count set not null;

alter table public.profiles alter column attended_count set default 0;
alter table public.profiles alter column attended_count set not null;

alter table public.profiles alter column strike_count set default 0;
alter table public.profiles alter column strike_count set not null;

alter table public.profiles alter column created_at set default now();
alter table public.profiles alter column created_at set not null;

alter table public.profiles alter column updated_at set default now();
alter table public.profiles alter column updated_at set not null;

comment on table public.profiles is 'App profile per auth user; id = auth.users.id.';
comment on column public.profiles.email is 'Mirror of signup email; keep in sync with auth (app upserts on signup; optional DB trigger).';
comment on column public.profiles.tier_rank is 'Pickup ordering: 1A=1, 1B=2, 2=3, 3=4, 4=5, PUBLIC=6.';
comment on column public.profiles.avatar_url is 'Public Storage URL (avatars bucket).';

-- Backfill email from auth for existing profile rows
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and u.email is not null
  and (p.email is null or p.email is distinct from u.email);

-- Optional: seed row + email when a user is created in auth (Supabase-compatible).
-- Safe with client upserts: uses ON CONFLICT DO UPDATE.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, created_at, updated_at)
  values (new.id, new.email, now(), now())
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profiles on auth.users;
create trigger on_auth_user_created_profiles
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user_profile();

create or replace function public.handle_auth_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
      set email = new.email,
          updated_at = now()
      where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated_email_profiles on auth.users;
create trigger on_auth_user_updated_email_profiles
  after update of email on auth.users
  for each row
  execute procedure public.handle_auth_user_email_updated();
