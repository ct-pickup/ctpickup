-- Idempotent repair: some environments never applied `20260420120000_profiles_sex_username.sql`,
-- which yields Postgres errors like `column profiles.sex does not exist` when the app upserts
-- or selects `sex` / `username`. `handle_new_user_profile` does not reference these columns;
-- this migration only aligns `public.profiles` with the intended schema.

alter table public.profiles add column if not exists sex text;
alter table public.profiles add column if not exists username text;

comment on column public.profiles.sex is 'male | female | other — player-provided (distinct from gender when both collected).';
comment on column public.profiles.username is 'Public handle; stored trimmed; uniqueness enforced case-insensitively.';

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'profiles' and c.conname = 'profiles_sex_check'
  ) then
    alter table public.profiles
      add constraint profiles_sex_check
      check (sex is null or sex in ('male', 'female', 'other'));
  end if;
end $$;

update public.profiles
set sex = gender
where sex is null
  and gender is not null;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(btrim(username)))
  where username is not null
    and btrim(username) <> '';
