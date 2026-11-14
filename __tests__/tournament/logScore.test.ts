import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeClient, makeDb, type FakeDb } from "../helpers/fakeSupabase";
import { logMatchScore, startMatch } from "../../lib/tournament/logScore";

const T = "tour-1";

const row = (o: Record<string, unknown>) => ({
  tournament_id: T,
  group_name: null,
  team_a_id: null,
  team_b_id: null,
  score_a: null,
  score_b: null,
  winner_id: null,
  is_bye: false,
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  ...o,
});

/** The fake database does not mint ids on insert, so give new rows the id the server would. */
function mintIds(db: FakeDb) {
  for (const r of db.tables.tournament_matches ?? []) if (!r.id) r.id = `${r.stage}-${r.match_number}`;
}

function setup() {
  const db = makeDb({
    tournament_matches: [
      row({ id: "sf1", stage: "sf", match_number: 1000, team_a_id: "A", team_b_id: "B" }),
      row({ id: "sf2", stage: "sf", match_number: 1001, team_a_id: "C", team_b_id: "D" }),
    ],
    tournament_match_goals: [],
    tournament_mvp_votes: [],
    tournament_group_members: [],
  });
  const admin = fakeClient(db) as unknown as SupabaseClient;
  const match = (id: string) => (db.tables.tournament_matches ?? []).find((r) => r.id === id)!;
  const log = async (match_id: string, score_a: unknown, score_b: unknown, extra: Record<string, unknown> = {}) => {
    const r = await logMatchScore(admin, { tournament_id: T, match_id, score_a, score_b, ...extra });
    mintIds(db);
    return r;
  };
  return { db, admin, match, log };
}

describe("one admin action saves the score and moves the bracket on", () => {
  it("sets the score, the winner and completed_at, then fills the final once both semi-finals are in", async () => {
    const { db, match, log } = setup();
    const r1 = await log("sf1", 2, 1);
    expect(r1).toMatchObject({ ok: true, winner_id: "A", won_on_penalties: false, first_completion: true });
    expect(match("sf1")).toMatchObject({ score_a: 2, score_b: 1, winner_id: "A" });
    expect(match("sf1").completed_at).toBeTruthy();
    expect(db.tables.tournament_matches).toHaveLength(2);

    const r2 = await log("sf2", 0, 3);
    expect(r2).toMatchObject({ ok: true, winner_id: "D", advanced: { created: 1, updated: 0, removed: 0 } });
    const final = (db.tables.tournament_matches ?? []).find((r) => r.stage === "final");
    expect(final).toMatchObject({ team_a_id: "A", team_b_id: "D", match_number: 3000, completed_at: null, winner_id: null, tournament_id: T });
  });

  it("a level knockout score without a penalty winner is refused and nothing is written", async () => {
    const { db, match, log } = setup();
    const r = await log("sf1", 1, 1);
    expect(r).toMatchObject({ ok: false, status: 400, code: "penalty_winner_required" });
    expect(match("sf1")).toMatchObject({ score_a: null, score_b: null, winner_id: null, completed_at: null });
    expect(db.tables.tournament_matches).toHaveLength(2);
  });

  it("a level knockout score with a penalty winner is stored and advances that team", async () => {
    const { db, match, log } = setup();
    expect(await log("sf1", 2, 2, { winner_id: "B" })).toMatchObject({ ok: true, winner_id: "B", won_on_penalties: true });
    expect(match("sf1")).toMatchObject({ score_a: 2, score_b: 2, winner_id: "B" });
    await log("sf2", 1, 0);
    expect((db.tables.tournament_matches ?? []).find((r) => r.stage === "final")).toMatchObject({ team_a_id: "B", team_b_id: "C" });
  });

  it("editing a result that changes the winner rewrites the final; a played final needs confirmation first", async () => {
    const { db, match, log } = setup();
    await log("sf1", 2, 1);
    await log("sf2", 0, 3);
    const final = () => (db.tables.tournament_matches ?? []).find((r) => r.stage === "final")!;

    // Unplayed final: the edit just updates who plays.
    expect(await log("sf1", 0, 1)).toMatchObject({ ok: true, advanced: { created: 0, updated: 1, removed: 0 } });
    expect(final()).toMatchObject({ team_a_id: "B", team_b_id: "D" });

    // Play the final, then flip a semi-final again.
    expect(await log("final-3000", 2, 0)).toMatchObject({ ok: true, winner_id: "B" });
    const before = JSON.stringify(db.tables.tournament_matches);
    const blocked = await log("sf1", 3, 0);
    expect(blocked).toMatchObject({ ok: false, status: 409, code: "confirm_reset" });
    expect((blocked as { affected: string[] }).affected).toEqual(["Final 1"]);
    expect(JSON.stringify(db.tables.tournament_matches)).toBe(before);
    expect(match("sf1")).toMatchObject({ score_a: 0, score_b: 1 });

    // With the confirmation the final is reset to the new pairing with no result.
    expect(await log("sf1", 3, 0, { confirm_reset: true })).toMatchObject({ ok: true });
    expect(final()).toMatchObject({ team_a_id: "A", team_b_id: "D", score_a: null, score_b: null, winner_id: null, completed_at: null });
  });

  it("re-saving the same winner with another score leaves the final alone, even after it was played", async () => {
    const { db, log } = setup();
    await log("sf1", 2, 1);
    await log("sf2", 0, 3);
    await log("final-3000", 1, 0);
    expect(await log("sf1", 4, 0)).toMatchObject({ ok: true, advanced: { created: 0, updated: 0, removed: 0 } });
    expect((db.tables.tournament_matches ?? []).find((r) => r.stage === "final")).toMatchObject({ score_a: 1, score_b: 0 });
  });

  it("keeps the original completed_at on an edit and only reports a first completion once", async () => {
    const { match, log } = setup();
    await log("sf1", 2, 1);
    const stamp = match("sf1").completed_at;
    const again = await log("sf1", 3, 1);
    expect(again).toMatchObject({ ok: true, first_completion: false });
    expect(match("sf1").completed_at).toBe(stamp);
  });

  it("replaces the goal list on every save", async () => {
    const { db, log } = setup();
    await log("sf1", 2, 1, { goals: [{ team_id: "A", scorer_name: "Sam R.", minute: 3 }, { team_id: "A", scorer_name: "Lee K.", minute: 40 }] });
    expect(db.tables.tournament_match_goals).toHaveLength(2);
    await log("sf1", 2, 1, { goals: [{ team_id: "A", scorer_name: "Sam R.", minute: 3 }] });
    expect(db.tables.tournament_match_goals).toHaveLength(1);
  });

  it("unknown match is a 404 and a bye cannot be scored", async () => {
    const { db, log } = setup();
    expect(await log("nope", 1, 0)).toMatchObject({ ok: false, status: 404 });
    db.tables.tournament_matches!.push(row({ id: "bye1", stage: "sf", match_number: 1002, team_a_id: "E", is_bye: true }));
    expect(await log("bye1", 1, 0)).toMatchObject({ ok: false, status: 400, code: "bad_match" });
  });
});

describe("group stage standings follow the score, including edits", () => {
  function groupSetup() {
    const db = makeDb({
      tournament_matches: [row({ id: "g1", stage: "group", group_name: "A", match_number: 1, team_a_id: "T1", team_b_id: "T2" })],
      tournament_match_goals: [],
      tournament_group_members: [
        { id: "m1", tournament_id: T, group_id: "G", team_id: "T1", wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
        { id: "m2", tournament_id: T, group_id: "G", team_id: "T2", wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
      ],
    });
    const admin = fakeClient(db) as unknown as SupabaseClient;
    const member = (team: string) => db.tables.tournament_group_members!.find((r) => r.team_id === team)!;
    return { db, admin, member };
  }

  it("a group match may end level, and re-logging it re-does the table instead of adding to it", async () => {
    const { admin, member } = groupSetup();
    expect(await logMatchScore(admin, { tournament_id: T, match_id: "g1", score_a: 2, score_b: 1 })).toMatchObject({ ok: true, winner_id: "T1" });
    expect(member("T1")).toMatchObject({ wins: 1, points: 3, goals_for: 2, goal_difference: 1 });
    expect(member("T2")).toMatchObject({ losses: 1, points: 0 });

    expect(await logMatchScore(admin, { tournament_id: T, match_id: "g1", score_a: 1, score_b: 1 })).toMatchObject({ ok: true, winner_id: null, won_on_penalties: false });
    expect(member("T1")).toMatchObject({ wins: 0, draws: 1, losses: 0, points: 1, goals_for: 1, goals_against: 1 });
    expect(member("T2")).toMatchObject({ wins: 0, draws: 1, losses: 0, points: 1 });

    expect(await logMatchScore(admin, { tournament_id: T, match_id: "g1", score_a: 0, score_b: 3 })).toMatchObject({ ok: true, winner_id: "T2" });
    expect(member("T1")).toMatchObject({ wins: 0, losses: 1, points: 0, goal_difference: -3 });
    expect(member("T2")).toMatchObject({ wins: 1, points: 3, goal_difference: 3 });
  });

  it("warns when a group score changes after the knockout was generated", async () => {
    const { db, admin } = groupSetup();
    db.tables.tournament_matches!.push(row({ id: "sf1", stage: "sf", match_number: 1000, team_a_id: "T1", team_b_id: "T2" }));
    const r = await logMatchScore(admin, { tournament_id: T, match_id: "g1", score_a: 1, score_b: 0 });
    expect(r).toMatchObject({ ok: true });
    expect((r as { warnings: string[] }).warnings[0]).toMatch(/Knockout/);
  });
});

describe("starting a match", () => {
  it("marks it in progress once, and refuses a finished or one-team match", async () => {
    const { db, admin, log } = setup();
    const first = await startMatch(admin, T, "sf1");
    expect(first).toMatchObject({ ok: true });
    const again = await startMatch(admin, T, "sf1");
    expect(again).toMatchObject({ ok: true, started_at: (first as { started_at: string }).started_at });
    await log("sf1", 1, 0);
    expect(await startMatch(admin, T, "sf1")).toMatchObject({ ok: false, status: 409 });
    db.tables.tournament_matches!.push(row({ id: "bye1", stage: "sf", match_number: 1002, team_a_id: "E", is_bye: true }));
    expect(await startMatch(admin, T, "bye1")).toMatchObject({ ok: false, status: 400 });
    expect(await startMatch(admin, "other-tournament", "sf2")).toMatchObject({ ok: false, status: 400 });
  });
});
