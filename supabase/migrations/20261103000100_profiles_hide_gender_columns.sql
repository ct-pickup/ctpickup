-- ============================================================
-- CT Pickup: other signed-in users can no longer read profiles.sex, profiles.gender or profiles.gender_other
--
-- NOT APPLIED ANYWHERE. READ THE WARNINGS BEFORE RUNNING IT. It changes who may read a column, which needs matching app changes first.
--
-- ROLLBACK (run manually if needed; gives signed-in users back table-wide SELECT as Supabase grants it by default):
--
--   begin;
--   grant select on public.profiles to authenticated;
--   drop view if exists public.my_profile_identity;
--   commit;
--   notify pgrst, 'reload schema';
--
-- Why this is column level and not a policy
--   Row level security decides which ROWS a role sees, never which columns. Today the policy "profiles_select_approved_directory" lets any
--   signed-in user read every approved row, and the table-wide SELECT grant makes every column readable, sex and gender included. The only
--   way to hide three columns from other users is to take them out of the SELECT privilege that signed-in users hold.
--
-- What this does
--   1. For the roles anon and authenticated that can read profiles at all today: removes the table-wide SELECT and grants SELECT on every
--      column EXCEPT sex, gender and gender_other. The column list is built from information_schema at run time, so it works on a DEV
--      that is behind or ahead, and running it again re-grants the same list (and picks up columns added since).
--   2. Creates the view public.my_profile_identity (user_id, sex, gender, gender_other) that returns ONLY the signed-in player's own row
--      (id = auth.uid()). It is how an owner reads their own values once the columns are closed. It reads through to_jsonb, so it also
--      works if one of the columns does not exist on this database.
--   3. The service role keeps full access (it was not touched), so every API route that uses it behaves as before. INSERT and UPDATE
--      privileges are not touched: owners can still write their own sex and gender with the existing own-row update policy.
--
-- WARNINGS (see the report that came with this file)
--   * A direct read of those columns by a signed-in client now fails with "permission denied", for the owner too. The owner reads them from
--     public.my_profile_identity instead. The web profile page and lib/profileLoad.ts select sex, gender and gender_other from profiles
--     for the owner: they MUST be changed to read the view BEFORE this runs, or the web profile and the header menu stop loading.
--   * select * on profiles (or ?select=* over the API) now fails for signed-in users, because it includes columns they may not read.
--   * Any column added to profiles later is not readable by signed-in users until someone grants it:
--       grant select (new_column) on public.profiles to authenticated;
--     Re-running this file also does it for every current column.
--   * PostgREST caches the schema: the notify at the end reloads it.
-- ============================================================

begin;

do $$
declare
  cols text;
  r    text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'profiles'
     and column_name not in ('sex', 'gender', 'gender_other');

  if cols is null then
    raise exception 'public.profiles has no readable columns to grant';
  end if;

  foreach r in array array['anon', 'authenticated'] loop
    -- Only touch a role that can read profiles at all today; never give a role access it did not have.
    if has_any_column_privilege(r, 'public.profiles', 'select') then
      execute format('revoke select on public.profiles from %I', r);
      execute format('grant select (%s) on public.profiles to %I', cols, r);
    end if;
  end loop;
end;
$$;

-- The owner's own values only. SECURITY DEFINER view (owner reads the table), filtered by the caller's auth.uid().
create or replace view public.my_profile_identity
  with (security_invoker = false) as
  select p.id as user_id,
         to_jsonb(p) ->> 'sex'          as sex,
         to_jsonb(p) ->> 'gender'       as gender,
         to_jsonb(p) ->> 'gender_other' as gender_other
    from public.profiles p
   where p.id = auth.uid();

comment on view public.my_profile_identity is
  'The signed-in player''s own sex, gender and gender_other. One row at most (id = auth.uid()); nobody else''s values are ever returned.';

revoke all on table public.my_profile_identity from public, anon, authenticated;
grant select on table public.my_profile_identity to authenticated;
grant select on table public.my_profile_identity to service_role;

commit;

notify pgrst, 'reload schema';
