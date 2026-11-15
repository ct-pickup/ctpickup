import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => ({ ...fakeClient(h.db as never), auth: { getUser: async () => ({ data: { user: { id: "admin1" } }, error: null }) } }),
  };
});

import { POST } from "../../app/api/admin/tournaments/bracket/route";
import { groupsNeedConfirm, groupsWipeMessage, knockoutNeedsConfirm, knockoutWipeMessage, summarizeWipe } from "../../lib/tournament/generateGuard";

/**
 * 3. Generate Groups and Generate Knockout delete matches. They must refuse (409 confirm_required) unless the request says
 * confirm_wipe: true, and nothing may be deleted by a refused request. 8 paid teams, captains only (min roster 1).
 */
const T = "tour-1";
const TEAMS = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);

function seeded(o: { rated?: boolean } = {}): FakeDb {
  const db = makeDb({
    profiles: [{ id: "admin1", is_admin: true }],
    tournaments: [{ id: T, slug: "fall-classic", title: "Fall Classic", is_active: true, min_roster_players: 1, rated: o.rated ?? false, count_for_season: false }],
    tournament_captains: TEAMS.map((id, i) => ({ id, tournament_id: T, status: "payment_received", team_name: `Team ${i + 1}`, captain_name: `Captain ${i + 1}`, user_id: `u${i + 1}` })),
    tournament_roster: [],
    tournament_groups: [],
    tournament_group_members: [],
    tournament_matches: [],
    tournament_match_goals: [],
    user_push_devices: [],
  });
  db.mintIds = ["tournament_groups", "tournament_matches", "tournament_group_members"];
  db.rpcs.tournament_forget_matches = (args) => {
    const ids = args.p_match_ids as string[];
    forgot.push({ ids, stillThere: ids.map((id) => db.tables.tournament_matches!.some((r) => r.id === id)) });
    return { data: ids.length, error: null };
  };
  return db;
}
let forgot: { ids: string[]; stillThere: boolean[] }[] = [];
const tables = () => (h.db as FakeDb).tables;
const matches = () => tables().tournament_matches!;
const call = async (body: Record<string, unknown>) => {
  const res = await POST(new Request("https://site.test/api/admin/tournaments/bracket", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: T, ...body }) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const snapshot = () => JSON.stringify([matches(), tables().tournament_groups, tables().tournament_group_members]);
const score = (id: string, a = 2, b = 1) => call({ action: "log_score", match_id: id, score_a: a, score_b: b });

beforeEach(() => {
  h.db = seeded();
  forgot = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe("the messages are plain and say how many scored matches go", () => {
  it("counts only matches that have a result, and says so", () => {
    const s = summarizeWipe([{ stage: "group", completed_at: "x" }, { stage: "group", completed_at: "x" }, { stage: "group" }, { stage: "group", is_bye: true, completed_at: "x" }], 2);
    expect(s).toMatchObject({ total_matches: 4, scored_matches: 2, groups: 2 });
    expect(groupsWipeMessage(s)).toMatch(/^This deletes 2 scored matches and cannot be undone\./);
    expect(groupsWipeMessage(summarizeWipe([{ stage: "group", completed_at: "x" }], 1))).toMatch(/^This deletes 1 scored match and cannot be undone\./);
    expect(groupsWipeMessage(summarizeWipe([{ stage: "group" }, { stage: "group" }], 1))).toMatch(/^This deletes the 2 existing matches and the groups and cannot be undone\. Nothing has a score yet\./);
  });

  it("Generate Groups needs a yes when anything exists; Generate Knockout only when a knockout match has a result", () => {
    expect(groupsNeedConfirm(summarizeWipe([], 0))).toBe(false);
    expect(groupsNeedConfirm(summarizeWipe([], 2))).toBe(true);
    expect(groupsNeedConfirm(summarizeWipe([{ stage: "group" }], 0))).toBe(true);
    expect(knockoutNeedsConfirm(summarizeWipe([{ stage: "group", completed_at: "x" }], 2))).toBe(false); // group scores are not touched
    expect(knockoutNeedsConfirm(summarizeWipe([{ stage: "sf" }], 2))).toBe(false); // an unscored knockout deletes no result
    expect(knockoutNeedsConfirm(summarizeWipe([{ stage: "sf", completed_at: "x" }], 2))).toBe(true);
    expect(knockoutWipeMessage(summarizeWipe([{ stage: "sf", completed_at: "x" }, { stage: "final", completed_at: "y" }], 2))).toMatch(/^This deletes 2 scored matches of the knockout and cannot be undone\./);
  });
});

describe("3. Generate Groups", () => {
  it("the first time, with nothing to delete, it just works", async () => {
    const r = await call({ action: "generate" });
    expect(r.status).toBe(200);
    expect(matches().length).toBe(12); // 2 groups of 4: 6 matches each
    expect(forgot).toEqual([]);
  });

  it("REFUSES to run again without confirm: 409, the plain message, and nothing at all is deleted", async () => {
    await call({ action: "generate" });
    const g1 = matches().find((m) => m.group_name === "A")!;
    expect((await score(String(g1.id))).status).toBe(200);
    expect((await score(String(matches()[1]!.id), 0, 0)).status).toBe(200);
    const before = snapshot();
    const r = await call({ action: "generate" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("confirm_required");
    expect(r.json.needs_confirm).toBe(true);
    expect(String(r.json.error)).toMatch(/^This deletes 2 scored matches and cannot be undone\./);
    expect(r.json.scored_matches).toBe(2);
    expect(snapshot()).toBe(before);
    expect(forgot).toEqual([]);
  });

  it("only exactly confirm_wipe: true counts (not the text true, not 1, not confirm_reset)", async () => {
    await call({ action: "generate" });
    const before = snapshot();
    for (const bad of [{ confirm_wipe: "true" }, { confirm_wipe: 1 }, { confirm_wipe: false }, { confirm_reset: true }, { confirm: true }]) {
      expect((await call({ action: "generate", ...bad })).status).toBe(409);
    }
    expect(snapshot()).toBe(before);
  });

  it("a groups only leftover (no matches) also needs a yes", async () => {
    tables().tournament_groups!.push({ id: "g-old", tournament_id: T, group_name: "A" });
    const r = await call({ action: "generate" });
    expect(r.status).toBe(409);
    expect(String(r.json.error)).toMatch(/groups/);
  });

  it("WITH confirm it proceeds: the old matches, scores and standings are gone and a fresh bracket exists", async () => {
    await call({ action: "generate" });
    const oldIds = matches().map((m) => String(m.id));
    await score(oldIds[0]!, 3, 0);
    const r = await call({ action: "generate", confirm_wipe: true });
    expect(r.status).toBe(200);
    expect(matches().length).toBe(12);
    expect(matches().some((m) => oldIds.includes(String(m.id)))).toBe(false);
    expect(matches().every((m) => m.completed_at == null && m.score_a == null)).toBe(true);
    expect(tables().tournament_group_members!.every((m) => m.points === 0)).toBe(true);
  });

  it("a request that fails its own checks (too few teams) is still a plain 400 first, not a confirm question", async () => {
    await call({ action: "generate" });
    tables().tournament_captains = tables().tournament_captains!.slice(0, 5);
    const r = await call({ action: "generate" });
    expect(r.status).toBe(400);
    expect(String(r.json.error)).toMatch(/Need 8-12 paid teams/);
  });
});

describe("3. a rated tournament still takes its ratings back out when the delete is confirmed", () => {
  it("refused: the take-back is not called and nothing is touched; confirmed: it is called with every old match, while they still exist", async () => {
    h.db = seeded({ rated: true });
    await call({ action: "generate" });
    const oldIds = matches().map((m) => String(m.id));
    await score(oldIds[0]!, 2, 1);
    forgot = [];
    const before = snapshot();
    expect((await call({ action: "generate" })).status).toBe(409);
    expect(forgot).toEqual([]);
    expect(snapshot()).toBe(before);

    expect((await call({ action: "generate", confirm_wipe: true })).status).toBe(200);
    expect(forgot).toHaveLength(1);
    expect(forgot[0]!.ids.sort()).toEqual([...oldIds].sort());
    expect(forgot[0]!.stillThere.every(Boolean)).toBe(true);
  });
});

describe("3. Generate Knockout", () => {
  async function toKnockout() {
    await call({ action: "generate" });
    for (const m of [...matches()]) await score(String(m.id), 2, 1);
    expect((await call({ action: "generate_knockout" })).status).toBe(200);
  }
  const knockout = () => matches().filter((m) => m.stage === "sf" || m.stage === "qf" || m.stage === "final");

  it("the first time, and again while no knockout match has a result, it just works", async () => {
    await toKnockout();
    expect(knockout().length).toBe(2);
    expect((await call({ action: "generate_knockout" })).status).toBe(200);
    expect(knockout().length).toBe(2);
  });

  it("REFUSES without confirm once a knockout match has a result, deleting nothing, and says how many", async () => {
    await toKnockout();
    const sf = knockout().sort((a, b) => Number(a.match_number) - Number(b.match_number));
    await score(String(sf[0]!.id), 1, 0);
    const before = snapshot();
    const r = await call({ action: "generate_knockout" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("confirm_required");
    expect(String(r.json.error)).toMatch(/^This deletes 1 scored match of the knockout and cannot be undone\./);
    expect(snapshot()).toBe(before);
  });

  it("WITH confirm it proceeds, recreating the knockout from the group tables", async () => {
    await toKnockout();
    const sf = knockout()[0]!;
    await score(String(sf.id), 1, 0);
    const oldId = String(sf.id);
    const r = await call({ action: "generate_knockout", confirm_wipe: true });
    expect(r.status).toBe(200);
    expect(knockout().length).toBe(2);
    expect(knockout().some((m) => String(m.id) === oldId)).toBe(false);
    expect(knockout().every((m) => m.completed_at == null)).toBe(true);
    expect(matches().filter((m) => m.stage === "group").every((m) => m.completed_at != null)).toBe(true); // group scores untouched
  });

  it("a confirmed request whose own checks fail (fewer than 2 groups) deletes nothing: the old knockout is still there", async () => {
    await toKnockout();
    await score(String(knockout()[0]!.id), 1, 0);
    tables().tournament_groups = tables().tournament_groups!.slice(0, 1);
    const before = JSON.stringify(knockout());
    const r = await call({ action: "generate_knockout", confirm_wipe: true });
    expect(r.status).toBe(400);
    expect(JSON.stringify(knockout())).toBe(before);
  });

  it("a rated tournament takes the old knockout's ratings back out first, while the matches exist", async () => {
    h.db = seeded({ rated: true });
    await toKnockout();
    const old = knockout().map((m) => String(m.id));
    await score(old[0]!, 1, 0);
    forgot = [];
    expect((await call({ action: "generate_knockout" })).status).toBe(409);
    expect(forgot).toEqual([]);
    expect((await call({ action: "generate_knockout", confirm_wipe: true })).status).toBe(200);
    expect(forgot).toHaveLength(1);
    expect(forgot[0]!.ids.sort()).toEqual([...old].sort());
    expect(forgot[0]!.stillThere.every(Boolean)).toBe(true);
  });
});

describe("3. the admin app asks in plain words before it sends the yes", () => {
  const screen = readFileSync(new URL("../../mobile/app/(tabs)/admin/tournament-bracket.tsx", import.meta.url), "utf8");

  it("the first press never carries the yes; only the destructive Delete and generate button does", () => {
    expect(screen).toMatch(/detail\?\.code === "confirm_required"/);
    expect(screen).toMatch(/"Delete and generate", style: "destructive"/);
    expect(screen).toMatch(/\{ text: "Cancel", style: "cancel" \},\s*\{ text: "Delete and generate"/);
    // the confirm flag is only added by the second call
    expect(screen).toMatch(/runGenerate\(action, busyKey, doneText, true\)/);
    expect(screen).toMatch(/confirmWipe \? \{ confirm_wipe: true \} : undefined/);
    expect((screen.match(/\{ confirm_wipe: true \}/g) ?? []).length).toBe(1);
  });

  it("there is no website screen that generates a bracket, so the route is the one place the rule is enforced", () => {
    for (const f of ["app/admin/tournament/page.tsx", "app/admin/tournament/actions.ts"]) {
      expect(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")).not.toMatch(/generate|bracket/i);
    }
  });
});
