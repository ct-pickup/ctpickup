-- Distinct sex vs gender (signup + profile) and public username (unique, case-insensitive).

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

-- Existing rows used `gender` for the combined "sex / gender" prompt; copy into `sex` when missing.
update public.profiles
set sex = gender
where sex is null
  and gender is not null;

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(btrim(username)))
  where username is not null
    and btrim(username) <> '';
