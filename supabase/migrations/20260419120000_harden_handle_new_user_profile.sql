-- Strengthen new-user signup: the auth.users trigger must populate every NOT NULL column on
-- `profiles`. Relying on column defaults alone can fail in edge cases (schema drift, partial
-- deploys), which surfaces to clients as the generic "Database error saving new user".

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
    has_seen_dashboard_home,
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
    false,
    now(),
    now()
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();
  return new;
end;
$$;
