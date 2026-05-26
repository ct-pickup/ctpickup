-- Store dollar amounts for "free run" pickup credits so clients can display "$15 credit"
-- and checkout can support partial coverage (credit + Stripe remainder).

-- Update the referral milestone award to issue a fixed $15 credit (1500 cents).
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
      1500,
      null,
      'referral',
      now() + interval '3 months'
    );
  end if;
end;
$$;

comment on table public.pickup_credits is
  'Pickup fee credits: dollar credits (amount_cents) or percent discounts (discount_pct).';

