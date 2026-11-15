import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown, user: "admin1", activationChanges: 0, expo: [] as unknown[][] }));

vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/admin/sync/enqueueRevalidate", () => ({ enqueueRevalidateAndRun: async () => undefined }));
vi.mock("@/lib/admin/surfaceHealth", () => ({ recordTournamentActivationChange: async () => { h.activationChanges += 1; } }));
vi.mock("@/lib/admin/requireAdmin", () => ({
  requireAdminBearer: async () => (h.user === "admin1" ? { ok: true, userId: "admin1" } : { ok: false, response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) }),
}));
vi.mock("@/lib/admin/publishLayer", () => ({ isPublishLayerAvailable: async () => false }));
vi.mock("@/lib/admin/publish/executePublication", () => ({ executePublication: async () => ({}) }));
vi.mock("@/lib/pickup/autoRunCheckpoints", () => ({ processAutoPickupRun: async () => ({}) }));
vi.mock("@/lib/pickup/hubPromote", () => ({ promotePickupRunToHub: async () => ({}) }));
vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient: client } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => ({ ...client(h.db as never), auth: { getUser: async () => ({ data: { user: { id: h.user } }, error: null }) } }),
    getSupabaseAnon: () => ({ auth: { getUser: async () => ({ data: { user: { id: h.user } }, error: null }) } }),
  };
});

import { POST as operatorPost } from "../../app/api/admin/operator/route";
import { GET as adminListGet } from "../../app/api/admin/tournaments/route";
import { GET as bracketGet, POST as bracketPost } from "../../app/api/admin/tournaments/bracket/route";
import { finalHasResult, finishTournament, isFinished } from "../../lib/tournament/finishTournament";
import { loadTournamentList } from "../../lib/tournament/tournamentList";
import { homeTournament, listedTournaments, parseTournamentList } from "../../mobile/lib/tournamentEntryCore";
import { makeLiveConfirmText } from "../../shared/tournamentMakeLive";

const T = "tour-1";
const NOW = Date.parse("2026-11-21T22:00:00Z");

function world(o: { final?: "done" | "none" | "bye"; active?: boolean; canceled?: boolean; slug?: string } = {}): FakeDb {
  const final = o.final ?? "done";
  const db = makeDb({
    profiles: [{ id: "admin1", is_admin: true, approved: true }, { id: "p1", approved: true }, { id: "p2", approved: true }, { id: "p3", approved: true }, { id: "p4", approved: false }],
    tournaments: [{ id: T, slug: o.slug ?? "fall-classic", title: "Fall Classic", is_active: o.active ?? true, canceled_at: o.canceled ? "2026-11-01T00:00:00Z" : null, start_at: "2026-11-21T15:00:00Z", venue: "Field", service_region: null, rated: false, count_for_season: false }],
    tournament_captains: [{ id: "c1", tournament_id: T, status: "payment_received", user_id: "u1", team_name: "A", captain_name: "A" }],
    tournament_roster: [],
    tournament_groups: [],
    tournament_group_members: [],
    tournament_payments: [{ id: "pay1", tournament_id: T, status: "captured", amount_cents: 50000 }],
    tournament_matches: [
      { id: "g1", tournament_id: T, stage: "group", match_number: 1, team_a_id: "c1", team_b_id: "c2", score_a: 2, score_b: 0, winner_id: "c1", is_bye: false, started_at: null, completed_at: "2026-11-21T16:00:00Z" },
      ...(final === "none" ? [] : [{ id: "f", tournament_id: T, stage: "final", match_number: 3000, team_a_id: "c1", team_b_id: "c2", score_a: final === "done" ? 1 : null, score_b: final === "done" ? 0 : null, winner_id: final === "done" ? "c1" : null, is_bye: final === "bye", started_at: null, completed_at: final === "none" ? null : "2026-11-21T21:00:00Z" }]),
    ],
    user_push_devices: [{ user_id: "p1", expo_push_token: "ExponentPushToken[dev-p1]", push_notifications_enabled: true, installation_context: "standalone" }],
  });
  return db;
}
const tables = () => (h.db as FakeDb).tables;
const bracket = async (body: Record<string, unknown>) => {
  const res = await bracketPost(new Request("https://site.test/api/admin/tournaments/bracket", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: T, ...body }) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const operator = async (body: Record<string, unknown>) => {
  const res = await operatorPost(new Request("https://site.test/api/admin/operator", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  h.db = world();
  h.user = "admin1";
  h.activationChanges = 0;
  h.expo = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: { body: string }) => {
      h.expo.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }),
  );
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});

describe("4. Finish tournament: when it is allowed", () => {
  it("not until the final has a result: 409, and the tournament stays live", async () => {
    for (const final of ["none", "bye"] as const) {
      h.db = world({ final });
      const r = await bracket({ action: "finish_tournament" });
      expect(r.status, final).toBe(409);
      expect(r.json.code).toBe("final_not_scored");
      expect(String(r.json.error)).toMatch(/final does not have a result yet/);
      expect(tables().tournaments![0]!.is_active).toBe(true);
    }
    // a final that exists but has no result yet
    h.db = world();
    Object.assign(tables().tournament_matches!.find((m) => m.id === "f")!, { completed_at: null, score_a: null, score_b: null, winner_id: null });
    expect((await bracket({ action: "finish_tournament" })).status).toBe(409);
    expect(tables().tournaments![0]!.is_active).toBe(true);
  });

  it("a canceled tournament cannot be finished, and an unknown one is a 404", async () => {
    h.db = world({ canceled: true, active: false });
    const r = await bracket({ action: "finish_tournament" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("canceled");
    const res = await bracketPost(new Request("https://site.test/x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: "nope", action: "finish_tournament" }) }));
    expect(res.status).toBe(404);
  });

  it("only an admin", async () => {
    h.user = "p1";
    const res = await bracketPost(new Request("https://site.test/x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ tournament_id: T, action: "finish_tournament" }) }));
    // the bracket route checks the profile's is_admin itself
    expect(res.status).toBe(403);
    expect(tables().tournaments![0]!.is_active).toBe(true);
  });
});

describe("4. Finish tournament: what it does, and what it never does", () => {
  it("turns the tournament off for players and changes nothing else", async () => {
    const before = JSON.stringify({ ...tables(), tournaments: undefined });
    const r = await bracket({ action: "finish_tournament" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, already_finished: false });
    expect(tables().tournaments![0]).toMatchObject({ is_active: false, canceled_at: null, rated: false, count_for_season: false });
    // every team, score, payment and roster row is exactly as it was
    expect(JSON.stringify({ ...tables(), tournaments: undefined })).toBe(before);
    expect(h.activationChanges).toBe(1);
  });

  it("never sends a push and never touches a payment or a refund", async () => {
    await bracket({ action: "finish_tournament" });
    await bracket({ action: "finish_tournament" });
    expect(h.expo).toEqual([]);
    expect(tables().tournament_payments).toEqual([{ id: "pay1", tournament_id: T, status: "captured", amount_cents: 50000 }]);
    expect((h.db as FakeDb).rpcCalls).toEqual([]);
    const code = readFileSync(new URL("../../lib/tournament/finishTournament.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/sendPush|ExpoPush|expo_push|refund|stripe|tournament_payments|rpc\(/i);
    expect((code.match(/\.update\(/g) ?? []).length).toBe(1);
    expect(code).toMatch(/\.update\(\{ is_active: false \}\)/);
  });

  it("is safe to press twice: the second time says it was already finished and changes nothing", async () => {
    await bracket({ action: "finish_tournament" });
    const snap = JSON.stringify(tables());
    const r = await bracket({ action: "finish_tournament" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, already_finished: true });
    expect(JSON.stringify(tables())).toBe(snap);
    expect(h.activationChanges).toBe(1);
    const lib = await finishTournament(fakeClient(h.db as never) as unknown as SupabaseClient, T);
    expect(lib).toEqual({ ok: true, already_finished: true });
  });

  it("works for a test tournament too (and still sends nothing)", async () => {
    h.db = world({ slug: "test-bracket-demo" });
    expect((await bracket({ action: "finish_tournament" })).status).toBe(200);
    expect(h.expo).toEqual([]);
  });
});

describe("4. finished means: the final has a result, it is off, and it was not canceled. No migration.", () => {
  const done = [{ stage: "final", completed_at: "x" }];
  it("derives it from what is already stored", () => {
    expect(finalHasResult(done)).toBe(true);
    expect(finalHasResult([{ stage: "final", completed_at: "x", is_bye: true }])).toBe(false);
    expect(finalHasResult([{ stage: "sf", completed_at: "x" }])).toBe(false);
    expect(isFinished({ is_active: false, canceled_at: null }, done)).toBe(true);
    expect(isFinished({ is_active: true }, done)).toBe(false); // still live
    expect(isFinished({ is_active: false, canceled_at: "2026-11-01" }, done)).toBe(false); // canceled is not finished
    expect(isFinished({ is_active: false }, [])).toBe(false); // taken offline early is not finished
  });

  it("the bracket screen is told, and so is the admin list", async () => {
    let g = await (await bracketGet(new Request(`https://site.test/api/admin/tournaments/bracket?tournament_id=${T}`, { headers: { authorization: "Bearer t" } }))).json();
    expect(g.tournament_status).toEqual({ is_active: true, canceled: false, finished: false });
    await bracket({ action: "finish_tournament" });
    g = await (await bracketGet(new Request(`https://site.test/api/admin/tournaments/bracket?tournament_id=${T}`, { headers: { authorization: "Bearer t" } }))).json();
    expect(g.tournament_status).toEqual({ is_active: false, canceled: false, finished: true });
    const list = (await (await adminListGet(new Request("https://site.test/api/admin/tournaments", { headers: { authorization: "Bearer t" } }))).json()) as { tournaments: { id: string; finished: boolean }[] };
    expect(list.tournaments.find((t) => t.id === T)!.finished).toBe(true);
  });

  it("the admin list does not call an early offline or a canceled tournament finished", async () => {
    h.db = world({ final: "none", active: false });
    let list = (await (await adminListGet(new Request("https://site.test/api/admin/tournaments", { headers: { authorization: "Bearer t" } }))).json()) as { tournaments: { finished: boolean }[] };
    expect(list.tournaments[0]!.finished).toBe(false);
    h.db = world({ active: false, canceled: true });
    list = (await (await adminListGet(new Request("https://site.test/api/admin/tournaments", { headers: { authorization: "Bearer t" } }))).json()) as { tournaments: { finished: boolean }[] };
    expect(list.tournaments[0]!.finished).toBe(false);
  });
});

describe("4. players stop seeing it", () => {
  const listFor = async () => {
    const r = await loadTournamentList(fakeClient(h.db as never) as unknown as SupabaseClient);
    if (!r.ok) throw new Error(r.error);
    return parseTournamentList({ tournaments: r.tournaments });
  };

  it("while live (final scored, inside the 24 hour grace) the Home card and Events still list it; right after Finish they do not", async () => {
    let items = await listFor();
    expect(items).toHaveLength(1);
    expect(homeTournament(items, NOW)?.id).toBe(T);
    expect(listedTournaments(items, NOW)).toHaveLength(1);
    await bracket({ action: "finish_tournament" });
    items = await listFor();
    expect(items).toEqual([]);
    expect(homeTournament(items, NOW)).toBeNull();
    expect(listedTournaments(items, NOW)).toEqual([]);
  });
});

describe("Make live: the confirm shows the real number, and the preview sends nothing", () => {
  it("counts the approved players the push goes to (the same ids the real press sends to)", async () => {
    const r = await operator({ action: "preview_hub_tournament", tournament_id: T });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, recipients: 4, test_tournament: false }); // admin1, p1, p2, p3 are approved; p4 is not
    expect(h.expo).toEqual([]);
    expect(tables().tournaments![0]!.is_active).toBe(true);
  });

  it("a test tournament shows zero and says it is a test", async () => {
    h.db = world({ slug: "test-bracket-demo", active: false });
    const r = await operator({ action: "preview_hub_tournament", tournament_id: T });
    expect(r.json).toEqual({ ok: true, recipients: 0, test_tournament: true });
  });

  it("the preview changes nothing: not the live flag, not any push, and it needs a tournament that exists", async () => {
    h.db = world({ active: false });
    const before = JSON.stringify(tables());
    await operator({ action: "preview_hub_tournament", tournament_id: T });
    expect(JSON.stringify(tables())).toBe(before);
    expect(h.expo).toEqual([]);
    expect((await operator({ action: "preview_hub_tournament", tournament_id: "nope" })).status).toBe(404);
    expect((await operator({ action: "preview_hub_tournament" })).status).toBe(400);
  });

  it("the number it shows equals the number of players the real press pushes to", async () => {
    h.db = world({ active: false });
    const preview = (await operator({ action: "preview_hub_tournament", tournament_id: T })).json.recipients as number;
    const pressed = await operator({ action: "set_hub_tournament", tournament_id: T });
    expect(pressed.status).toBe(200);
    // the one device in the fake belongs to p1: the push went out once, to the one reachable player of the 4 approved
    expect(h.expo.flat().length).toBe(1);
    expect(preview).toBe(4);
  });

  it("the words: a count, the singular, none, a test tournament, and a count that could not be worked out", () => {
    expect(makeLiveConfirmText("Fall Classic", { recipients: 1234, test_tournament: false })).toMatch(/This sends a push to 1,234 players/);
    expect(makeLiveConfirmText("Fall Classic", { recipients: 1, test_tournament: false })).toMatch(/to 1 player \(/);
    expect(makeLiveConfirmText("Fall Classic", { recipients: 0, test_tournament: false })).toMatch(/No push will be sent/);
    expect(makeLiveConfirmText("Fall Classic", { recipients: 0, test_tournament: true })).toMatch(/test tournament, so no push is sent/);
    expect(makeLiveConfirmText("Fall Classic", null)).toMatch(/could not be worked out/);
    expect(makeLiveConfirmText("Fall Classic", { recipients: 5, test_tournament: false })).toContain("“Fall Classic”");
  });

  it("the app asks for the count first and only then offers the Make live button", () => {
    const src = readFileSync(new URL("../../mobile/app/(tabs)/admin/tournament.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/onPress=\{\(\) => void confirmMakeLive\(t\.id, String\(t\.title \?\? ""\)\)\}/);
    const fn = src.slice(src.indexOf("async function confirmMakeLive"), src.indexOf("async function setHub"));
    expect(fn.indexOf("postAdminPreviewHubTournament")).toBeGreaterThan(-1);
    expect(fn.indexOf("postAdminPreviewHubTournament")).toBeLessThan(fn.indexOf('Alert.alert("Make live?"'));
    expect(fn).toMatch(/makeLiveConfirmText\(title, preview\)/);
    expect(fn).toMatch(/\{ text: "Cancel", style: "cancel" \},\s*\{ text: "Make live", onPress: \(\) => void setHub\(tournamentId\) \}/);
  });
});

describe("4. the admin bracket screen", () => {
  const screen = readFileSync(new URL("../../mobile/app/(tabs)/admin/tournament-bracket.tsx", import.meta.url), "utf8");
  it("shows Finish tournament only once the final has a result, asks first in plain words, and says nothing is sent or refunded", () => {
    expect(screen).toMatch(/const finalDone = matches\.some\(\(m\) => m\.stage === "final" && !m\.is_bye && !!m\.completed_at\)/);
    expect(screen).toMatch(/finalDone && !tournamentStatus\?\.canceled \?/);
    expect(screen).toMatch(/No notification is sent and nothing is refunded/);
    expect(screen).toMatch(/postBracket\("finish_tournament"\)/);
    expect(screen).toMatch(/This tournament is finished\. Players no longer see it/);
  });
});
