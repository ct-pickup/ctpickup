-- Fields paid plans v2 (board 11): Do it yourself (free), Book my season (one-time payment), Concierge (monthly subscription).
-- Additive. Apply AFTER 20261015000000_plans.sql, which created plan_catalog, plan_subscriptions, plan_request_usage,
-- my_plan_status() and record_plan_request_usage(). Those stay: plan_subscriptions now only holds Concierge, and the usage
-- function still does "free first request, then included, then extra".
--
-- This migration:
--   * trims plan_catalog to what the database needs: Concierge's included requests (the Scout and Email rows from the first
--     design are removed unless a test subscription still points at them) and drops the price column. PRICES NOW LIVE ONLY IN
--     shared/fields/plans.ts (and the Stripe Price you create), so there is one place to change them.
--   * adds season_purchases: a one-time "Book my season" payment (one field, same weekday and time every week).
--   * lets venue_requests carry plan_kind = 'season' and the number of weeks.
-- RLS: users read only their own season_purchases; only the server (service role) writes.

begin;

-- ---------------------------------------------------------------------------
-- plan_catalog: no prices here
-- ---------------------------------------------------------------------------
delete from public.plan_catalog c
 where c.plan in ('scout', 'email')
   and not exists (select 1 from public.plan_subscriptions s where s.plan = c.plan);

alter table public.plan_catalog drop column if exists price_cents;

comment on table public.plan_catalog is
  'Included requests per subscription plan (Concierge: 4 a month, extras billed outside this table). Prices live in shared/fields/plans.ts and in Stripe, not here. If you change monthly_requests in the app config, update the row here too.';

-- ---------------------------------------------------------------------------
-- season_purchases
-- ---------------------------------------------------------------------------
create table if not exists public.season_purchases (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users (id) on delete cascade,
  venue_key                  text not null references public.venues (venue_key) on delete restrict,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text unique,
  status                     text not null default 'pending'
                               check (status in ('pending', 'paid', 'canceled', 'refunded', 'failed')),
  requested_start_date       date not null,
  weekday                    smallint not null check (weekday between 0 and 6),   -- 0 = Sunday ... 6 = Saturday
  start_time                 time not null,
  duration_hours             numeric(3, 1) not null default 2 check (duration_hours in (1, 1.5, 2)),
  weeks                      integer not null check (weeks between 1 and 20),
  players                    integer not null default 14 check (players between 1 and 100),
  amount_cents               integer check (amount_cents is null or amount_cents >= 0),
  venue_request_id           uuid references public.venue_requests (id) on delete set null,
  paid_at                    timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

comment on table public.season_purchases is
  'One-time "Book my season" payments: one field, same weekday and time each week for N weeks. Counts as ONE request however many weeks. The server creates the single venue_requests row (plan_kind = season) when payment completes.';

create index if not exists season_purchases_user_idx on public.season_purchases (user_id, created_at desc);

drop trigger if exists season_purchases_touch_updated_at on public.season_purchases;
create trigger season_purchases_touch_updated_at
  before update on public.season_purchases
  for each row execute function public.fields_touch_updated_at();

alter table public.season_purchases enable row level security;
revoke all on public.season_purchases from anon, authenticated;
grant select on public.season_purchases to authenticated;
drop policy if exists season_purchases_select_own on public.season_purchases;
create policy season_purchases_select_own on public.season_purchases for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- venue_requests: season flag and number of weeks
-- ---------------------------------------------------------------------------
alter table public.venue_requests add column if not exists weeks integer
  check (weeks is null or weeks between 1 and 20);

alter table public.venue_requests drop constraint if exists venue_requests_plan_kind_check;
alter table public.venue_requests add constraint venue_requests_plan_kind_check
  check (plan_kind is null or plan_kind in ('free', 'included', 'extra', 'season'));

-- Players must not set weeks on a direct insert either (the server sets it for a paid season).
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
    and weeks is null
  );

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.season_purchases;
-- alter table public.venue_requests drop column if exists weeks;
-- alter table public.venue_requests drop constraint if exists venue_requests_plan_kind_check;
-- alter table public.venue_requests add constraint venue_requests_plan_kind_check
--   check (plan_kind is null or plan_kind in ('free', 'included', 'extra'));
-- -- then re-create venue_requests_insert_own as in 20261015000000_plans.sql
-- -- (price_cents on plan_catalog is not restored; it is unused)
-- commit;
-- ============================================================
