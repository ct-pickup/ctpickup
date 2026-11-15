import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDb, type FakeDb } from "../helpers/fakeSupabase";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/server/runtimeClients", async () => {
  const { fakeClient: client } = await import("../helpers/fakeSupabase");
  return {
    getSupabaseAdmin: () => client(h.db as never),
    getSupabaseAnon: () => ({ auth: { getUser: async () => ({ data: { user: { id: "viewer" } }, error: null }) } }),
  };
});

import { GET } from "../../app/api/tournament/bracket/route";
import { buildPublicBracket } from "../../lib/tournament/publicBracket";

/** Values that must never reach a player. Each one is planted in a column that a database row could carry. */
const SECRETS = {
  instagram: "SECRET_IG_HANDLE",
  captainName: "SECRET_CAPTAIN_FULL_NAME",
  captainPhone: "SECRET_PHONE_5551234",
  ip: "203.0.113.77",
  userAgent: "SECRET_UA_Mozilla",
  flagged: "SECRET_FLAGGED_REASON",
  payment: "pi_SECRET_PAYMENT_INTENT",
  email: "secret.captain@example.com",
  rawScore: "71.2345",
  username: "SECRET_USERNAME",
  rosterEmail: "secret.player@example.com",
};

/** Keys that must never appear anywhere in a response, at any depth. */
const FORBIDDEN_KEYS = [
  /^captain_/i,
  /^ip(_address)?$/i,
  /^user_agent$/i,
  /^flagged/i,
  /payment|stripe|refund|amount|price|fee|paid/i,
  /e-?mail/i,
  /phone/i,
  /instagram/i,
  /^username$/i,
  /^user_id$/i,
  /^score$/i,
  /^raw|raw_|_raw/i,
  /^reliability$/i,
  /^tier$/i,
  /^verification$/i,
];

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

function expectClean(payload: unknown) {
  const keys = keysDeep(payload);
  for (const k of keys) for (const re of FORBIDDEN_KEYS) expect(k, `forbidden key "${k}"`).not.toMatch(re);
  const text = JSON.stringify(payload);
  for (const [name, value] of Object.entries(SECRETS)) expect(text, `secret "${name}" leaked`).not.toContain(value);
}

const T = "tour-1";

function poisonedDb(): FakeDb {
  return makeDb({
    tournaments: [{ id: T, stripe_account: SECRETS.payment }],
    profiles: [
      { id: "viewer", approved: true, is_admin: false },
      { id: "u1", first_name: "Sam", last_name: "Rivera", username: SECRETS.username, email: SECRETS.rosterEmail, instagram: SECRETS.instagram, phone: SECRETS.captainPhone },
      { id: "u2", first_name: "Lee", last_name: "Kim", username: SECRETS.username, email: SECRETS.rosterEmail },
      { id: "u3", first_name: "Ana", last_name: "Lopez", username: SECRETS.username },
      { id: "u4", first_name: null, last_name: null, username: SECRETS.username },
    ],
    tournament_captains: [
      {
        id: "capA",
        tournament_id: T,
        status: "confirmed",
        team_name: "Alphas",
        user_id: "u1",
        captain_name: SECRETS.captainName,
        captain_instagram: SECRETS.instagram,
        captain_phone: SECRETS.captainPhone,
        captain_email: SECRETS.email,
        ip: SECRETS.ip,
        user_agent: SECRETS.userAgent,
        flagged_reason: SECRETS.flagged,
        stripe_payment_intent_id: SECRETS.payment,
        payment_status: "paid",
        amount_cents: 12000,
      },
      { id: "capB", tournament_id: T, status: "payment_received", team_name: "Bravos", user_id: "u3", captain_name: SECRETS.captainName, ip: SECRETS.ip, flagged_reason: SECRETS.flagged },
      // A captain who has not paid is not on the bracket at all.
      { id: "capX", tournament_id: T, status: "claim_submitted", team_name: "Unpaid", user_id: "u9", captain_name: SECRETS.captainName },
    ],
    tournament_roster: [
      { captain_id: "capA", user_id: "u2", status: "accepted", email: SECRETS.rosterEmail },
      { captain_id: "capB", user_id: "u4", status: "accepted" },
      { captain_id: "capB", user_id: "u9", status: "invited" },
    ],
    // The view row carries more than the app should ever read; only the two display columns may be used.
    player_cards: [
      { user_id: "u1", rating_exact: 4.0, rated_games: 10, score: SECRETS.rawScore, reliability: 90, tier: "gold", verification: "self" },
      { user_id: "u2", rating_exact: 3.0, rated_games: 6, score: SECRETS.rawScore },
      { user_id: "u3", rating_exact: 2.0, rated_games: 7, score: SECRETS.rawScore },
    ],
    tournament_matches: [
      {
        id: "g1",
        tournament_id: T,
        stage: "group",
        group_name: "A",
        match_number: 1,
        team_a_id: "capA",
        team_b_id: "capB",
        score_a: 2,
        score_b: 1,
        winner_id: "capA",
        is_bye: false,
        scheduled_at: "2026-11-14T14:00:00Z",
        started_at: "2026-11-14T14:02:00Z",
        completed_at: "2026-11-14T15:00:00Z",
        captain_instagram: SECRETS.instagram,
        admin_notes: SECRETS.flagged,
        ip: SECRETS.ip,
      },
      { id: "sf1", tournament_id: T, stage: "sf", match_number: 1000, team_a_id: "capA", team_b_id: "capB", score_a: null, score_b: null, winner_id: null, is_bye: false, internal_note: SECRETS.flagged },
      { id: "sf2", tournament_id: T, stage: "sf", match_number: 1001, team_a_id: "capB", team_b_id: "capA", score_a: null, score_b: null, winner_id: null, is_bye: false },
    ],
    tournament_group_members: [
      { id: "gm1", tournament_id: T, group_id: "G", team_id: "capA", wins: 1, draws: 0, losses: 0, goals_for: 2, goals_against: 1, goal_difference: 1, points: 3, captain_instagram: SECRETS.instagram, ip: SECRETS.ip },
    ],
    tournament_match_goals: [{ tournament_id: T, match_id: "g1", scorer_name: "Sam R.", team_id: "capA", minute: 12, created_by_ip: SECRETS.ip }],
  });
}

function get(url = `https://site.test/api/tournament/bracket?tournament_id=${T}`) {
  return GET(new Request(url, { headers: { authorization: "Bearer token" } }));
}

describe("the player bracket response never carries private fields", () => {
  beforeEach(() => {
    h.db = poisonedDb();
  });

  it("GET /api/tournament/bracket: no contact, payment, review or raw rating field, at any depth", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expectClean(body);
    // And what a player is meant to see is there.
    expect(Object.keys(body).sort()).toEqual(["matches", "standings", "teams", "top_scorers", "upcoming"]);
    const alphas = body.teams.find((t: { id: string }) => t.id === "capA");
    expect(Object.keys(alphas).sort()).toEqual(["id", "roster", "seed", "team_avg", "team_name"]);
    expect(alphas.roster).toEqual(["Lee K.", "Sam R."]);
  });

  it("teams carry only name, roster names, seed and team average; unpaid captains are not listed", async () => {
    const body = await (await get()).json();
    expect(body.teams.map((t: { team_name: string }) => t.team_name).sort()).toEqual(["Alphas", "Bravos"]);
    const bravos = body.teams.find((t: { id: string }) => t.id === "capB");
    // A player with no first name shows as "Player", never a handle. The invited (not accepted) player is not listed.
    expect(bravos.roster).toEqual(["Ana L.", "Player"]);
  });

  it("seeds and team averages come from the exact display rating only", async () => {
    const body = await (await get()).json();
    const by = Object.fromEntries(body.teams.map((t: { id: string; seed: number; team_avg: number }) => [t.id, t]));
    // Field average of the rated players: (4 + 3 + 2) / 3 = 3. Alphas (4, 3) = 3.5. Bravos (2 and one unrated player at 3) = 2.5.
    expect(by.capA).toMatchObject({ seed: 1, team_avg: 3.5 });
    expect(by.capB).toMatchObject({ seed: 2, team_avg: 2.5 });
    expect(JSON.stringify(body)).not.toContain(SECRETS.rawScore);
  });

  it("matches and standings are field by field; status and penalties are derived", async () => {
    const body = await (await get()).json();
    const g1 = body.matches.find((x: { id: string }) => x.id === "g1");
    expect(Object.keys(g1).sort()).toEqual(
      ["completed_at", "group_name", "id", "is_bye", "match_number", "scheduled_at", "score_a", "score_b", "stage", "started_at", "status", "team_a_id", "team_b_id", "winner_id", "won_on_penalties"].sort(),
    );
    expect(g1).toMatchObject({ status: "final", won_on_penalties: false });
    expect(Object.keys(body.standings[0]).sort()).toEqual(
      ["draws", "goal_difference", "goals_against", "goals_for", "group_id", "id", "losses", "points", "team_id", "wins"].sort(),
    );
    expect(body.matches.find((x: { id: string }) => x.id === "sf1")).toMatchObject({ status: "scheduled" });
  });

  it("the knockout rounds still to fill in are listed as placeholders with no team details", async () => {
    const body = await (await get()).json();
    expect(body.upcoming).toEqual([
      { id: "slot:final:0", stage: "final", slot: 0, team_a_id: null, team_b_id: null, label_a: "Winner of Semi-final 1", label_b: "Winner of Semi-final 2", is_bye: false },
    ]);
  });

  it("buildPublicBracket drops every column it was not told to keep", () => {
    const out = buildPublicBracket({
      captains: [{ id: "c1", team_name: "Solo", captain_instagram: SECRETS.instagram, captain_name: SECRETS.captainName, ip: SECRETS.ip, email: SECRETS.email }],
      matches: [{ id: "m1", stage: "group", match_number: 1, team_a_id: "c1", team_b_id: null, payment_status: "paid", flagged_reason: SECRETS.flagged }],
      standings: [{ id: "s1", team_id: "c1", group_id: "g", points: 3, user_agent: SECRETS.userAgent, stripe_id: SECRETS.payment }],
      rosters: new Map([["c1", ["Sam R."]]]),
      seeds: [{ id: "c1", seed: 1, team_avg: 3.2 }],
      topScorers: [{ scorer_name: "Sam R.", goals: 2 }],
    });
    expectClean(out);
    expect(out.teams[0]).toEqual({ id: "c1", team_name: "Solo", seed: 1, team_avg: 3.2, roster: ["Sam R."] });
  });

  it("access rules are unchanged: no token is 401, an unapproved account is 403", async () => {
    expect((await GET(new Request(`https://site.test/api/tournament/bracket?tournament_id=${T}`))).status).toBe(401);
    (h.db as FakeDb).tables.profiles = [{ id: "viewer", approved: false, is_admin: false }];
    expect((await get()).status).toBe(403);
  });
});
