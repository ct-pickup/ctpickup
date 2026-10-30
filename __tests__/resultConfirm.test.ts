import { describe, expect, it } from "vitest";

import { captainOf, confirmResult, loadConfirmState } from "@/lib/results/resultConfirm";
import { fakeClient, makeDb } from "./helpers/fakeSupabase";

const RUN = "00000000-0000-4000-8000-000000000001";
const HOST = "host";
const t = (n: number) => new Date(Date.UTC(2026, 9, 28, 12, 0, n)).toISOString();

function world(over: { result?: Record<string, unknown> | null; confirmations?: Record<string, unknown>[] } = {}) {
  return makeDb({
    pickup_runs: [{ id: RUN, created_by: HOST }],
    pickup_run_results: over.result === null ? [] : [{ run_id: RUN, total_teams: 2, winning_team: "A", score_a: 5, score_b: 3, result_version: 1, verified_at: null, ...(over.result ?? {}) }],
    pickup_run_team_assignments: [
      { run_id: RUN, user_id: "a1", team: "A", created_at: t(1) }, { run_id: RUN, user_id: "b1", team: "B", created_at: t(2) },
      { run_id: RUN, user_id: "a2", team: "A", created_at: t(3) }, { run_id: RUN, user_id: "b2", team: "B", created_at: t(4) },
      { run_id: RUN, user_id: HOST, team: "A", created_at: t(0) },
    ],
    pickup_run_result_confirmations: over.confirmations ?? [],
  });
}
const client = (db: ReturnType<typeof world>) => fakeClient(db) as never;

describe("captains", () => {
  it("the first player named on the team, never the host", () => {
    const rows = [{ user_id: "z", team: "A", created_at: t(5) }, { user_id: HOST, team: "A", created_at: t(0) }, { user_id: "m", team: "A", created_at: t(5) }];
    expect(captainOf(rows, "A", HOST)).toBe("m"); // same time: lower id first
    expect(captainOf(rows, "B", HOST)).toBeNull();
    expect(captainOf([{ user_id: HOST, team: "A", created_at: t(0) }], "A", HOST)).toBeNull();
  });
});

describe("confirmation state", () => {
  it("none without a result; unavailable when the migration is not applied", async () => {
    expect((await loadConfirmState(client(world({ result: null })), RUN, "a1")).state).toBe("none");
    const old = world({ result: {} });
    delete (old.tables.pickup_run_results![0] as Record<string, unknown>).result_version;
    expect((await loadConfirmState(client(old), RUN, "a1")).state).toBe("unavailable");
    const noTable = world();
    noTable.failTables.pickup_run_result_confirmations = 'relation "pickup_run_result_confirmations" does not exist';
    expect((await loadConfirmState(client(noTable), RUN, "a1")).state).toBe("unavailable");
  });
  it("waiting, and only a captain can confirm", async () => {
    const db = world();
    expect(await loadConfirmState(client(db), RUN, "a1")).toMatchObject({ state: "waiting", my_team: "A", can_confirm: true, confirmed_teams: [] });
    expect(await loadConfirmState(client(db), RUN, "b1")).toMatchObject({ my_team: "B", can_confirm: true });
    expect(await loadConfirmState(client(db), RUN, "a2")).toMatchObject({ my_team: null, can_confirm: false });
    expect(await loadConfirmState(client(db), RUN, HOST)).toMatchObject({ my_team: null, can_confirm: false });
  });
  it("only confirmations of the current version count", async () => {
    const db = world({ result: { result_version: 2 }, confirmations: [{ run_id: RUN, team: "A", result_version: 1 }, { run_id: RUN, team: "B", result_version: 2 }] });
    expect(await loadConfirmState(client(db), RUN, "a1")).toMatchObject({ state: "waiting", confirmed_teams: ["B"], can_confirm: true });
  });
  it("verified once both teams confirmed and the database marked it", async () => {
    const db = world({ result: { verified_at: t(9) }, confirmations: [{ run_id: RUN, team: "A", result_version: 1 }, { run_id: RUN, team: "B", result_version: 1 }] });
    expect(await loadConfirmState(client(db), RUN, "a1")).toMatchObject({ state: "verified", can_confirm: false });
  });
});

describe("confirming", () => {
  it("a captain confirms for their team; confirming twice is fine", async () => {
    const db = world();
    const r = await confirmResult(client(db), RUN, "a1");
    expect(r).toMatchObject({ ok: true, state: { confirmed_teams: ["A"], can_confirm: false } });
    expect(db.tables.pickup_run_result_confirmations).toHaveLength(1);
    expect(db.tables.pickup_run_result_confirmations![0]).toMatchObject({ run_id: RUN, team: "A", result_version: 1, confirmed_by: "a1" });
    await confirmResult(client(db), RUN, "a1");
    expect(db.tables.pickup_run_result_confirmations).toHaveLength(1);
  });
  it("refuses a player who is not a captain, the host, a missing result and a three-team game", async () => {
    const db = world();
    expect(await confirmResult(client(db), RUN, "a2")).toMatchObject({ ok: false, status: 403 });
    expect(await confirmResult(client(db), RUN, HOST)).toMatchObject({ ok: false, status: 403 });
    expect(await confirmResult(client(world({ result: null })), RUN, "a1")).toMatchObject({ ok: false, status: 404 });
    expect(await confirmResult(client(world({ result: { total_teams: 3 } })), RUN, "a1")).toMatchObject({ ok: false, status: 400 });
    expect(db.tables.pickup_run_result_confirmations).toHaveLength(0);
  });
});

import { confirmLine } from "../mobile/lib/resultConfirmCore";

describe("recap line", () => {
  const base = { result: null, my_team: null, can_confirm: false } as const;
  it("says where confirmation stands, in plain words", () => {
    expect(confirmLine({ ...base, state: "none", confirmed_teams: [] })).toBeNull();
    expect(confirmLine({ ...base, state: "unavailable", confirmed_teams: [] })).toBeNull();
    expect(confirmLine({ ...base, state: "waiting", confirmed_teams: [] })).toBe("Waiting for both teams to confirm the score.");
    expect(confirmLine({ ...base, state: "waiting", confirmed_teams: ["B"] })).toBe("Team B confirmed. Waiting for Team A.");
    expect(confirmLine({ ...base, state: "verified", confirmed_teams: ["A", "B"] })).toBe("Confirmed by both teams.");
  });
});
