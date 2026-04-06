-- Sex/gender + playing position for onboarding + profile (single source of truth in app).
-- Idempotent and safe to re-run.

alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists gender_other text;
alter table public.profiles add column if not exists playing_position text;

comment on column public.profiles.gender is 'male | female | other (player provided).';
comment on column public.profiles.gender_other is 'Free-text when gender = other (optional; short).';
comment on column public.profiles.playing_position is 'Playing position (player provided).';

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'profiles' and c.conname = 'profiles_gender_check'
  ) then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('male', 'female', 'other'));
  end if;
end $$;

