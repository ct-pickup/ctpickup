-- `handle_new_user_profile` must satisfy every NOT NULL column on `public.profiles`.
-- Repo migrations require: tier_rank, approved, is_admin, confirmed/attended/strike counts,
-- created_at, updated_at; `has_seen_dashboard_home` is NOT NULL with default false when present.
-- Some deployments also enforce NOT NULL on first_name / last_name; omitting them fails signup
-- with: null value in column "first_name" of relation "profiles" violates not-null constraint.
-- Empty strings are placeholders until the client signup/profile upsert sets real values.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    tier_rank,
    approved,
    is_admin,
    confirmed_count,
    attended_count,
    strike_count,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    '',
    '',
    6,
    false,
    false,
    0,
    0,
    0,
    now(),
    now()
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();
  return new;
end;
$$;
