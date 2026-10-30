-- Server-side analytics events written by the database itself, so every path that changes a row is counted exactly once:
-- the RSVP route, the Stripe webhook, admin tools, the waitlist job, account deletion. A route that forgets cannot lose an event.
-- Needs 20261026000000_analytics_events.sql. Additive and idempotent. No CASCADE. Each trigger is created only if its table exists,
-- so this runs on a database that has only a stub of pickup_run_rsvps.
--
--   pickup_run_rsvps      status becomes   confirmed          -> rsvp_completed
--                                          pending_payment    -> rsvp_started   (properties.trigger = payment_pending: checkout began)
--                                          waitlist           -> waitlisted
--                                          pending_confirm    -> waitlist_promoted (a waitlist spot was offered)
--                                          canceled/cancelled, or the row is deleted -> rsvp_cancelled (properties.hours = hours before kickoff)
--   pickup_run_attendance attended true    -> attended        attended false -> no_show      (the admin's mark; one event per change)
--   peer_ratings          first rating by a player for a session -> postgame_vote_completed (properties.vote_type = peer_rating)
--
-- The region is read with to_jsonb(r) ->> 'service_region' so the triggers also work on a database whose pickup_runs stub has no such column
-- (the region is then just empty).
-- Rows with no user (anonymised by account deletion) produce nothing. A failure inside a trigger is swallowed: analytics must never
-- block an RSVP, a mark or a rating. All events are source 'server' and carry the game's service region.
--
-- Verify after running (the last query shows one event per transition; run it inside a transaction you roll back on a database you care about):
--   select tgname, tgrelid::regclass from pg_trigger where tgname like 'analytics_%' and not tgisinternal order by 1;
-- Rollback (manual):
--   begin;
--   drop trigger if exists analytics_rsvp_change on public.pickup_run_rsvps;
--   drop trigger if exists analytics_attendance_change on public.pickup_run_attendance;
--   drop trigger if exists analytics_peer_rating on public.peer_ratings;
--   drop function if exists public.analytics_on_rsvp_change();
--   drop function if exists public.analytics_on_attendance_change();
--   drop function if exists public.analytics_on_peer_rating();
--   commit;
begin;

create or replace function public.analytics_on_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_run uuid;
  v_id uuid;
  v_old text;
  v_new text;
  v_name text;
  v_region text;
  v_start timestamptz;
  v_props jsonb;
begin
  begin
    if tg_op = 'DELETE' then
      v_user := old.user_id; v_run := old.run_id; v_id := old.id; v_old := old.status; v_new := null;
    else
      v_user := new.user_id; v_run := new.run_id; v_id := new.id; v_new := new.status;
      v_old := case when tg_op = 'UPDATE' then old.status else null end;
    end if;
    if v_user is null or v_run is null or v_new is not distinct from v_old then
      return coalesce(new, old);
    end if;

    v_name := case
      when v_new = 'confirmed' then 'rsvp_completed'
      when v_new = 'pending_payment' then 'rsvp_started'
      when v_new = 'waitlist' then 'waitlisted'
      when v_new = 'pending_confirm' then 'waitlist_promoted'
      when v_new is null or v_new in ('canceled', 'cancelled') then 'rsvp_cancelled'
      else null
    end;
    if v_name is null then
      return coalesce(new, old);
    end if;
    -- a row that was already cancelled and is then deleted is not a second cancellation
    if v_new is null and v_old in ('canceled', 'cancelled') then
      return coalesce(new, old);
    end if;

    select to_jsonb(r) ->> 'service_region', r.start_at into v_region, v_start from public.pickup_runs r where r.id = v_run;
    v_props := jsonb_build_object('run_id', v_run::text, 'status', coalesce(v_new, 'deleted'));
    if v_name = 'rsvp_started' then
      v_props := v_props || jsonb_build_object('trigger', 'payment_pending');
    elsif v_name = 'rsvp_cancelled' and v_start is not null then
      v_props := v_props || jsonb_build_object('hours', round((extract(epoch from (v_start - now())) / 3600.0)::numeric, 1));
    end if;

    insert into public.analytics_events (event_key, occurred_at, user_id, region, name, properties, source)
    values (v_name || ':' || v_id::text || ':' || coalesce(v_old, 'none') || '>' || coalesce(v_new, 'deleted') || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
            now(), v_user, v_region, v_name, v_props, 'server')
    on conflict (event_key) do nothing;
  exception when others then
    null;
  end;
  return coalesce(new, old);
end;
$$;

create or replace function public.analytics_on_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_region text;
  v_name text;
begin
  begin
    if new.user_id is null or new.run_id is null or new.attended is null then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.attended is not distinct from new.attended then
      return new;
    end if;
    v_name := case when new.attended then 'attended' else 'no_show' end;
    select to_jsonb(r) ->> 'service_region' into v_region from public.pickup_runs r where r.id = new.run_id;
    insert into public.analytics_events (event_key, occurred_at, user_id, region, name, properties, source)
    values (v_name || ':mark:' || new.run_id::text || ':' || new.user_id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
            now(), new.user_id, v_region, v_name, jsonb_build_object('run_id', new.run_id::text, 'trigger', 'admin_mark'), 'server')
    on conflict (event_key) do nothing;
  exception when others then
    null;
  end;
  return new;
end;
$$;

create or replace function public.analytics_on_peer_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_region text;
begin
  begin
    if new.rater_id is null or new.session_id is null then
      return new;
    end if;
    -- one event per player per game, however many teammates they rate
    select r.id, to_jsonb(r) ->> 'service_region' into v_run, v_region from public.pickup_runs r where to_jsonb(r) ->> 'tier_session_id' = new.session_id::text limit 1;
    insert into public.analytics_events (event_key, occurred_at, user_id, region, name, properties, source)
    values ('postgame_vote_completed:peer_rating:' || new.session_id::text || ':' || new.rater_id::text,
            now(), new.rater_id, v_region, 'postgame_vote_completed',
            case when v_run is null then jsonb_build_object('vote_type', 'peer_rating') else jsonb_build_object('vote_type', 'peer_rating', 'run_id', v_run::text) end, 'server')
    on conflict (event_key) do nothing;
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke all on function public.analytics_on_rsvp_change() from public, anon, authenticated;
revoke all on function public.analytics_on_attendance_change() from public, anon, authenticated;
revoke all on function public.analytics_on_peer_rating() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.pickup_run_rsvps') is not null then
    drop trigger if exists analytics_rsvp_change on public.pickup_run_rsvps;
    create trigger analytics_rsvp_change after insert or update of status or delete on public.pickup_run_rsvps
      for each row execute function public.analytics_on_rsvp_change();
  end if;
  if to_regclass('public.pickup_run_attendance') is not null then
    drop trigger if exists analytics_attendance_change on public.pickup_run_attendance;
    create trigger analytics_attendance_change after insert or update of attended on public.pickup_run_attendance
      for each row execute function public.analytics_on_attendance_change();
  end if;
  if to_regclass('public.peer_ratings') is not null then
    drop trigger if exists analytics_peer_rating on public.peer_ratings;
    create trigger analytics_peer_rating after insert on public.peer_ratings
      for each row execute function public.analytics_on_peer_rating();
  end if;
end $$;

commit;
