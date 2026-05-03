-- Manual override for pickup reliability (/100) set by staff.

alter table public.profiles
  add column if not exists pickup_reliability_override_score integer,
  add column if not exists pickup_reliability_override_reason text,
  add column if not exists pickup_reliability_override_updated_by uuid references auth.users (id) on delete set null,
  add column if not exists pickup_reliability_override_updated_at timestamptz;

-- Keep it sane: allow null (no override) or 0-100 inclusive.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_pickup_reliability_override_score_range'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_pickup_reliability_override_score_range
      check (pickup_reliability_override_score is null or (pickup_reliability_override_score >= 0 and pickup_reliability_override_score <= 100));
  end if;
exception
  when duplicate_object then null;
end $$;

comment on column public.profiles.pickup_reliability_override_score is 'Staff override for pickup reliability score (0-100). When set, it replaces computed score_pct.';
comment on column public.profiles.pickup_reliability_override_reason is 'Optional staff note explaining why an override is applied.';

