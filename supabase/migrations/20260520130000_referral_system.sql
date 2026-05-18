-- Referral codes, credits, events, and milestone rewards (1 credit per 10 referrals).

alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists referred_by text,
  add column if not exists referral_credits integer not null default 0;

create unique index if not exists profiles_referral_code_unique
  on public.profiles (referral_code)
  where referral_code is not null;

create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by)
  where referred_by is not null;

alter table public.profiles
  drop constraint if exists profiles_referral_credits_non_negative;

alter table public.profiles
  add constraint profiles_referral_credits_non_negative
  check (referral_credits >= 0);

create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint referral_events_unique_pair unique (referrer_user_id, referred_user_id),
  constraint referral_events_no_self_referral check (referrer_user_id <> referred_user_id)
);

create index if not exists referral_events_referrer_idx
  on public.referral_events (referrer_user_id, created_at desc);

create or replace function public.generate_profile_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  attempts int := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.profiles p where p.referral_code = candidate
    );
    attempts := attempts + 1;
    if attempts > 200 then
      raise exception 'Could not allocate unique referral_code';
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.ensure_profile_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing text;
  fresh text;
begin
  select referral_code into existing
  from public.profiles
  where id = p_user_id
  for update;

  if existing is not null and btrim(existing) <> '' then
    return existing;
  end if;

  fresh := public.generate_profile_referral_code();
  update public.profiles
  set referral_code = fresh,
      updated_at = now()
  where id = p_user_id;
  return fresh;
end;
$$;

create or replace function public.process_profile_referral(p_referred_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred_by text;
  v_referrer_id uuid;
  v_event_count bigint;
begin
  select referred_by into v_referred_by
  from public.profiles
  where id = p_referred_user_id;

  if v_referred_by is null or btrim(v_referred_by) = '' then
    return;
  end if;

  if exists (
    select 1
    from public.referral_events re
    where re.referred_user_id = p_referred_user_id
  ) then
    return;
  end if;

  select id into v_referrer_id
  from public.profiles
  where referral_code = upper(btrim(v_referred_by))
  limit 1;

  if v_referrer_id is null then
    return;
  end if;

  if v_referrer_id = p_referred_user_id then
    return;
  end if;

  insert into public.referral_events (referrer_user_id, referred_user_id)
  values (v_referrer_id, p_referred_user_id);

  select count(*)::bigint into v_event_count
  from public.referral_events
  where referrer_user_id = v_referrer_id;

  if v_event_count > 0 and mod(v_event_count, 10) = 0 then
    update public.profiles
    set referral_credits = referral_credits + 1,
        updated_at = now()
    where id = v_referrer_id;
  end if;
end;
$$;

create or replace function public.trg_profiles_process_referral()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.referred_by is not null and btrim(new.referred_by) <> '' then
      perform public.process_profile_referral(new.id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.referred_by is null or btrim(old.referred_by) = '')
       and new.referred_by is not null
       and btrim(new.referred_by) <> '' then
      perform public.process_profile_referral(new.id);
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_process_referral on public.profiles;
create trigger profiles_process_referral
  after insert or update of referred_by on public.profiles
  for each row
  execute function public.trg_profiles_process_referral();

-- Backfill referral codes for existing profiles.
do $$
declare
  r record;
begin
  for r in
    select id from public.profiles where referral_code is null or btrim(referral_code) = ''
  loop
    perform public.ensure_profile_referral_code(r.id);
  end loop;
end;
$$;

-- Assign codes on new profile rows (handle_new_user_profile runs before this column existed).
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_code text;
begin
  v_referral_code := public.generate_profile_referral_code();

  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    phone,
    instagram,
    avatar_url,
    referral_code,
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
    v_referral_code,
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
        referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
        updated_at = now();
  return new;
end;
$$;

create or replace function public.consume_referral_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.profiles
  set referral_credits = referral_credits - 1,
      updated_at = now()
  where id = p_user_id
    and referral_credits > 0;

  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;
