import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { currentSeason } from "@/lib/pickup/points";
import { GET as leaderboardsGET } from "@/app/api/leaderboards/route";

const IOS_UA = "CT%20Pickup/41 CFNetwork/1568.100.1 Darwin/24.0.0";
const LEGACY = { "user-agent": IOS_UA };
const NEW_APP = { "user-agent": IOS_UA, "x-app-version": "1.7.1" };
const get = (qs: string, headers: Record<string, string> = NEW_APP) =>
  leaderboardsGET(new Request(`http://test.local/api/leaderboards${qs}`, { headers }));
const SEASON = currentSeason();

/** gender is the profile's stored value (or null). `games` = rated games; `played` = posted results with the player on a team. */
function player(id: string, gender: string | null, star: number, exact: number, games: number, played: number = games) {
  h.db.rows("profiles").push({
    id,
    first_name: id.toUpperCase(),
    last_name: "Player",
    username: id,
    approved: true,
    is_banned: false,
    nearest_venue: null,
    // Sensitive fields that must never come back from any leaderboard response.
    gender,
    sex: gender,
    gender_other: "secret-other",
  });
  h.db.rows("player_ratings").push({ user_id: id, sessions: games, star_rating: star, star_provisional: games < 5, score: 80, tier: "gold", reliability: 90, verification: "document" });
  h.db.rows("player_cards").push({ user_id: id, rating_exact: exact, rated_games: games });
  for (let k = 0; k < played; k++) {
    const run_id = `run-${id}-${k}`;
    h.db.rows("pickup_run_results").push({ run_id, winning_team: "A" });
    h.db.rows("pickup_run_team_assignments").push({ run_id, user_id: id, team: "A" });
    h.db.rows("points_events").push({ user_id: id, run_id, reason: "played", points: 10, season: SEASON });
  }
}

const ids = (body: { tiers: Array<{ user_id: string }> }) => body.tiers.map((r) => r.user_id);
const ranks = (body: { tiers: Array<{ rank: number }> }) => body.tiers.map((r) => r.rank);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeDb();
  player("m1", "male", 4, 4.1, 6); // best male
  player("m2", "male", 3.5, 3.6, 5);
  player("m3", "male", 3.5, 3.38, 2);
  player("f1", "female", 3.5, 3.5, 4);
  player("f2", "female", 2, 2.0, 3);
  player("o1", "other", 5, 4.9, 12); // top rated overall, but gender is other
  player("p1", "prefer_not_to_say", 3, 3.1, 6);
  player("b1", null, 3, 3.05, 6); // blank gender
  player("z1", "male", 4.5, 4.55, 0, 0); // male, no games played: last in the male list
});

describe("gender filter on the Stars list", () => {
  it("all (the default) lists everyone, including other, prefer not to say and blank", async () => {
    const body = await (await get("")).json();
    expect(ids(body).sort()).toEqual(["b1", "f1", "f2", "m1", "m2", "m3", "o1", "p1", "z1"]);
    expect(ranks(body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ids(await (await get("?gender=all")).json())).toEqual(ids(body));
    expect(ids(await (await get("?gender=bogus")).json())).toEqual(ids(body));
  });
  it("male keeps only exactly male, sorted by exact rating with games-played-zero last, ranks restart at 1", async () => {
    const body = await (await get("?gender=male")).json();
    expect(ids(body)).toEqual(["m1", "m2", "m3", "z1"]);
    expect(ranks(body)).toEqual([1, 2, 3, 4]);
    expect(body.totals.tiers).toBe(4);
  });
  it("female keeps only exactly female, ranks restart at 1", async () => {
    const body = await (await get("?gender=female")).json();
    expect(ids(body)).toEqual(["f1", "f2"]);
    expect(ranks(body)).toEqual([1, 2]);
  });
  it("Dylan 3.60 stays above Malik 3.38 inside a filtered list", async () => {
    const body = await (await get("?gender=male")).json();
    expect(ids(body).indexOf("m2")).toBeLessThan(ids(body).indexOf("m3"));
  });
  it("other, prefer not to say and blank appear only under All", async () => {
    for (const g of ["male", "female"]) {
      const list = ids(await (await get(`?gender=${g}`)).json());
      for (const hidden of ["o1", "p1", "b1"]) expect(list, `${g} ${hidden}`).not.toContain(hidden);
    }
    expect(ids(await (await get("")).json())).toEqual(expect.arrayContaining(["o1", "p1", "b1"]));
  });
  it("the viewer's own row only appears in a list they belong to", async () => {
    const asOther = await (await get("?gender=female", { ...NEW_APP, authorization: "Bearer o1" })).json();
    expect(ids(asOther)).not.toContain("o1");
    const asFemale = await (await get("?gender=female", { ...NEW_APP, authorization: "Bearer f2" })).json();
    expect(ids(asFemale)).toContain("f2");
  });
  it("the older app ignores the filter", async () => {
    const body = await (await get("?gender=female", LEGACY)).json();
    expect(body.tiers.length).toBe(9);
  });
  it("a filter with no players gives an empty list (the app shows a friendly empty state)", async () => {
    h.db.tables["profiles"] = (h.db.tables["profiles"] ?? []).filter((r) => r.gender !== "female");
    const body = await (await get("?gender=female")).json();
    expect(body.tiers).toEqual([]);
    expect(body.totals.tiers).toBe(0);
  });
});

describe("gender filter on the other tabs", () => {
  it("Points (season and all time) use the same filtered list, ranks restart at 1", async () => {
    const all = await (await get("")).json();
    const female = await (await get("?gender=female")).json();
    expect(female.points.map((r: { id: string }) => r.id).sort()).toEqual(["f1", "f2"]);
    expect(female.points_all_time.map((r: { id: string }) => r.id).sort()).toEqual(["f1", "f2"]);
    expect(female.points.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);
    expect(all.points.length).toBeGreaterThan(female.points.length);
    expect(female.totals.points).toBe(2);
  });
  it("Games (sessions) use the filtered list too", async () => {
    const male = await (await get("?gender=male")).json();
    const sessionIds = male.sessions.map((r: { id: string }) => r.id);
    expect(sessionIds).toEqual(expect.arrayContaining(["m1", "m2"]));
    for (const id of sessionIds) expect(["m1", "m2", "m3", "z1"]).toContain(id);
  });
});

describe("no gender field is ever returned", () => {
  it("not in any response, whatever the filter", async () => {
    for (const qs of ["", "?gender=all", "?gender=male", "?gender=female", "?gender=other"]) {
      const text = JSON.stringify(await (await get(qs, { ...NEW_APP, authorization: "Bearer m1" })).json());
      expect(text, qs).not.toMatch(/gender|"sex"|secret-other|prefer_not_to_say|opt_in/i);
    }
  });
  it("the route reads profiles.gender only through the service role filter helper", () => {
    const src = readFileSync(new URL("../app/api/leaderboards/route.ts", import.meta.url), "utf8");
    expect(src).toMatch(/applyGenderFilter\(admin, profiles, genderFilter\)/);
    expect(src).not.toMatch(/\bgender\b\s*:/);
    expect(src).not.toMatch(/select\([^)]*gender/);
  });
});
