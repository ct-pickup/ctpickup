-- Auth signup runs `handle_new_user_profile` immediately after `auth.users` insert.
-- Listing `has_seen_dashboard_home` in the INSERT target fails on databases that never
-- received `20260408130000_profiles_has_seen_dashboard_home.sql`, producing the generic
-- Supabase client error: "Database error saving new user".
-- Omit that column here and rely on the column default (false) when present.

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
