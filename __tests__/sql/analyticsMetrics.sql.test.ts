import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";

const P1 = uuid(401);
const P2 = uuid(402);
const P3 = uuid(403);
const RX = uuid(501);
const RY = uuid(502);
const RZ = uuid(503);

// ev(key, name, user, when, props, region) inserts one event with an explicit time.
const setup = `
  insert into auth.users (id) values ('${P1}'), ('${P2}'), ('${P3}');
  create function pg_temp.ev(k text, n text, u uuid, at timestamptz, props jsonb default '{}', reg text default null) returns void language sql as
    $$ insert into public.analytics_events (event_key, name, user_id, occurred_at, properties, region, source) values ('metric-test-' || k, n, u, at, props, reg, 'server') $$;
`;

describe.skipIf(!SQL_TESTS_ENABLED)("analytics metrics views (real Postgres)", () => {
  it("first-game funnel counts players who reached each step after approval", () => {
    const out = sql(`${setup}
      select pg_temp.ev('f1', 'account_approved', '${P1}', now() - interval '20 days');
      select pg_temp.ev('f2', 'account_approved', '${P2}', now() - interval '20 days');
      select pg_temp.ev('f3', 'run_viewed', '${P1}', now() - interval '19 days', '{"run_id":"a"}');
      select pg_temp.ev('f4', 'run_viewed', '${P2}', now() - interval '19 days', '{"run_id":"a"}');
      select pg_temp.ev('f5', 'rsvp_completed', '${P1}', now() - interval '18 days', '{"run_id":"a"}');
      select pg_temp.ev('f6', 'attended', '${P1}', now() - interval '17 days', '{"run_id":"a"}');
      select pg_temp.ev('f7', 'run_viewed', '${P3}', now() - interval '19 days', '{"run_id":"a"}');
      select step_order || ':' || step || ':' || players from public.analytics_first_game_funnel order by step_order;`);
    expect(out).toEqual(["1:account_approved:2", "2:run_list_viewed:0", "3:run_viewed:2", "4:rsvp_started:0", "5:rsvp_completed:1", "6:attended:1"]);
  });

  it("second game in 30 days needs a different game, and cohorts are marked mature only after 30 days", () => {
    const out = sql(`${setup}
      create temp table t0 as select date_trunc('week', now() - interval '60 days') + interval '1 day 12 hours' as t;
      select pg_temp.ev('s1', 'attended', '${P1}', (select t from t0), '{"run_id":"${RX}"}');
      select pg_temp.ev('s2', 'attended', '${P1}', (select t from t0) + interval '10 days', '{"run_id":"${RY}"}');
      select pg_temp.ev('s3', 'attended', '${P2}', (select t from t0), '{"run_id":"${RX}"}');
      select pg_temp.ev('s4', 'attended', '${P3}', (select t from t0), '{"run_id":"${RX}"}');
      select pg_temp.ev('s5', 'attended', '${P3}', (select t from t0) + interval '5 days', '{"run_id":"${RX}"}');
      select pg_temp.ev('s6', 'attended', '${P2}', (select t from t0) + interval '45 days', '{"run_id":"${RY}"}');
      select players || '|' || returned || '|' || rate_pct || '|' || mature from public.analytics_second_game_30d;
      select week_offset || ':' || active || '/' || cohort_size || ':' || rate_pct from public.analytics_retention_cohorts where week_offset <= 1 order by week_offset;`);
    expect(out).toEqual(["3|1|33.3|true", "0:3/3:100.0", "1:1/3:33.3"]);
  });

  it("a cohort from this week is not mature and has no future cells", () => {
    const out = sql(`${setup}
      select pg_temp.ev('y1', 'attended', '${P1}', now(), '{"run_id":"${RX}"}');
      select mature from public.analytics_second_game_30d;
      select count(*) from public.analytics_retention_cohorts;`);
    expect(out).toEqual(["f", "1"]);
  });

  it("run health: fill, waitlist, no-show and cancel rates per region", () => {
    const out = sql(`${setup}
      insert into public.pickup_runs (id, title, start_at, capacity) values ('${RZ}', 'g', now() - interval '3 days', 10);
      select pg_temp.ev('h' || i, 'rsvp_completed', (array['${P1}','${P2}','${P3}'])[least(i,3)]::uuid, now() - interval '4 days', '{"run_id":"${RZ}"}', 'CT') from generate_series(1, 3) i;
      select pg_temp.ev('h4', 'rsvp_cancelled', '${P3}', now() - interval '3 days 2 hours', '{"run_id":"${RZ}"}', 'CT');
      select pg_temp.ev('h5', 'waitlisted', '${P1}', now() - interval '4 days', '{"run_id":"${RZ}"}', 'CT');
      select pg_temp.ev('h6', 'attended', '${P1}', now() - interval '3 days', '{"run_id":"${RZ}"}', 'CT');
      select pg_temp.ev('h7', 'attended', '${P2}', now() - interval '3 days', '{"run_id":"${RZ}"}', 'CT');
      select pg_temp.ev('h8', 'no_show', '${P3}', now() - interval '3 days', '{"run_id":"${RZ}"}', 'CT');
      select joined || '|' || "left" || '|' || waitlisted || '|' || played || '|' || no_shows || '|' || fill_pct from public.analytics_run_health;
      select region || '|' || games || '|' || avg_fill_pct || '|' || games_with_waitlist_pct || '|' || no_show_pct || '|' || cancel_pct from public.analytics_run_health_by_region;`);
    expect(out).toEqual(["3|1|1|2|1|20.0", "CT|1|20.0|100.0|33.3|33.3"]);
  });

  it("notifications: opened by push id, joined within a day", () => {
    const out = sql(`${setup}
      select pg_temp.ev('n1', 'push_sent', '${P1}', now() - interval '2 days', '{"push_id":"pa","kind":"pickup_invite"}');
      select pg_temp.ev('n2', 'push_sent', '${P2}', now() - interval '2 days', '{"push_id":"pa","kind":"pickup_invite"}');
      select pg_temp.ev('n3', 'push_opened', '${P1}', now() - interval '2 days' + interval '5 minutes', '{"push_id":"pa"}');
      select pg_temp.ev('n4', 'rsvp_completed', '${P1}', now() - interval '2 days' + interval '1 hour', '{"run_id":"${RX}"}');
      select pg_temp.ev('n5', 'rsvp_completed', '${P2}', now() - interval '2 days' + interval '30 hours', '{"run_id":"${RX}"}');
      select kind || '|' || sent || '|' || opened || '|' || open_pct || '|' || joined_within_day || '|' || joined_within_day_pct from public.analytics_notification_effectiveness;`);
    expect(out).toEqual(["pickup_invite|2|1|50.0|1|50.0"]);
  });

  it("recommendations: tapped and joined by the same player and game", () => {
    const out = sql(`${setup}
      select pg_temp.ev('r1', 'recommendation_shown', '${P1}', now() - interval '3 hours', '{"run_id":"${RX}","list_kind":"best_games","reasons":"near_you"}');
      select pg_temp.ev('r2', 'recommendation_shown', '${P2}', now() - interval '3 hours', '{"run_id":"${RX}","list_kind":"best_games","reasons":"near_you"}');
      select pg_temp.ev('r3', 'recommendation_tapped', '${P1}', now() - interval '2 hours', '{"run_id":"${RX}"}');
      select pg_temp.ev('r4', 'rsvp_completed', '${P1}', now() - interval '1 hour', '{"run_id":"${RX}"}');
      select list_kind || '|' || reasons || '|' || shown || '|' || tapped || '|' || tap_pct || '|' || joined || '|' || joined_pct from public.analytics_recommendation_effectiveness;`);
    expect(out).toEqual(["best_games|near_you|2|1|50.0|1|50.0"]);
  });

  it("play again: players, taps and games created this week", () => {
    const out = sql(`${setup}
      select pg_temp.ev('p1', 'attended', '${P1}', now(), '{"run_id":"${RX}"}');
      select pg_temp.ev('p2', 'attended', '${P2}', now(), '{"run_id":"${RX}"}');
      select pg_temp.ev('p3', 'play_again_tapped', '${P1}', now(), '{"run_id":"${RX}"}');
      select pg_temp.ev('p4', 'play_again_created', '${P1}', now(), '{"run_id":"${RX}","new_run_id":"${RY}"}');
      select players || '|' || tapped || '|' || games_created || '|' || tap_pct from public.analytics_play_again_rate;`);
    expect(out).toEqual(["2|1|1|50.0"]);
  });

  it("the views are closed to players", () => {
    const err = sqlError("set local role authenticated; select * from public.analytics_second_game_30d;");
    expect(err).toMatch(/permission denied/);
  });
});
