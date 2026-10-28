import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const A = uuid(201); // admin
const B = uuid(202); // player
const R = uuid(301); // run

const seed = `
  insert into auth.users (id) values ('${A}'), ('${B}');
  insert into public.profiles (id, is_admin, approved) values ('${A}', true, true), ('${B}', false, false);
  insert into public.pickup_runs (id, title, start_at, created_by) values ('${R}', 'Game', now() + interval '10 hours', '${A}');
`;

describe.skipIf(!SQL_TESTS_ENABLED)("analytics_events (real Postgres)", () => {
  it("accepts allowlisted names and plain properties", () => {
    const out = sql(`${seed}
      insert into public.analytics_events (event_key, name, properties, source) values ('k-accept-1', 'run_viewed', '{"run_id":"abc","rank":2,"enabled":true}', 'client');
      select count(*) from public.analytics_events where event_key = 'k-accept-1';`);
    expect(out).toEqual(["1"]);
  });
  it("refuses unknown names, unknown keys and values that could hold personal data", () => {
    for (const [name, props] of [
      ["not_an_event", "{}"],
      ["run_viewed", '{"email":"a@b.co"}'],
      ["run_viewed", '{"kind":"hello world"}'],
      ["run_viewed", '{"kind":"a@b.co"}'],
      ["run_viewed", '{"kind":{"x":1}}'],
      ["run_viewed", '{"kind":"' + "x".repeat(65) + '"}'],
    ] as const) {
      const err = sqlError(`insert into public.analytics_events (event_key, name, properties, source) values ('k-bad-${Math.random()}', '${name}', '${props}', 'client');`);
      expect(err, `${name} ${props}`).toMatch(/violates check constraint/);
    }
  });
  it("stores a repeated event key once", () => {
    const out = sql(`
      insert into public.analytics_events (event_key, name, source) values ('k-dupe-001', 'run_viewed', 'client') on conflict (event_key) do nothing;
      insert into public.analytics_events (event_key, name, source) values ('k-dupe-001', 'run_viewed', 'client') on conflict (event_key) do nothing;
      select count(*) from public.analytics_events where event_key = 'k-dupe-001';`);
    expect(out).toEqual(["1"]);
  });
  it("exposes run_id from the properties and keeps the event when the account is deleted", () => {
    const out = sql(`${seed}
      insert into public.analytics_events (event_key, name, user_id, properties, source) values ('k-del-0001', 'run_viewed', '${B}', '{"run_id":"${R}"}', 'client');
      select run_id from public.analytics_events where event_key = 'k-del-0001';
      delete from public.profiles where id = '${B}';
      delete from auth.users where id = '${B}';
      select coalesce(user_id::text, 'anonymous') from public.analytics_events where event_key = 'k-del-0001';`);
    expect(out).toEqual([R, "anonymous"]);
  });
  it("lets only admins read, and nobody write", () => {
    const out = sql(`${seed}
      insert into public.analytics_events (event_key, name, source) values ('k-rls-0001', 'run_viewed', 'client');
      grant select on public.profiles to authenticated;
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${B}', true);
      select 'player', count(*) from public.analytics_events where event_key = 'k-rls-0001';
      select set_config('request.jwt.claim.sub', '${A}', true);
      select 'admin', count(*) from public.analytics_events where event_key = 'k-rls-0001';`);
    expect(out.filter((l) => /^(player|admin)\|/.test(l))).toEqual(["player|0", "admin|1"]);
    const err = sqlError(`${seed}
      grant select on public.profiles to authenticated;
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${A}', true);
      insert into public.analytics_events (event_key, name, source) values ('k-rls-0002', 'run_viewed', 'client');`);
    expect(err).toMatch(/permission denied|row-level security/);
  });
  it("sets approved_at once when a player is approved and writes account_approved", () => {
    const out = sql(`${seed}
      select 'before', approved_at is null from public.profiles where id = '${B}';
      update public.profiles set approved = true where id = '${B}';
      select 'after', approved_at is not null, approved_at_source from public.profiles where id = '${B}';
      update public.profiles set approved = false where id = '${B}';
      update public.profiles set approved = true where id = '${B}';
      select 'events', count(*) from public.analytics_events where name = 'account_approved' and user_id = '${B}';`);
    expect(out).toEqual(["before|t", "after|t|trigger", "events|1"]);
  });
  it("records one event per RSVP step with the hours before kickoff on a cancel", () => {
    const out = sql(`${seed}
      insert into public.pickup_run_rsvps (run_id, user_id, status) values ('${R}', '${B}', 'confirmed');
      update public.pickup_run_rsvps set status = 'cancelled' where run_id = '${R}' and user_id = '${B}';
      select name, properties->>'status', coalesce((properties->>'hours')::numeric > 9, false) from public.analytics_events where user_id = '${B}' and name like 'rsvp_%' order by id;`);
    expect(out).toEqual(["rsvp_completed|confirmed|f", "rsvp_cancelled|cancelled|t"]);
  });
  it("records waitlist and promotion, and the same row twice in one status makes no second event", () => {
    const out = sql(`${seed}
      insert into public.pickup_run_rsvps (run_id, user_id, status) values ('${R}', '${B}', 'waitlist');
      update public.pickup_run_rsvps set status = 'waitlist', updated_at = now() where run_id = '${R}';
      update public.pickup_run_rsvps set status = 'pending_confirm' where run_id = '${R}';
      select name from public.analytics_events where user_id = '${B}' order by id;`);
    expect(out).toEqual(["waitlisted", "waitlist_promoted"]);
  });
  it("never blocks an RSVP when the analytics table is unavailable", () => {
    const out = sql(`${seed}
      alter table public.analytics_events rename to analytics_events_away;
      insert into public.pickup_run_rsvps (run_id, user_id, status) values ('${R}', '${B}', 'confirmed');
      select count(*) from public.pickup_run_rsvps where run_id = '${R}';`);
    expect(out).toEqual(["1"]);
  });
  it("marks attended and no_show from the attendance table when it exists", () => {
    const out = sql(`${seed}
      create table if not exists public.pickup_run_attendance (run_id uuid, user_id uuid, attended boolean, primary key (run_id, user_id));
      drop trigger if exists analytics_attendance_change on public.pickup_run_attendance;
      create trigger analytics_attendance_change after insert or update on public.pickup_run_attendance for each row execute function public.analytics_on_attendance_change();
      insert into public.pickup_run_attendance (run_id, user_id, attended) values ('${R}', '${B}', true);
      update public.pickup_run_attendance set attended = false;
      select name from public.analytics_events where user_id = '${B}' order by id;`);
    expect(out).toEqual(["attended", "no_show"]);
  });
  it("analytics_prune keeps at least 30 days and is closed to players", () => {
    expect(sqlError("select public.analytics_prune(7);")).toMatch(/keep at least 30 days/);
    const out = sql(`
      insert into public.analytics_events (event_key, name, occurred_at, source) values ('k-old-0001', 'run_viewed', now() - interval '400 days', 'client'), ('k-new-0001', 'run_viewed', now(), 'client');
      select public.analytics_prune(365);
      select count(*) from public.analytics_events where event_key in ('k-old-0001', 'k-new-0001');`);
    expect(out).toEqual(["1", "1"]);
    expect(sqlError("set local role authenticated; select public.analytics_prune(365);")).toMatch(/permission denied/);
  });
});
