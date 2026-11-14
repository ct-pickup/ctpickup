import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeClient, makeDb } from "../helpers/fakeSupabase";
import { loadGameLog } from "../../lib/records/gameLog";
import { loadPlayerRecord, loadRecordSummaries } from "../../lib/records/playerRecord";
import { uncountedTournamentRunIds } from "../../lib/tournament/hiddenRuns";

/**
 * A tournament match has a hidden game record. Records, the game log and team balance read results and team lists for ALL runs, so
 * they must leave a hidden record out unless its tournament counts for the season.
 */
function world() {
  const result = (run: string, win: string) => ({ run_id: run, winning_team: win, total_teams: 2, created_at: "2026-11-10T20:00:00Z", player_of_day: null, defender_of_day: null, midfielder_of_day: null, attacker_of_day: null, goalie_of_the_day: null, score_a: null, score_b: null });
  const db = makeDb({
    pickup_runs: ["real", "t-off", "t-on"].map((id) => ({ id, title: id, location_text: null, start_at: "2026-11-10T20:00:00Z", status: id === "real" ? "completed" : "canceled", tier_session_id: null })),
    pickup_run_team_assignments: ["real", "t-off", "t-on"].flatMap((run) => [{ run_id: run, user_id: "u1", team: "A" }, { run_id: run, user_id: "u2", team: "B" }]),
    pickup_run_results: [result("real", "A"), result("t-off", "A"), result("t-on", "A")],
    pickup_run_rsvps: [],
    tournament_match_runs: [{ match_id: "m-off", run_id: "t-off" }, { match_id: "m-on", run_id: "t-on" }],
    tournament_matches: [{ id: "m-off", tournament_id: "T-off" }, { id: "m-on", tournament_id: "T-on" }],
    tournaments: [{ id: "T-off", count_for_season: false, rated: true }, { id: "T-on", count_for_season: true, rated: true }],
    profiles: [{ id: "u1", first_name: "A", last_name: "One" }, { id: "u2", first_name: "B", last_name: "Two" }],
    points_events: [],
    rating_events: [],
  });
  return { db, admin: fakeClient(db) as unknown as SupabaseClient };
}

describe("the hidden records of tournaments that do not count for the season stay out of every record", () => {
  it("finds exactly the runs of tournaments that do not count", async () => {
    const { admin } = world();
    expect([...(await uncountedTournamentRunIds(admin, ["real", "t-off", "t-on"]))]).toEqual(["t-off"]);
    expect([...(await uncountedTournamentRunIds(admin))]).toEqual(["t-off"]);
    expect([...(await uncountedTournamentRunIds(admin, []))]).toEqual([]);
  });

  it("a database without the tables hides nothing", async () => {
    const { db, admin } = world();
    db.failTables.tournament_match_runs = "relation \"public.tournament_match_runs\" does not exist";
    expect([...(await uncountedTournamentRunIds(admin, ["t-off"]))]).toEqual([]);
  });

  it("a link whose match cannot be found is hidden: never show what cannot be explained", async () => {
    const { db, admin } = world();
    db.tables.tournament_matches = [];
    expect([...(await uncountedTournamentRunIds(admin, ["t-on", "t-off"]))].sort()).toEqual(["t-off", "t-on"]);
  });

  it("a link whose tournament cannot be found is hidden too", async () => {
    const { db, admin } = world();
    db.tables.tournaments = [];
    expect([...(await uncountedTournamentRunIds(admin, ["t-on", "t-off"]))].sort()).toEqual(["t-off", "t-on"]);
  });

  it("a tournament whose count_for_season is empty (the column has no value) counts as not counted", async () => {
    const { db, admin } = world();
    db.tables.tournaments = [{ id: "T-off", count_for_season: null }, { id: "T-on", count_for_season: true }];
    expect([...(await uncountedTournamentRunIds(admin, ["t-on", "t-off"]))]).toEqual(["t-off"]);
  });

  it("the player record counts the ordinary game and the counted tournament, not the other tournament", async () => {
    const { admin } = world();
    const rec = await loadPlayerRecord(admin, "u1", Date.parse("2026-11-14T12:00:00Z"));
    expect(rec.log.map((g) => g.run_id).sort()).toEqual(["real", "t-on"]);
    expect(rec.wins).toBe(2);
  });

  it("the record summaries for one player and for everyone agree", async () => {
    const { admin } = world();
    const one = await loadRecordSummaries(admin, ["u1"]);
    const all = await loadRecordSummaries(admin);
    expect(one.get("u1")!.wins).toBe(2);
    expect(all.get("u1")!.wins).toBe(2);
    expect(all.get("u2")!.losses).toBe(2);
  });

  it("the game log lists the same two games", async () => {
    const { admin } = world();
    const log = await loadGameLog(admin, "u1", Date.parse("2026-11-14T12:00:00Z"));
    expect(log.all.map((g) => g.run_id).sort()).toEqual(["real", "t-on"]);
  });
});
