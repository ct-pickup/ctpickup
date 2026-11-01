-- ============================================================
-- CT Pickup: the view my_profile_identity (additive only; creates ONLY the view)
--
-- NOT APPLIED ANYWHERE. Apply it BEFORE any migration that closes profiles.sex / gender / gender_other to other users.
--
-- ROLLBACK (run manually if needed):
--
--   begin;
--   drop view if exists public.my_profile_identity;
--   commit;
--   notify pgrst, 'reload schema';
--
-- What this adds
--   * public.my_profile_identity (user_id, sex, gender, gender_other): the signed-in player's OWN values, one row at most (id = auth.uid()).
--     Nobody else's values are ever returned. The app reads the owner's sex and gender from here instead of from `profiles`.
--   * It is a SECURITY DEFINER view (security_invoker = false): the view owner reads profiles, and the WHERE clause limits the result to the
--     caller. It reads through to_jsonb, so it also works on a database where one of the three columns does not exist yet.
--   * Select is granted to authenticated and service_role only. This file changes nothing else: no column privilege, no policy, no data.
--
-- Safe to run twice. Same definition as in 20261103000100_profiles_hide_gender_columns.sql (on feat/womens-leaderboard), which recreates it
-- harmlessly with CREATE OR REPLACE.
-- ============================================================

begin;

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
