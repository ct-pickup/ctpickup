-- Fields, step 3 of 3: alert settings and saved fields. Additive. Depends on 20261012000000_fields_venues_schools.sql.
--
--   * alert_subscriptions: one row per user per alert type. A user reads and writes only their own.
--   * saved_venues: a user's saved fields. Own rows only.
-- The settings UI lives inside the existing Notifications screen.

begin;

create table if not exists public.alert_subscriptions (
  user_id      uuid not null references auth.users (id) on delete cascade,
  alert_type   text not null
                 check (alert_type in ('slot_opens', 'request_updates', 'new_games', 'changes_cancellations', 'weekly_roundup')),
  enabled      boolean not null default true,
  radius_miles integer check (radius_miles is null or radius_miles between 1 and 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, alert_type)
);

comment on table public.alert_subscriptions is 'Which alerts a player wants. radius_miles applies to new_games (default 10 in the app).';

drop trigger if exists alert_subscriptions_touch_updated_at on public.alert_subscriptions;
create trigger alert_subscriptions_touch_updated_at
  before update on public.alert_subscriptions
  for each row execute function public.fields_touch_updated_at();

alter table public.alert_subscriptions enable row level security;
revoke all on public.alert_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.alert_subscriptions to authenticated;

drop policy if exists alert_subscriptions_own on public.alert_subscriptions;
create policy alert_subscriptions_own on public.alert_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.saved_venues (
  user_id    uuid not null references auth.users (id) on delete cascade,
  venue_key  text not null references public.venues (venue_key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_key)
);

alter table public.saved_venues enable row level security;
revoke all on public.saved_venues from anon, authenticated;
grant select, insert, delete on public.saved_venues to authenticated;

drop policy if exists saved_venues_own on public.saved_venues;
create policy saved_venues_own on public.saved_venues
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

commit;

-- ============================================================
-- Rollback (run manually if needed):
--
-- begin;
-- drop table if exists public.saved_venues;
-- drop table if exists public.alert_subscriptions;
-- commit;
-- ============================================================
