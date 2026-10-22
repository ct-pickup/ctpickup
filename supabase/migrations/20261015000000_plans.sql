-- Fields paid plans, step 1 (Stripe TEST mode, dev only).
-- Additive. Depends on 20261012000100_fields_requests_events_slots.sql (venue_requests) and is_admin_uid().
--
--   * plan_catalog: the three plans (Scout, Email, Concierge). Readable by signed-in users.
--   * plan_subscriptions: one row per Stripe subscription. Written only by the server (the Stripe webhook).
--   * plan_request_usage: requests used per billing period, plus whether the one free request has been used (it is
--     once per player, ever). Written only by the server.
--   * plan_status(user) / my_plan_status(): a user's plan, requests left this period, and whether the free request is used.
--   * record_plan_request_usage(user): called by the server when a request is sent. Free first, then included, then "extra".
--     It never blocks a request: it only says which kind it was.
--   * venue_requests gains plan and plan_kind so the admin queue can show the plan and the extra flag.
-- RLS: users read only their own rows; no client policy lets anyone write. The service role (server) bypasses RLS.
-- Not billed yet: extra requests are flagged only. "A whole season counts as one request" and the 7-day credit are
-- handled by hand for now.

begin;

-- ---------------------------------------------------------------------------
-- plan_catalog
-- ---------------------------------------------------------------------------
create table if not exists public.plan_catalog (
  plan                text primary key check (plan in ('scout', 'email', 'concierge')),
  name                text not null,
  price_cents         integer not null check (price_cents >= 0),
  monthly_requests    integer not null check (monthly_requests >= 0),
  extra_request_cents integer check (extra_request_cents is null or extra_request_cents >= 0)
);

insert into public.plan_catalog (plan, name, price_cents, monthly_requests, extra_request_cents) values
  ('scout',     'Scout',     599,  0, null),
  ('email',     'Email',     1099, 3, 300),
  ('concierge', 'Concierge', 2999, 4, 800)
on conflict (plan) do nothing;

alter table public.plan_catalog enable row level security;
revoke all on public.plan_catalog from anon, authenticated;
grant select on public.plan_catalog to authenticated;
drop policy if exists plan_catalog_select_signed_in on public.plan_catalog;
create policy plan_catalog_select_signed_in on public.plan_catalog for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- plan_subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.plan_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  plan                   text not null references public.plan_catalog (plan),
  status                 text not null
                           check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  stripe_customer_id     text,
  stripe_subscription_id text not null unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.plan_subscriptions is 'Stripe subscriptions for Fields plans. Only active and trialing count as having a plan.';

create index if not exists plan_subscriptions_user_idx on public.plan_subscriptions (user_id, status);

drop trigger if exists plan_subscriptions_touch_updated_at on public.plan_subscriptions;
create trigger plan_subscriptions_touch_updated_at
  before update on public.plan_subscriptions
  for each row execute function public.fields_touch_updated_at();

alter table public.plan_subscriptions enable row level security;
revoke all on public.plan_subscriptions from anon, authenticated;
grant select on public.plan_subscriptions to authenticated;
drop policy if exists plan_subscriptions_select_own on public.plan_subscriptions;
create policy plan_subscriptions_select_own on public.plan_subscriptions for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- plan_request_usage
-- ---------------------------------------------------------------------------
create table if not exists public.plan_request_usage (
  user_id             uuid not null references auth.users (id) on delete cascade,
  period_start        date not null,
  requests_used       integer not null default 0 check (requests_used >= 0),
  extra_requests_used integer not null default 0 check (extra_requests_used >= 0),
  free_request_used   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (user_id, period_start)
);

comment on table public.plan_request_usage is 'Per billing period: included requests used, extras, and (once ever, on any row) the free first request.';

drop trigger if exists plan_request_usage_touch_updated_at on public.plan_request_usage;
create trigger plan_request_usage_touch_updated_at
  before update on public.plan_request_usage
  for each row execute function public.fields_touch_updated_at();

alter table public.plan_request_usage enable row level security;
revoke all on public.plan_request_usage from anon, authenticated;
grant select on public.plan_request_usage to authenticated;
drop policy if exists plan_request_usage_select_own on public.plan_request_usage;
create policy plan_request_usage_select_own on public.plan_request_usage for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Start of the user's current usage period: the subscription's billing month when they have a plan, else the calendar month (UTC).
create or replace function public.plan_period_start(p_user uuid, p_now timestamptz default now())
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select (s.current_period_end - interval '1 month')::date
       from public.plan_subscriptions s
      where s.user_id = p_user
        and s.status in ('active', 'trialing')
        and s.current_period_end is not null
        and s.current_period_end > p_now
      order by s.current_period_end desc
      limit 1),
    date_trunc('month', p_now at time zone 'UTC')::date
  );
$$;

-- A user's plan, requests left this period, and whether the free request is used. Always returns exactly one row.
create or replace function public.plan_status(p_user uuid)
returns table (
  plan                text,
  status              text,
  current_period_end  timestamptz,
  monthly_requests    integer,
  requests_used       integer,
  extra_requests_used integer,
  requests_left       integer,
  free_request_used   boolean,
  period_start        date
)
language sql
stable
security definer
set search_path = public
as $$
  with sub as (
    select s.plan, s.status, s.current_period_end
      from public.plan_subscriptions s
     where s.user_id = p_user
       and s.status in ('active', 'trialing')
       and (s.current_period_end is null or s.current_period_end > now())
     order by s.current_period_end desc nulls last
     limit 1
  ),
  per as (select public.plan_period_start(p_user) as ps),
  cat as (select c.monthly_requests as included from public.plan_catalog c join sub on sub.plan = c.plan),
  usage_now as (
    select u.requests_used as used, u.extra_requests_used as extra
      from public.plan_request_usage u, per
     where u.user_id = p_user and u.period_start = per.ps
  ),
  free as (select coalesce(bool_or(u.free_request_used), false) as used from public.plan_request_usage u where u.user_id = p_user)
  select
    (select sub.plan from sub),
    (select sub.status from sub),
    (select sub.current_period_end from sub),
    coalesce((select cat.included from cat), 0),
    coalesce((select usage_now.used from usage_now), 0),
    coalesce((select usage_now.extra from usage_now), 0),
    greatest(coalesce((select cat.included from cat), 0) - coalesce((select usage_now.used from usage_now), 0), 0),
    (select free.used from free),
    (select per.ps from per);
$$;

-- The signed-in user's own status (what the app calls).
create or replace function public.my_plan_status()
returns table (
  plan                text,
  status              text,
  current_period_end  timestamptz,
  monthly_requests    integer,
  requests_used       integer,
  extra_requests_used integer,
  requests_left       integer,
  free_request_used   boolean,
  period_start        date
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.plan_status(auth.uid());
$$;

-- Called by the server when a request is sent. Records the usage and says which kind it was. Never blocks a request.
--   free     the player's one free request (once, ever, for everyone, with or without a plan)
--   included within the plan's monthly requests
--   extra    beyond the plan, or no plan: the admin sees the flag
create or replace function public.record_plan_request_usage(p_user uuid)
returns table (kind text, plan text, requests_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps   date;
  v_plan text;
  v_incl integer;
  v_free boolean;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtext('plan_usage:' || p_user::text));

  v_ps := public.plan_period_start(p_user);

  select s.plan into v_plan
    from public.plan_subscriptions s
   where s.user_id = p_user
     and s.status in ('active', 'trialing')
     and (s.current_period_end is null or s.current_period_end > now())
   order by s.current_period_end desc nulls last
   limit 1;

  select c.monthly_requests into v_incl from public.plan_catalog c where c.plan = v_plan;
  v_incl := coalesce(v_incl, 0);

  insert into public.plan_request_usage (user_id, period_start) values (p_user, v_ps)
  on conflict (user_id, period_start) do nothing;

  select coalesce(bool_or(u.free_request_used), false) into v_free
    from public.plan_request_usage u where u.user_id = p_user;

  select u.requests_used into v_used
    from public.plan_request_usage u where u.user_id = p_user and u.period_start = v_ps;

  if not v_free then
    update public.plan_request_usage u set free_request_used = true
     where u.user_id = p_user and u.period_start = v_ps;
    return query select 'free'::text, v_plan, greatest(v_incl - v_used, 0);
  elsif v_used < v_incl then
    update public.plan_request_usage u set requests_used = u.requests_used + 1
     where u.user_id = p_user and u.period_start = v_ps;
    return query select 'included'::text, v_plan, v_incl - v_used - 1;
  else
    update public.plan_request_usage u set extra_requests_used = u.extra_requests_used + 1
     where u.user_id = p_user and u.period_start = v_ps;
    return query select 'extra'::text, v_plan, 0;
  end if;
end;
$$;

revoke all on function public.plan_period_start(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.plan_status(uuid) from public, anon, authenticated;
revoke all on function public.record_plan_request_usage(uuid) from public, anon, authenticated;
revoke all on function public.my_plan_status() from public, anon;
grant execute on function public.plan_period_start(uuid, timestamptz) to service_role;
grant execute on function public.plan_status(uuid) to service_role;
grant execute on function public.record_plan_request_usage(uuid) to service_role;
grant execute on function public.my_plan_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- venue_requests: which plan and which kind of request, for the admin queue
-- ---------------------------------------------------------------------------
alter table public.venue_requests add column if not exists plan text;
alter table public.venue_requests add column if not exists plan_kind text
  check (plan_kind is null or plan_kind in ('free', 'included', 'extra'));

-- Players must not set these themselves on a direct insert.
drop policy if exists venue_requests_insert_own on public.venue_requests;
create policy venue_requests_insert_own on public.venue_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'new'
    and draft_email is null
    and school_contact_email is null
    and admin_notes is null
    and plan is null
    and plan_kind is null
  );

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- alter table public.venue_requests drop column if exists plan_kind;
-- alter table public.venue_requests drop column if exists plan;
-- -- then re-create venue_requests_insert_own as in 20261012000100_fields_requests_events_slots.sql
-- drop function if exists public.record_plan_request_usage(uuid);
-- drop function if exists public.my_plan_status();
-- drop function if exists public.plan_status(uuid);
-- drop function if exists public.plan_period_start(uuid, timestamptz);
-- drop table if exists public.plan_request_usage;
-- drop table if exists public.plan_subscriptions;
-- drop table if exists public.plan_catalog;
-- commit;
-- ============================================================
