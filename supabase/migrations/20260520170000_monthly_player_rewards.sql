-- Monthly player rewards: pickup_credits (POD, attendance, referral free runs / discounts).

create table if not exists public.pickup_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer,
  discount_pct integer,
  reason text not null
    constraint pickup_credits_reason_check
      check (reason in ('referral', 'monthly_pod', 'monthly_attendance')),
  awarded_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  run_id uuid references public.pickup_runs (id) on delete set null
);

create index if not exists pickup_credits_user_id_idx
  on public.pickup_credits (user_id);

create index if not exists pickup_credits_expires_at_idx
  on public.pickup_credits (expires_at);

create index if not exists pickup_credits_used_at_idx
  on public.pickup_credits (used_at);

create index if not exists pickup_credits_user_active_idx
  on public.pickup_credits (user_id, expires_at)
  where used_at is null;

comment on table public.pickup_credits is
  'Pickup fee credits: free runs (amount_cents null) or percent discounts.';

alter table public.pickup_credits enable row level security;

drop policy if exists pickup_credits_select_own on public.pickup_credits;
create policy pickup_credits_select_own
  on public.pickup_credits
  for select
  to authenticated
  using (user_id = auth.uid());

-- Referral milestone: insert pickup_credits instead of incrementing profiles.referral_credits.
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
    insert into public.pickup_credits (
      user_id,
      amount_cents,
      discount_pct,
      reason,
      expires_at
    )
    values (
      v_referrer_id,
      null,
      null,
      'referral',
      now() + interval '3 months'
    );
  end if;
end;
$$;
