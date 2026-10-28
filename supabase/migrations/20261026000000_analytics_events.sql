-- First-party product analytics: the event table and what feeds it. Additive and idempotent. No CASCADE.
-- Needs: public.is_admin_uid(uuid), public.profiles, auth.users. Reads public.pickup_run_rsvps only if it exists (for one backfill).
--
-- WHAT IS STORED. One row per event, in public.analytics_events:
--   event_key    idempotency key. The same key twice is one row (a retried request, a webhook sent twice, an offline queue replayed).
--   occurred_at  when it happened.   user_id  who (null for an anonymous or deleted user).   session_id  one app launch.
--   platform ios | android | web.   app_version.   region: a service region code or town, never a precise location.
--   name         one of the allowlisted event names below (docs/analytics-events.md explains each).
--   properties   a flat object. Only allowlisted keys, and only booleans, numbers or short plain tokens (letters, digits and . _ : , | -).
--                Names, emails, phone numbers and free text cannot pass the CHECK (analytics_props_ok).
--   source       'server' (written by the API from what really happened; the source of truth) or 'client' (views and taps).
--
-- WHO CAN SEE IT. Admins only (RLS). Nobody writes through the API roles: events come from the service role (our API routes)
-- or from the profile trigger below. Players can switch the optional client events off (profiles.analytics_opt_out).
--
-- ACCOUNT DELETION. user_id is ON DELETE SET NULL, and the account-deletion code also deletes the player's rows
-- (lib/account/deleteUserAccount.ts). Explicit delete honours "deleted with the account"; SET NULL is the safety net: if a user is
-- ever removed some other way, the rows lose their link to a person instead of blocking the deletion or lingering with an id.
--
-- ALSO IN THIS MIGRATION
--   profiles.approved_at / approved_at_source: when the account was approved. A trigger sets it (source 'trigger') the first time
--     approved becomes true, and writes an account_approved event. Existing approved players are backfilled from their first RSVP
--     (source 'backfill_first_rsvp'), which is an UPPER BOUND: they were approved no later than that. Everyone else stays null.
--   profiles.analytics_opt_out: the player's choice for client events.
--   analytics_prune(days): deletes events older than N days (retention). Not scheduled; run it by hand or from a cron you add.
--
-- Verify after running:
--   select to_regclass('public.analytics_events'), to_regprocedure('public.analytics_props_ok(jsonb)');
--   select public.analytics_props_ok('{"run_id":"abc","count":2}'), public.analytics_props_ok('{"note":"free text"}'), public.analytics_props_ok('{"kind":"a b"}');   -- t, f, f
--   select count(*) filter (where approved is true and approved_at is null) as approved_without_time, count(*) filter (where approved_at is not null) as with_time from public.profiles;
-- Rollback (manual; deletes all analytics data):
--   begin;
--   drop trigger if exists profiles_set_approved_at on public.profiles;
--   drop function if exists public.profiles_set_approved_at();
--   drop function if exists public.analytics_prune(integer);
--   drop table if exists public.analytics_events;
--   drop function if exists public.analytics_props_ok(jsonb);
--   alter table public.profiles drop column if exists analytics_opt_out, drop column if exists approved_at_source, drop column if exists approved_at;
--   commit;
begin;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Profile columns
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_at_source text;
alter table public.profiles add column if not exists analytics_opt_out boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_approved_at_source_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_approved_at_source_check check (approved_at_source is null or approved_at_source in ('trigger', 'backfill_first_rsvp'));
  end if;
end $$;

comment on column public.profiles.approved_at is 'When the account was approved. Set by trigger profiles_set_approved_at; backfilled rows are upper bounds (see approved_at_source).';
comment on column public.profiles.approved_at_source is 'trigger = recorded when it happened. backfill_first_rsvp = approved no later than the first RSVP (an upper bound). Null = unknown.';
comment on column public.profiles.analytics_opt_out is 'True when the player switched off optional client analytics events in Settings. Server events about what happened are not optional.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- The property allowlist. Keep in step with lib/analytics/events.ts (a test compares the two lists).
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.analytics_props_ok(p jsonb)
returns boolean
language sql
immutable
as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) <= 12
     and not exists (
       select 1
         from jsonb_each(p) e
        where e.key <> all (array[
                'run_id', 'venue_key', 'kind', 'category', 'reason', 'reasons', 'position', 'count', 'from_screen', 'list_kind',
                'push_id', 'alert_type', 'enabled', 'role', 'status', 'result', 'step', 'trigger', 'rank', 'minutes_before', 'days',
                'hours', 'price_cents', 'capacity', 'spots_left', 'new_run_id', 'vote_type'
              ])
           or not (
                jsonb_typeof(e.value) = 'boolean'
             or (jsonb_typeof(e.value) = 'number' and abs((e.value #>> '{}')::numeric) < 1000000000)
             or (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[A-Za-z0-9_.:,|-]{1,64}$')
           )
     );
$$;

comment on function public.analytics_props_ok(jsonb) is 'True when an event properties object has only allowlisted keys and plain scalar values (no spaces, no @, no free text).';

-- ---------------------------------------------------------------------------------------------------------------------------
-- The events
-- ---------------------------------------------------------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id          bigserial primary key,
  event_key   text        not null,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  user_id     uuid        references auth.users (id) on delete set null,
  session_id  text,
  platform    text,
  app_version text,
  region      text,
  name        text        not null,
  properties  jsonb       not null default '{}'::jsonb,
  source      text        not null,
  run_id      text generated always as (properties ->> 'run_id') stored,
  constraint analytics_events_key_len check (char_length(event_key) between 8 and 160),
  constraint analytics_events_session_fmt check (session_id is null or session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  constraint analytics_events_platform_check check (platform is null or platform in ('ios', 'android', 'web')),
  constraint analytics_events_version_fmt check (app_version is null or app_version ~ '^[0-9A-Za-z.+_-]{1,32}$'),
  constraint analytics_events_region_fmt check (region is null or region ~ '^[A-Za-z0-9 ._-]{1,32}$'),
  constraint analytics_events_source_check check (source in ('client', 'server')),
  constraint analytics_events_name_check check (name in (
    'account_approved', 'run_list_viewed', 'run_viewed', 'recommendation_shown', 'recommendation_tapped',
    'rsvp_started', 'rsvp_completed', 'rsvp_cancelled', 'waitlisted', 'waitlist_promoted',
    'checked_in', 'attended', 'no_show', 'postgame_vote_completed', 'play_again_tapped',
    'push_sent', 'push_opened', 'alert_subscribed', 'field_viewed', 'field_request_sent',
    'push_suppressed', 'push_pref_changed', 'play_again_created'
  )),
  constraint analytics_events_props_ok check (public.analytics_props_ok(properties))
);

comment on table public.analytics_events is 'First-party product analytics. Admin read only. See docs/analytics-events.md.';

create unique index if not exists analytics_events_key_uidx on public.analytics_events (event_key);
create index if not exists analytics_events_name_time_idx on public.analytics_events (name, occurred_at);
create index if not exists analytics_events_user_time_idx on public.analytics_events (user_id, occurred_at);
create index if not exists analytics_events_run_idx on public.analytics_events (run_id) where run_id is not null;

alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
grant select on public.analytics_events to authenticated;
grant all on public.analytics_events to service_role;
grant usage, select on sequence public.analytics_events_id_seq to service_role;

drop policy if exists analytics_events_admin_read on public.analytics_events;
create policy analytics_events_admin_read on public.analytics_events
  for select to authenticated
  using (public.is_admin_uid(auth.uid()));

-- Retention: deletes events older than the given number of days and returns how many. Service role only.
create or replace function public.analytics_prune(p_days integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  if p_days is null or p_days < 30 then
    raise exception 'analytics_prune: keep at least 30 days';
  end if;
  delete from public.analytics_events where occurred_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.analytics_prune(integer) from public, anon, authenticated;
grant execute on function public.analytics_prune(integer) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- approved_at: set the first time approved becomes true, and record account_approved. Never blocks the profile write.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.profiles_set_approved_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approved is true and (tg_op = 'INSERT' or old.approved is distinct from true) then
    if new.approved_at is null then
      new.approved_at := now();
      new.approved_at_source := 'trigger';
    end if;
    begin
      insert into public.analytics_events (event_key, occurred_at, user_id, name, properties, source)
      values ('account_approved:' || new.id::text || ':' || floor(extract(epoch from now()))::bigint::text, now(), new.id, 'account_approved', '{}'::jsonb, 'server')
      on conflict (event_key) do nothing;
    exception when others then
      null; -- analytics must never stop an approval
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_set_approved_at() from public, anon, authenticated;

drop trigger if exists profiles_set_approved_at on public.profiles;
create trigger profiles_set_approved_at
  before insert or update of approved on public.profiles
  for each row execute function public.profiles_set_approved_at();

-- Backfill: approved players with no time get their first RSVP as an upper bound. Skipped when there is no RSVP table.
do $$
begin
  if to_regclass('public.pickup_run_rsvps') is not null then
    update public.profiles p
       set approved_at = f.first_at, approved_at_source = 'backfill_first_rsvp'
      from (select user_id, min(created_at) as first_at from public.pickup_run_rsvps where user_id is not null group by user_id) f
     where f.user_id = p.id and p.approved is true and p.approved_at is null;
  end if;
end $$;

commit;
