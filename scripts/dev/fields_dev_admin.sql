-- DEV ONLY. Not a migration. Never run this on production.
--
-- Makes one dev auth user an admin who can get past the app's sign-in gates against the stub database:
--   * a public.profiles row with is_admin, approved and a first and last name (the profile gate)
--   * a user_waiver_acceptance row for the current waiver version (the waiver gate)
--
-- Needs: scripts/dev/fields_stub_tables.sql applied, the migration 20260407160000_user_waiver_acceptance.sql applied, and the
-- user already created (Dashboard > Authentication > Users). Safe to run more than once.
--
--   psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -v email='you@example.com' -f scripts/dev/fields_dev_admin.sql
--
-- In the Dashboard SQL editor, psql variables do not work: copy the statements below and replace :'email' with 'you@example.com'.
-- The waiver version must match CURRENT_WAIVER_VERSION in lib/waiver/constants.ts (v1.6 when this was written).

begin;

insert into public.profiles (id, is_admin, approved, first_name, last_name, username)
select u.id, true, true, 'Dev', 'Admin', 'devadmin'
from auth.users u
where lower(u.email) = lower(:'email')
on conflict (id) do update set
  is_admin = true,
  approved = true,
  first_name = coalesce(nullif(public.profiles.first_name, ''), 'Dev'),
  last_name = coalesce(nullif(public.profiles.last_name, ''), 'Admin');

insert into public.user_waiver_acceptance (user_id, version)
select u.id, 'v1.6'
from auth.users u
where lower(u.email) = lower(:'email')
on conflict (user_id, version) do nothing;

-- Should print one row. Zero rows means that email has no auth user yet.
select p.id, p.is_admin, p.approved, p.first_name, p.last_name
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower(:'email');

commit;
