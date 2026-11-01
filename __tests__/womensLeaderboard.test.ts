import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseLeaderboardScope, loadWomensOptInIds } from "../lib/leaderboards/womensList";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: string[] = [];
  auth = {
    getUser: async (token: string) => ({ data: { user: token ? { id: token, email: `${token}@x.test` } : null }, error: null }),
    admin: {
      getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@x.test` } }, error: null }),
    },
  };

  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "upsert" | "update" = "select";
  private cols = "*";
  private payload: Row = {};
  private single = false;
  private window: [number, number] | null = null;
  private max: number | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*") {
    this.cols = cols;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  upsert(row: Row) {
    this.op = "upsert";
    this.payload = row;
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.payload = row;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: number) {
    this.filters.push((r) => Number(r[col]) >= val);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private exec(): Result {
    const rows = this.db.rows(this.table);
    if (this.op !== "select") {
      this.db.writes.push(`${this.table}.${this.op}`);
      if (this.op === "update") {
        for (const r of rows.filter((x) => this.filters.every((f) => f(x)))) Object.assign(r, this.payload);
      } else {
        rows.push({ ...this.payload });
      }
      return { data: null, error: null };
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
    if (this.max != null) out = out.slice(0, this.max);
    const cols = this.cols.split(",").map((c) => c.trim());
    const project = (r: Row) => (this.cols === "*" ? { ...r } : Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    if (this.single) return { data: out[0] ? project(out[0]) : null, error: null };
    return { data: out.map(project), error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db, getStripePickup: () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

import { GET as leaderboardsGET } from "@/app/api/leaderboards/route";

const IOS_UA = "CT%20Pickup/41 CFNetwork/1568.100.1 Darwin/24.0.0";
const LEGACY = { "user-agent": IOS_UA };
const NEW_APP = { "user-agent": IOS_UA, "x-app-version": "1.7.1" };
const get = (qs: string, headers: Record<string, string> = NEW_APP) =>
  leaderboardsGET(new Request(`http://test.local/api/leaderboards${qs}`, { headers }));

/** `games` is rated games (settled rating sessions); `played` is games played: posted results with the player on a team (the "N games played" on the row). */
function player(id: string, optIn: boolean, star: number, exact: number, games: number, played: number = games) {
  h.db.rows("profiles").push({
    id,
    first_name: id.toUpperCase(),
    last_name: "Player",
    username: id,
    approved: true,
    is_banned: false,
    nearest_venue: null,
    // Sensitive fields that must never come back from any leaderboard response.
    gender: "female",
    sex: "female",
    gender_other: "secret-other",
  });
  if (optIn) h.db.rows("womens_leaderboard_opt_in").push({ user_id: id, created_at: "2026-11-01T00:00:00Z" });
  h.db.rows("player_ratings").push({ user_id: id, sessions: games, star_rating: star, star_provisional: games < 5, score: 80, tier: "gold", reliability: 90, verification: "document" });
  h.db.rows("player_cards").push({ user_id: id, rating_exact: exact, rated_games: games });
  for (let k = 0; k < played; k++) {
    const run_id = `run-${id}-${k}`;
    h.db.rows("pickup_run_results").push({ run_id, winning_team: "A" });
    h.db.rows("pickup_run_team_assignments").push({ run_id, user_id: id, team: "A" });
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeDb();
  player("a", true, 3.5, 3.38, 2); // Malik
  player("b", true, 3.5, 3.6, 5); // Dylan
  player("c", false, 5, 4.9, 12); // top player who did not opt in
  player("d", true, 3.5, 3.5, 0, 0); // opted in, no rated games and no games played
  player("e", false, 3, 3.1, 6);
  player("f", true, 2, 2.0, 4);
});

describe("scope=women", () => {
  it("lists only opted-in players, ordered by exact rating, ranks starting at 1, no rated games last", async () => {
    const body = await (await get("?scope=women")).json();
    const ids = body.tiers.map((r: { user_id: string }) => r.user_id);
    expect(ids).toEqual(["b", "a", "f", "d"]);
    expect(body.tiers.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(body.totals.tiers).toBe(4);
  });
  it("Dylan 3.60 is above Malik 3.38 inside the women list", async () => {
    const body = await (await get("?scope=women")).json();
    const rank = (id: string) => body.tiers.find((r: { user_id: string }) => r.user_id === id).rank;
    expect(rank("b")).toBeLessThan(rank("a"));
  });
  it("players who did not opt in never appear, even as the viewer or a top player", async () => {
    const body = await (await get("?scope=women", { ...NEW_APP, authorization: "Bearer c" })).json();
    const ids = body.tiers.map((r: { user_id: string }) => r.user_id);
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("e");
  });
  it("never returns gender, sex, gender_other or the opt-in flag anywhere in the response", async () => {
    for (const qs of ["?scope=women", "", "?scope=all"]) {
      const text = JSON.stringify(await (await get(qs)).json());
      expect(text, qs).not.toMatch(/gender|"sex"|secret-other|opt_in|womens|female/i);
    }
  });
  it("the normal Stars list is unchanged by scope and does not reveal opt-in", async () => {
    const all = await (await get("")).json();
    const ids = all.tiers.map((r: { user_id: string }) => r.user_id);
    expect(ids).toEqual(["c", "b", "a", "e", "f", "d"]);
    expect(all.tiers.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await (await get("?scope=bogus")).json()).tiers.length).toBe(6);
  });
  it("the older app ignores the scope", async () => {
    const body = await (await get("?scope=women", LEGACY)).json();
    expect(body.tiers.length).toBe(6);
  });
  it("games played, not rated games, decides who sinks: played but unrated stays in order, rated but never played goes last", async () => {
    player("g", true, 4.5, 4.55, 0, 3); // 3 games played, 0 rated: ranks first
    player("h", true, 4, 4.2, 2, 0); // rated, but 0 games played: sinks below everyone who has played
    const body = await (await get("?scope=women")).json();
    expect(body.tiers.map((r: { user_id: string }) => r.user_id)).toEqual(["g", "b", "a", "f", "h", "d"]);
    expect(body.tiers.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("is empty (a friendly empty state in the app) when nobody has opted in", async () => {
    h.db.tables["womens_leaderboard_opt_in"] = [];
    const body = await (await get("?scope=women")).json();
    expect(body.tiers).toEqual([]);
    expect(body.totals.tiers).toBe(0);
  });
});

describe("opt-in helpers", () => {
  it("defaults to the normal list unless the scope is exactly women", () => {
    expect(parseLeaderboardScope("women")).toBe("women");
    for (const v of [null, undefined, "", "all", "Women", "men", "gender"]) expect(parseLeaderboardScope(v)).toBe("all");
  });
  it("reads only the opt-in table, and returns nobody when the table does not exist yet", async () => {
    expect([...(await loadWomensOptInIds(h.db as never))].sort()).toEqual(["a", "b", "d", "f"]);
    const broken = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'relation "public.womens_leaderboard_opt_in" does not exist' } }) }) }) }) };
    expect((await loadWomensOptInIds(broken as never)).size).toBe(0);
  });
  it("a player with no row is not on the list (default is not opted in)", async () => {
    h.db.rows("profiles").push({ id: "g", approved: true, is_banned: false });
    expect([...(await loadWomensOptInIds(h.db as never))]).not.toContain("g");
  });
  it("the leaderboard route reads the table through the service role client only", async () => {
    const src = readFileSync(new URL("../app/api/leaderboards/route.ts", import.meta.url), "utf8");
    expect(src).toMatch(/loadWomensOptInIds\(admin\)/);
    expect(src).not.toMatch(/womens_leaderboard_opt_in/);
  });
});
