-- Production may enforce NOT NULL on identity/contact text columns that repo migrations leave
-- nullable (e.g. `instagram`). `handle_new_user_profile` must supply values for each.
-- Use empty strings for unconstrained text fields; signup/profile upsert replaces them.
-- Do not set sex/gender/esports_* here — CHECK constraints require null or allowed enum values.

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
    phone,
    instagram,
    avatar_url,
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
    '',
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
