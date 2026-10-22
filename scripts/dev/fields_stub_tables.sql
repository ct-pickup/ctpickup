-- DEV ONLY. Not a migration. Never run this on production.
--
-- The smallest set of stand-in tables so the five fields migrations (20261012* and 20261013*) can be applied to an EMPTY
-- Supabase project, to test the Fields feature alone. The real app tables (profiles, pickup_runs, tournaments ...) are not
-- here: with only these stubs, the rest of the mobile app will not work against this database.
--
-- Run this FIRST, then the fields migrations in filename order, then scripts/dev/fields_sample_venues.sql and
-- scripts/dev/fields_sample_schedule.sql.
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/dev/fields_stub_tables.sql

begin;

-- What the fields migrations and API routes read from profiles.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  is_admin   boolean not null default false,
  approved   boolean not null default true,
  first_name text,
  last_name  text,
  username   text
);

-- Same definition as 20260503193000_chat_room_controls.sql. The fields RLS policies call it.
create or replace function public.is_admin_uid(p_uid uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_uid
      and p.is_admin = true
  );
$$;

commit;

-- After you sign up in the dev project, make yourself an admin and add your profile row:
--   insert into public.profiles (id, is_admin, first_name) values ('<your auth.users id>', true, 'You')
--   on conflict (id) do update set is_admin = true;
