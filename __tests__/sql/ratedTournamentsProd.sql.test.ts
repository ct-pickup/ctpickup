import { describe, expect, it } from "vitest";

import { SQL_TESTS_ENABLED, sql, sqlError, uuid } from "./harness";
import { ADMIN, BYSTANDER, TOUR, captain, find, match, ordinaryGame, players, rostered, sync, sync_json, world, type W } from "./tournamentWorld";

/**
 * Rated tournaments against a database shaped like production: the exact policy names and triggers listed in
 * __tests__/sql/scratch-setup/20_production_shape.sql, with row level security on. Run with --no-file-parallelism.
 *
 * Production's policies are all PERMISSIVE, and a permissive policy can only add access. The migration hides tournament match records with
 * RESTRICTIVE policies, which are ANDed with the permissive ones. These tests prove that, as a player, an admin, the service role and
 * anonymous, with those policies in place.
 */

const asRole = (role: "authenticated" | "anon", uid?: string) => `set local role ${role}; ${uid ? `select set_config('request.jwt.claim.sub', '${uid}', true);` : ""}`;
const backToServer = "reset role;";
const PLAYER = captain(0);
const ORDINARY_RUN = uuid(8200);

const scored: W = { matches: [{ n: 1, sa: 3, sb: 1 }, { n: 2, sa: 2, sb: 0, at: "2026-11-14 17:00" }] };
/** Hidden records for 2 scored matches, an ordinary game, and one RSVP on the ordinary game. */
const setup = (w: W = scored) => `${world(w)} ${ordinaryGame()}
  insert into public.pickup_run_rsvps (run_id, user_id, status) values ('${ORDINARY_RUN}', '${PLAYER}', 'confirmed');
  update public.profiles set approved = true;
  ${w.matches!.map((m) => sync(m.n)).join("\n")}`;
const counts = (who: string) => `
  select '${who}-runs|' || count(*) from public.pickup_runs;
  select '${who}-results|' || count(*) from public.pickup_run_results;
  select '${who}-assign|' || count(*) from public.pickup_run_team_assignments;
  select '${who}-rsvps|' || count(*) from public.pickup_run_rsvps;`;

describe.skipIf(!SQL_TESTS_ENABLED)("rated tournaments with production's policies and triggers in place (real Postgres)", () => {
  it("the scratch database really has production's policy and trigger names (otherwise these tests prove nothing)", () => {
    const out = sql(`
      select 'pol|' || polrelid::regclass::text || '.' || polname from pg_policy where polrelid::regclass::text in ('pickup_runs','pickup_run_results','pickup_run_rsvps') and polpermissive order by 1;
      select 'trg|' || tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('pickup_runs','pickup_run_results','pickup_run_rsvps') order by 1;
      select 'rls|' || relname || '|' || relrowsecurity from pg_class where relname in ('pickup_runs','pickup_run_results','pickup_run_rsvps') order by 1;`);
    const pol = out.filter((l) => l.startsWith("pol|")).map((l) => l.slice(4));
    for (const p of ["pickup_run_results.pickup_run_results_admin_write", "pickup_run_results.pickup_run_results_select_all", "pickup_run_rsvps.pickup_run_rsvps_admin_insert", "pickup_run_rsvps.pickup_run_rsvps_admin_select", "pickup_run_rsvps.pickup_run_rsvps_admin_update", "pickup_run_rsvps.pickup_run_rsvps_select_own_or_run", "pickup_runs.pickup_runs_insert_admin", "pickup_runs.pickup_runs_select_authenticated", "pickup_runs.pickup_runs_update_admin"]) expect(pol).toContain(p);
    expect(pol).toHaveLength(9);
    const trg = out.filter((l) => l.startsWith("trg|")).map((l) => l.slice(4));
    for (const t of ["pickup_run_results.pickup_results_posted_by", "pickup_run_results.pickup_results_reopened", "pickup_run_results.pickup_results_version_bump", "pickup_run_results.player_game_stats_on_results", "pickup_run_rsvps.analytics_rsvp_change", "pickup_run_rsvps.trg_ensure_player_rating", "pickup_run_rsvps.trg_sync_pickup_run_spots", "pickup_runs.trg_guard_pickup_run_field_photo", "pickup_runs.trg_pickup_runs_block_delete_with_players", "pickup_runs.trg_sync_pickup_runs_legacy_cols"]) expect(trg).toContain(t);
    expect(out.filter((l) => l.startsWith("rls|")).every((l) => l.endsWith("|true"))).toBe(true);
  });

  it("1. the hiding policies are RESTRICTIVE, which is what makes them work next to production's permissive ones", () => {
    const out = sql(`select 'p|' || polrelid::regclass::text || '|' || polpermissive from pg_policy where polname = 'tournament_match_runs_hidden' order by 1;`);
    expect(out.filter((l) => l.startsWith("p|"))).toEqual(["p|pickup_run_results|false", "p|pickup_run_rsvps|false", "p|pickup_run_team_assignments|false", "p|pickup_runs|false"]);
  });

  it("1. a signed in player sees the ordinary game, its result, its teams and their own RSVP, and nothing of the tournament", () => {
    const out = sql(`${setup()}
      insert into public.pickup_run_rsvps (run_id, user_id, status) select run_id, '${PLAYER}', 'confirmed' from public.tournament_match_runs limit 1;
      ${counts("server")}
      select set_config('t.hidden', (select string_agg(run_id::text, ',') from public.tournament_match_runs), false);
      ${asRole("authenticated", PLAYER)} ${counts("player")}
      select 'player-hidden-by-id|' || count(*) from public.pickup_runs where id::text = any (string_to_array(current_setting('t.hidden'), ',')); ${backToServer}`);
    expect(find(out, "server-runs|")).toBe("server-runs|3");
    expect(find(out, "server-results|")).toBe("server-results|3");
    // what the player sees: only the ordinary game, even though a tournament RSVP row exists for them
    expect(find(out, "player-runs|")).toBe("player-runs|1");
    expect(find(out, "player-results|")).toBe("player-results|1");
    expect(find(out, "player-assign|")).toBe("player-assign|10");
    expect(find(out, "player-rsvps|")).toBe("player-rsvps|1");
    expect(find(out, "player-hidden-by-id|")).toBe("player-hidden-by-id|0");
  });

  it("1. without the restrictive policies the same player WOULD see everything (so the test has teeth)", () => {
    const out = sql(`${setup()}
      drop policy tournament_match_runs_hidden on public.pickup_runs;
      drop policy tournament_match_runs_hidden on public.pickup_run_results;
      drop policy tournament_match_runs_hidden on public.pickup_run_team_assignments;
      ${asRole("authenticated", PLAYER)} ${counts("player")} ${backToServer}`);
    expect(find(out, "player-runs|")).toBe("player-runs|3");
    expect(find(out, "player-results|")).toBe("player-results|3");
  });

  it("1. a PERMISSIVE hiding policy would hide nothing (the reason the policies are restrictive)", () => {
    const out = sql(`${setup()}
      drop policy tournament_match_runs_hidden on public.pickup_runs;
      create policy tournament_match_runs_hidden on public.pickup_runs for select to authenticated using (not public.is_tournament_run(id));
      ${asRole("authenticated", PLAYER)} select 'player-runs|' || count(*) from public.pickup_runs; ${backToServer}`);
    expect(find(out, "player-runs|")).toBe("player-runs|3");
  });

  it("1. an admin signed in on the app still sees ordinary games and can work on them; the service role sees and changes everything; anonymous sees nothing", () => {
    const out = sql(`${setup()}
      ${asRole("authenticated", ADMIN)} ${counts("admin")}
      insert into public.pickup_runs (id, title, status, start_at, created_by) values ('${uuid(8400)}', 'new ordinary run', 'planning', now(), '${ADMIN}');
      update public.pickup_runs set title = 'renamed' where id = '${uuid(8400)}';
      select 'admin-new|' || title from public.pickup_runs where id = '${uuid(8400)}';
      ${backToServer}
      set local role service_role; ${counts("service")}
      update public.pickup_runs set title = 'touched' where id in (select run_id from public.tournament_match_runs); ${backToServer}
      ${asRole("anon")} select 'anon-runs|' || count(*) from public.pickup_runs; ${backToServer}`);
    expect(find(out, "admin-runs|")).toBe("admin-runs|1");
    expect(find(out, "admin-new|")).toBe("admin-new|renamed");
    expect(find(out, "service-runs|")).toBe("service-runs|4");
    expect(find(out, "service-results|")).toBe("service-results|3");
    expect(find(out, "anon-runs|")).toBe("anon-runs|0");
  });

  it("1. a player cannot create or change games, as before", () => {
    const err = sqlError(`${setup()} ${asRole("authenticated", PLAYER)} insert into public.pickup_runs (id, title, status, start_at) values ('${uuid(8401)}', 'x', 'open', now());`);
    expect(err).toMatch(/row-level security/);
  });

  it("1. nobody can reach the link table, the day sessions table or the rating results table as a player", () => {
    for (const t of ["tournament_match_runs", "tournament_rating_days", "tournament_match_rating"]) {
      const err = sqlError(`${setup()} ${asRole("authenticated", PLAYER)} select count(*) from public.${t};`);
      expect(err, t).toMatch(/permission denied/);
    }
  });

  it("2. a tournament match that does not count for the season writes NO game stats, so nothing on a profile; counting for the season does", () => {
    const profileSnapshot = `select 'profiles|' || md5(string_agg(p::text, ',' order by p.id)) from public.profiles p;`;
    const out = sql(`${world(scored)} ${profileSnapshot}
      ${sync(1)} ${sync(2)}
      select 'stats-off|' || count(*) from public.player_game_stats;
      select 'card-off|' || count(*) from public.player_card_stats where user_id = '${PLAYER}';
      ${profileSnapshot}
      update public.tournaments set count_for_season = true;
      select 'resync|' || public.tournament_sync_tournament('${TOUR}', '${ADMIN}');
      select 'stats-on|' || count(*) from public.player_game_stats;
      update public.tournaments set count_for_season = false;
      select 'resync|' || public.tournament_sync_tournament('${TOUR}', '${ADMIN}');
      select 'stats-off-again|' || count(*) from public.player_game_stats;`);
    expect(find(out, "stats-off|")).toBe("stats-off|0");
    expect(find(out, "card-off|")).toBe("card-off|0");
    const snaps = out.filter((l) => l.startsWith("profiles|"));
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toBe(snaps[1]); // no profile row changed by scoring
    expect(find(out, "stats-on|")).toBe("stats-on|20");
    expect(find(out, "stats-off-again|")).toBe("stats-off-again|0");
  });

  it("2. an ordinary game still gets its game stats exactly as before", () => {
    const out = sql(`${world({ matches: [] })} ${ordinaryGame()}
      select 'rows|' || public.refresh_player_game_stats('${ORDINARY_RUN}');
      select 'stats|' || count(*) from public.player_game_stats where run_id = '${ORDINARY_RUN}';`);
    expect(find(out, "rows|")).toBe("rows|10");
    expect(find(out, "stats|")).toBe("stats|10");
  });

  it("2. profile counters (wins, losses) are not columns any trigger on results writes: scoring leaves every profile row untouched", () => {
    const triggerSrc = sql(`select 'src|' || replace(string_agg(p.prosrc, ' '), E'\\n', ' ') from pg_proc p where p.proname in ('player_game_stats_results_trigger','pickup_results_posted_by','pickup_results_version_bump','pickup_results_reopened');`);
    expect(triggerSrc.join(" ")).not.toMatch(/update public\.profiles|pickup_wins_count|pickup_losses_count/);
  });

  it("3. creating, editing, clearing and removing hidden games never touches an RSVP, a spot count or an analytics event", () => {
    const out = sql(`${world(scored)} ${ordinaryGame()}
      insert into public.pickup_runs (id, title, status, start_at, capacity, spots_taken) values ('${uuid(8500)}', 'real', 'open', now() + interval '2 days', 24, 0);
      insert into public.pickup_run_rsvps (run_id, user_id, status) values ('${uuid(8500)}', '${PLAYER}', 'confirmed'), ('${uuid(8500)}', '${captain(1)}', 'confirmed');
      delete from public.prod_shape_trigger_log;
      select 'ev-before|' || coalesce((select count(*) from public.analytics_events), 0);
      select 'spots-before|' || sum(spots_taken) from public.pickup_runs where id = '${uuid(8500)}';
      ${sync(1)} ${sync(2)}
      update public.tournament_matches set score_a = 0, score_b = 2 where id = '${match(1)}'; ${sync(1)} ${sync(1)}
      update public.tournament_matches set score_a = null, score_b = null, winner_id = null, completed_at = null where id = '${match(2)}'; ${sync(2)}
      select 'forget|' || public.tournament_forget_matches(array['${match(1)}']::uuid[]);
      select 'unrate|' || public.tournament_unrate_tournament('${TOUR}');
      select 'ev-after|' || coalesce((select count(*) from public.analytics_events), 0);
      select 'spots-after|' || sum(spots_taken) from public.pickup_runs where id = '${uuid(8500)}';
      select 'rsvp-trigger-fires|' || count(*) from public.prod_shape_trigger_log where table_name = 'pickup_run_rsvps';
      select 'runs-trigger-ops|' || string_agg(distinct op, ',') from public.prod_shape_trigger_log where table_name = 'pickup_runs';
      select 'rsvps-total|' || count(*) from public.pickup_run_rsvps;
      select 'hidden-left|' || count(*) from public.pickup_runs where title = 'Tournament match';`);
    expect(find(out, "ev-after|")).toBe(find(out, "ev-before|")!.replace("before", "after"));
    expect(find(out, "spots-after|")).toBe("spots-after|" + find(out, "spots-before|")!.split("|")[1]);
    expect(find(out, "rsvp-trigger-fires|")).toBe("rsvp-trigger-fires|0");
    expect(find(out, "rsvps-total|")).toBe("rsvps-total|2"); // the 2 test RSVPs on the real game only: none were added for a tournament record
    expect(find(out, "hidden-left|")).toBe("hidden-left|0"); // the delete guard did not block removal
  });

  it("3. the delete guard still protects a real game with RSVPs, and a hidden record someone attached an RSVP to never blocks the admin", () => {
    const err = sqlError(`${world({ matches: [] })} ${ordinaryGame()} insert into public.pickup_run_rsvps (run_id, user_id, status) values ('${ORDINARY_RUN}', '${PLAYER}', 'confirmed'); delete from public.pickup_runs where id = '${ORDINARY_RUN}';`);
    expect(err).toMatch(/has RSVPs; cancel it instead of deleting it/);

    const out = sql(`${world(scored)} ${sync(1)}
      insert into public.pickup_run_rsvps (run_id, user_id, status) select run_id, '${PLAYER}', 'declined' from public.tournament_match_runs limit 1;
      select 'forget|' || public.tournament_forget_matches(array['${match(1)}']::uuid[]);
      select 'adj|' || count(*) from public.rating_result_adjustments;
      select 'results|' || count(*) from public.pickup_run_results;
      select 'r|' || score from public.player_ratings where user_id = '${PLAYER}';`);
    expect(find(out, "forget|")).toBe("forget|1");
    expect(find(out, "adj|")).toBe("adj|0");
    expect(find(out, "results|")).toBe("results|0");
    expect(find(out, "r|")).toBe("r|50.00"); // the rating is back even though the record itself was kept

    // the same when the score is cleared (the other place a hidden record is removed)
    const cleared = sql(`${world(scored)} ${sync(1)}
      insert into public.pickup_run_rsvps (run_id, user_id, status) select run_id, '${PLAYER}', 'declined' from public.tournament_match_runs limit 1;
      update public.tournament_matches set score_a = null, score_b = null, winner_id = null, completed_at = null where id = '${match(1)}';
      ${sync(1)}
      select 'adj|' || count(*) from public.rating_result_adjustments;
      select 'r|' || score from public.player_ratings where user_id = '${PLAYER}';`);
    expect(find(cleared, "adj|")).toBe("adj|0");
    expect(find(cleared, "r|")).toBe("r|50.00");
  });

  it("3. the field photo guard and the legacy column sync do not get in the way: a hidden record is created by the server with no photo", () => {
    const out = sql(`${setup()}
      select 'photo|' || count(*) from public.pickup_runs where field_photo_url is not null;
      select 'legacy-insert|' || count(*) from public.prod_shape_trigger_log where trigger_name = 'trg_sync_pickup_runs_legacy_cols' and op = 'INSERT';`);
    expect(find(out, "photo|")).toBe("photo|0");
    // the stand-in for trg_sync_pickup_runs_legacy_cols sees exactly the inserts of the two hidden records and the ordinary game
    expect(Number(find(out, "legacy-insert|")!.split("|")[1])).toBeGreaterThanOrEqual(2);
  });

  it("3. unscoring a match whose tournament was never rated leaves nothing and fires nothing", () => {
    const w: W = { rated: false, season: false, matches: [{ n: 1, sa: 3, sb: 1 }] };
    const out = sql(`${world(w)} delete from public.prod_shape_trigger_log; ${sync(1)} select 'fires|' || count(*) from public.prod_shape_trigger_log;`);
    expect(sync_json(out, 1).status).toBe("off");
    expect(find(out, "fires|")).toBe("fires|0");
  });
});

void [BYSTANDER, players, rostered];
