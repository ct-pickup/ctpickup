-- Remote on/off switches (feature flags) so rollout can be controlled without a new app build.
-- Additive. Needs: public.is_admin_uid(uuid), public.fields_touch_updated_at() (20261012000000), and the Fields tables
-- (20261012000100, 20261012000200, 20261018000000) whose insert policies are tightened at the end.
--
-- A flag is ON for a user when  enabled = true (everyone)  OR  the user's id is in allowlist  OR  the user is an admin.
-- Anything else (no row, no session, an error) is OFF. Two flags are seeded, both OFF:
--   'fields'      the whole Fields feature (browse, request, suggest, report, game-at-a-field, alerts, season)
--   'paid_plans'  paid plans (Concierge, Book my season checkout)
-- The server (lib/flags.ts) enforces them in the API routes; the policies below enforce 'fields' for direct client writes, so an
-- old app build cannot bypass the switch. Reads of public venue data stay open.
begin;

create table if not exists public.app_flags (
  key        text primary key,
  enabled    boolean     not null default false,
  allowlist  uuid[]      not null default '{}',
  note       text,
  updated_at timestamptz not null default now()
);

comment on table public.app_flags is 'Feature switches. ON for everyone when enabled, for users in allowlist, and for admins. See flag_on().';

drop trigger if exists app_flags_touch_updated_at on public.app_flags;
create trigger app_flags_touch_updated_at before update on public.app_flags
  for each row execute function public.fields_touch_updated_at();

insert into public.app_flags (key, enabled, note) values
  ('fields', false, 'Fields: browse, request, suggest, report, games at fields, alerts'),
  ('paid_plans', false, 'Paid plans: Concierge and Book my season checkout')
on conflict (key) do nothing;

alter table public.app_flags enable row level security;

-- Signed-in users can read the switches, but not who is on the allowlist (column grants below), and the app reads its own
-- answer through my_flags() anyway.
drop policy if exists app_flags_select_signed_in on public.app_flags;
create policy app_flags_select_signed_in on public.app_flags
  for select to authenticated using (true);

drop policy if exists app_flags_admin_write on public.app_flags;
create policy app_flags_admin_write on public.app_flags
  for all to authenticated
  using (public.is_admin_uid(auth.uid()))
  with check (public.is_admin_uid(auth.uid()));

revoke all on public.app_flags from anon, authenticated;
grant select (key, enabled, updated_at) on public.app_flags to authenticated;   -- not allowlist or note
grant insert, update, delete on public.app_flags to authenticated;              -- still gated by the admin policy above
grant all on public.app_flags to service_role;

-- Who changed what, and when. Written by the admin API route (service role); admins can read it.
create table if not exists public.app_flag_events (
  id         bigserial primary key,
  flag_key   text        not null,
  actor_id   uuid        references auth.users (id) on delete set null,
  change     jsonb       not null,
  created_at timestamptz not null default now()
);
create index if not exists app_flag_events_flag_idx on public.app_flag_events (flag_key, created_at desc);
alter table public.app_flag_events enable row level security;
drop policy if exists app_flag_events_admin_read on public.app_flag_events;
create policy app_flag_events_admin_read on public.app_flag_events
  for select to authenticated using (public.is_admin_uid(auth.uid()));
revoke all on public.app_flag_events from anon, authenticated;
grant select on public.app_flag_events to authenticated;
grant all on public.app_flag_events to service_role;
grant usage, select on sequence public.app_flag_events_id_seq to service_role;

-- True when the flag is ON for the user. Missing flag, null user or any doubt => false (admins are always on).
create or replace function public.flag_on(p_key text, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_uid is null then false
    when public.is_admin_uid(p_uid) then true
    else coalesce((select f.enabled or p_uid = any (f.allowlist) from public.app_flags f where f.key = p_key), false)
  end;
$$;

-- The caller's answer for every flag, e.g. {"fields": false, "paid_plans": false}. This is what the app reads.
create or replace function public.my_flags()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(f.key, public.flag_on(f.key, auth.uid())), '{}'::jsonb) from public.app_flags f;
$$;

revoke all on function public.flag_on(text, uuid) from public, anon;
revoke all on function public.my_flags() from public, anon;
grant execute on function public.flag_on(text, uuid) to authenticated, service_role;
grant execute on function public.my_flags() to authenticated, service_role;

-- Direct client writes for Fields need the 'fields' flag, so an old build cannot bypass the server check.
drop policy if exists venue_requests_insert_own on public.venue_requests;
create policy venue_requests_insert_own on public.venue_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.flag_on('fields')
    and status = 'new'
    and draft_email is null
    and school_contact_email is null
    and admin_notes is null
    and plan is null
    and plan_kind is null
    and weeks is null
  );

drop policy if exists venue_suggestions_insert_own on public.venue_suggestions;
create policy venue_suggestions_insert_own on public.venue_suggestions
  for insert to authenticated
  with check (user_id = auth.uid() and public.flag_on('fields') and status = 'pending' and reviewed_by is null and reviewed_at is null and created_venue_key is null);

drop policy if exists venue_confirmations_insert_own on public.venue_confirmations;
create policy venue_confirmations_insert_own on public.venue_confirmations
  for insert to authenticated with check (user_id = auth.uid() and public.flag_on('fields'));

drop policy if exists alert_subscriptions_own on public.alert_subscriptions;
create policy alert_subscriptions_own on public.alert_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.flag_on('fields'));

drop policy if exists saved_venues_own on public.saved_venues;
create policy saved_venues_own on public.saved_venues
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.flag_on('fields'));

commit;

-- ============================================================
-- Rollback (run manually if needed). Dropping the flags makes the server and the app treat everything as OFF for non-admins,
-- so re-create the old policies first if you want direct client writes to work again:
--
-- begin;
-- drop policy if exists venue_requests_insert_own on public.venue_requests;
-- create policy venue_requests_insert_own on public.venue_requests for insert to authenticated
--   with check (user_id = auth.uid() and status = 'new' and draft_email is null and school_contact_email is null
--               and admin_notes is null and plan is null and plan_kind is null and weeks is null);
-- drop policy if exists venue_suggestions_insert_own on public.venue_suggestions;
-- create policy venue_suggestions_insert_own on public.venue_suggestions for insert to authenticated
--   with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null and created_venue_key is null);
-- drop policy if exists venue_confirmations_insert_own on public.venue_confirmations;
-- create policy venue_confirmations_insert_own on public.venue_confirmations for insert to authenticated with check (user_id = auth.uid());
-- drop policy if exists alert_subscriptions_own on public.alert_subscriptions;
-- create policy alert_subscriptions_own on public.alert_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- drop policy if exists saved_venues_own on public.saved_venues;
-- create policy saved_venues_own on public.saved_venues for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- drop function if exists public.my_flags();
-- drop function if exists public.flag_on(text, uuid);
-- drop table if exists public.app_flag_events;
-- drop table if exists public.app_flags;
-- commit;
-- ============================================================
