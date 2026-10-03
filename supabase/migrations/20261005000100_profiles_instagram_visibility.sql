-- ============================================================
-- CT Pickup — Instagram verification (2 of 3): profiles columns
--
-- WARNING: approving 'instagram' unlocks stars above 3.0 and the
-- platinum/diamond tiers; see 20261005000000_verification_level_instagram.sql.
--
--   * show_instagram: "Show Instagram on my profile", default off.
--   * instagram_handle: the verified handle, set by the API only while
--     show_instagram is on (approved players can read each other's
--     profiles rows, so the handle is not kept here while hidden). The
--     canonical handle is in instagram_verification_requests.
--   * profiles.verification_level is not created by any migration in this
--     repo. If it is text with a check constraint rather than the
--     verification_level enum, the check is widened to allow 'instagram'.
--   * profiles_guard_verification: signed-in clients (PostgREST role
--     authenticated/anon) can update their own profiles row, so they could
--     otherwise set verification_level, show_instagram or instagram_handle
--     themselves. Those three columns are now server-only (service role,
--     SQL editor); client writes to them are ignored. Leaving 'instagram'
--     clears the public handle.
-- ============================================================

begin;

alter table public.profiles
  add column if not exists show_instagram boolean not null default false,
  add column if not exists instagram_handle text;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_instagram_handle_format'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_instagram_handle_format
      check (instagram_handle is null or instagram_handle ~ '^[a-z0-9._]{1,30}$');
  end if;
end;
$constraint$;

do $widen$
declare
  col_type text;
  udt      text;
  c        record;
begin
  select data_type, udt_name into col_type, udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'verification_level';
  if col_type is null then
    raise exception 'profiles.verification_level does not exist';
  end if;

  if col_type = 'USER-DEFINED' and udt <> 'verification_level' then
    execute format('alter type public.%I add value if not exists %L', udt, 'instagram');
  elsif col_type in ('text', 'character varying') then
    for c in
      select con.conname, pg_get_expr(con.conbin, con.conrelid) as expr
        from pg_constraint con
       where con.conrelid = 'public.profiles'::regclass
         and con.contype = 'c'
         and pg_get_expr(con.conbin, con.conrelid) ilike '%verification_level%'
         and pg_get_expr(con.conbin, con.conrelid) not ilike '%instagram%'
    loop
      execute format('alter table public.profiles drop constraint %I', c.conname);
      execute format(
        'alter table public.profiles add constraint %I check ((%s) or verification_level = %L)',
        c.conname, c.expr, 'instagram'
      );
    end loop;
  end if;
end;
$widen$;

create or replace function public.profiles_guard_verification()
returns trigger
language plpgsql set search_path = public as $body$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.verification_level := 'self';
      new.show_instagram     := false;
      new.instagram_handle   := null;
    else
      new.verification_level := old.verification_level;
      new.show_instagram     := old.show_instagram;
      new.instagram_handle   := old.instagram_handle;
    end if;
  end if;

  if new.verification_level::text is distinct from 'instagram' then
    new.show_instagram   := false;
    new.instagram_handle := null;
  end if;
  return new;
end;
$body$;

drop trigger if exists profiles_guard_verification on public.profiles;
create trigger profiles_guard_verification
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_verification();

revoke execute on function public.profiles_guard_verification() from public, anon, authenticated;

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop trigger if exists profiles_guard_verification on public.profiles;
-- drop function if exists public.profiles_guard_verification();
-- alter table public.profiles drop constraint if exists profiles_instagram_handle_format;
-- alter table public.profiles drop column if exists instagram_handle;
-- alter table public.profiles drop column if exists show_instagram;
-- commit;
-- ============================================================
