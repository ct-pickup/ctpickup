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

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  deleteUserAccount: null as unknown as (...args: unknown[]) => Promise<unknown>,
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db, getStripePickup: () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));
vi.mock("@/lib/auth/invalidateUserSessions", () => ({ invalidateUserSessions: async () => ({ ok: true }) }));
vi.mock("@/lib/account/deleteUserAccount", async () => {
  const plan = await vi.importActual<typeof import("@/lib/account/accountDeletionPlan")>("@/lib/account/accountDeletionPlan");
  return {
    ACCOUNT_DELETE_SUPPORT_ERROR: "support",
    AccountDeletionError: plan.AccountDeletionError,
    previewAccountDeletion: async () => null,
    deleteUserAccount: (...args: unknown[]) => h.deleteUserAccount(...args),
  };
});

import { AccountDeletionError } from "@/lib/account/accountDeletionPlan";
import { isLegacyMobileClient } from "@/lib/api/appVersion";
import { currentSeason } from "@/lib/pickup/points";
import { DELETE as accountDELETE } from "@/app/api/account/delete/route";
import { DELETE as membersDELETE } from "@/app/api/admin/members/route";
import { GET as countyGET } from "@/app/api/community-map/county/route";
import { GET as leaderboardsGET } from "@/app/api/leaderboards/route";
import { GET as publicProfileGET } from "@/app/api/profile/public/[userId]/route";
import { POST as invitePOST } from "@/app/api/sessions/invite/route";

const IOS_UA = "CT%20Pickup/41 CFNetwork/1568.100.1 Darwin/24.0.0";
const ANDROID_UA = "okhttp/4.12.0";
const BROWSER = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};
const LEGACY = { "user-agent": IOS_UA };
const NEW_APP = { "user-agent": IOS_UA, "x-app-version": "1.4.0" };

const HOST = "host-1";
const RUN = "run-1";
const TARGET = "11111111-1111-4111-8111-111111111111";

function req(url: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return new Request(`http://test.local${url}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
}

function seedProfile(id: string, overrides: Row = {}) {
  h.db.rows("profiles").push({
    id,
    first_name: "Pat",
    last_name: "Player",
    username: id,
    approved: true,
    is_admin: false,
    tier: "wave-2",
    tier_rank: 3,
    nearest_venue: null,
    zip_code: null,
    verification_level: "document",
    attended_count: 7,
    ...overrides,
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeDb();
  h.deleteUserAccount = async () => ({ warnings: [], paymentsAnonymized: 0, rsvpsKept: 0 });
  seedProfile(HOST);
  seedProfile("invitee");
  seedProfile("intruder");
  seedProfile("staff", { is_admin: true });
});

describe("isLegacyMobileClient", () => {
  it("treats a native user agent without x-app-version as v1.3.5", () => {
    expect(isLegacyMobileClient(req("/", { "user-agent": IOS_UA }))).toBe(true);
    expect(isLegacyMobileClient(req("/", { "user-agent": ANDROID_UA }))).toBe(true);
    expect(isLegacyMobileClient(req("/", { "user-agent": IOS_UA, authorization: "Bearer t" }))).toBe(true);
  });

  it("detects the x-app-version header", () => {
    expect(isLegacyMobileClient(req("/", NEW_APP))).toBe(false);
    expect(isLegacyMobileClient(req("/", { "user-agent": ANDROID_UA, "x-app-version": "1.4.0" }))).toBe(false);
  });

  it("never treats browsers or unknown callers as legacy", () => {
    expect(isLegacyMobileClient(req("/", BROWSER))).toBe(false);
    expect(isLegacyMobileClient(req("/", { "sec-fetch-site": "same-origin", "user-agent": IOS_UA }))).toBe(false);
    expect(isLegacyMobileClient(req("/", { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Darwin/24" }))).toBe(false);
    expect(isLegacyMobileClient(req("/"))).toBe(false);
    expect(isLegacyMobileClient(req("/", { authorization: "Bearer t" }))).toBe(false);
    expect(isLegacyMobileClient(req("/", { "user-agent": "curl/8.4.0" }))).toBe(false);
  });
});

describe("leaderboards tiers", () => {
  beforeEach(() => {
    h.db.rows("player_ratings").push(
      { user_id: HOST, tier: "Gold", score: 77, sessions: 4, reliability: 93, verification: "document" },
      { user_id: "invitee", tier: null, score: null, sessions: null, reliability: null, verification: "self" },
    );
    h.db.rows("points_events").push(
      { user_id: HOST, run_id: "r1", reason: "played", points: 10, season: currentSeason() },
      { user_id: HOST, run_id: "r1", reason: "win", points: 5, season: currentSeason() },
      { user_id: HOST, run_id: "r0", reason: "played", points: 10, season: "Fall 2020" },
    );
  });

  it("gives v1.3.5 the pre-b9c83a1 row: tier, score, sessions, reliability and no points", async () => {
    const body = await (await leaderboardsGET(req("/api/leaderboards", LEGACY))).json();
    expect(body.tiers).toHaveLength(2);
    expect(body.tiers[0]).toEqual({
      user_id: HOST,
      tier: "gold",
      score: 77,
      sessions: 4,
      reliability: 93,
      first_name: "Pat",
      last_name: "Player",
      username: HOST,
      avatar_url: null,
      nearest_venue: null,
    });
    expect(body.tiers[1]).toMatchObject({ user_id: "invitee", tier: "bronze", score: 50, sessions: 0, reliability: 0 });
    for (const row of body.tiers) expect(row).not.toHaveProperty("points");
    for (const key of ["points", "points_all_time", "season"]) expect(body).not.toHaveProperty(key);
  });

  it.each([
    ["the new app", NEW_APP],
    ["a web browser", BROWSER],
  ])("gives %s points and sessions only", async (_label, headers) => {
    const body = await (await leaderboardsGET(req("/api/leaderboards", headers))).json();
    expect(body.tiers[0]).toMatchObject({ user_id: HOST, sessions: 4, points: 15 });
    const text = JSON.stringify(body);
    expect(text).not.toContain("reliability");
    expect(text).not.toContain("\"score\"");
    expect(text).not.toContain("\"tier\"");
  });
});

describe("profile/public", () => {
  const get = (headers: Record<string, string>) =>
    publicProfileGET(req(`/api/profile/public/${TARGET}`, { authorization: `Bearer ${HOST}`, ...headers }), {
      params: Promise.resolve({ userId: TARGET }),
    });

  beforeEach(() => {
    seedProfile(TARGET, { tier: "wave-1" });
  });

  it("gives v1.3.5 tier and verification from player_ratings, reliability always null", async () => {
    h.db.rows("player_ratings").push({ user_id: TARGET, tier: "silver", score: 55, sessions: 3, reliability: 88, verification: "vouched" });
    const res = await get(LEGACY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: TARGET, tier: "silver", verification: "vouched", reliability: null, rating_sessions: 3 });
    expect(body).not.toHaveProperty("score");
  });

  it("does not restore the profiles wave label as a tier for v1.3.5", async () => {
    const body = await (await get(LEGACY)).json();
    expect(body).toMatchObject({ tier: null, verification: "self", reliability: null, rating_sessions: 0 });
  });

  it.each([
    ["the new app", NEW_APP],
    ["a web browser", BROWSER],
  ])("gives %s no tier, verification or reliability", async (_label, headers) => {
    h.db.rows("player_ratings").push({ user_id: TARGET, tier: "silver", score: 55, sessions: 3, reliability: 88, verification: "vouched" });
    const body = await (await get(headers)).json();
    expect(body).not.toHaveProperty("tier");
    expect(body).not.toHaveProperty("verification");
    expect(body).not.toHaveProperty("reliability");
    expect(body).toMatchObject({ id: TARGET, verification_level: "document", rating_sessions: 3 });
  });
});

describe("community-map/county", () => {
  const COUNTY_ZIP = "06510";

  beforeEach(() => {
    seedProfile("diamond-1", { zip_code: COUNTY_ZIP, first_name: "Dee" });
    seedProfile("plat-1", { zip_code: COUNTY_ZIP, first_name: "Pia" });
    h.db.rows("player_ratings").push(
      { user_id: "diamond-1", tier: "diamond", verification: "document", star_rating: 5, score: 95 },
      { user_id: "plat-1", tier: "platinum", verification: "vouched", star_rating: 4, score: 80 },
    );
  });

  async function countyId(): Promise<string> {
    const { countyForZip } = await import("@/lib/communityMap/counties");
    return countyForZip(COUNTY_ZIP)!.id;
  }

  it("gives v1.3.5 the verified diamond overview", async () => {
    const body = await (await countyGET(req("/api/community-map/county?overview=1", { ...LEGACY, authorization: `Bearer ${HOST}` }))).json();
    expect(body.verifiedDiamondByCounty[await countyId()]).toBe(1);
    expect(body).not.toHaveProperty("topRatedByCounty");
  });

  it("gives v1.3.5 tier counts and the elite list for a county", async () => {
    const id = await countyId();
    const body = await (
      await countyGET(req(`/api/community-map/county?county_id=${id}`, { ...LEGACY, authorization: `Bearer ${HOST}` }))
    ).json();
    expect(body).toMatchObject({ ok: true, county_id: id, verifiedDiamondCount: 1 });
    expect(body.tierCounts).toMatchObject({ diamond: 1, platinum: 1 });
    expect(body.elitePlayers.map((p: Row) => p.id)).toEqual(["diamond-1", "plat-1"]);
  });

  it("gives the new app the star payload", async () => {
    const body = await (await countyGET(req("/api/community-map/county?overview=1", { ...NEW_APP, authorization: `Bearer ${HOST}` }))).json();
    expect(body).toHaveProperty("topRatedByCounty");
    expect(body).not.toHaveProperty("verifiedDiamondByCounty");
  });
});

describe("account deletion with upcoming games", () => {
  const preview = {
    upcoming_games: 1,
    hosts_upcoming_runs: false,
    hosted_upcoming_runs: 0,
    confirmation_required: true,
    message: "You have 1 upcoming game. Deleting your account gives up those spots and any credits.",
  };

  beforeEach(() => {
    h.deleteUserAccount = async (...args: unknown[]) => {
      const opts = args[3] as { confirmUpcoming?: boolean };
      if (!opts.confirmUpcoming) throw new AccountDeletionError("confirmation_required", 409, preview.message, { preview });
      return { warnings: [], paymentsAnonymized: 0, rsvpsKept: 0 };
    };
  });

  const del = (headers: Record<string, string>, body?: Row) =>
    accountDELETE(
      req("/api/account/delete", { authorization: `Bearer ${HOST}`, ...headers }, {
        method: "DELETE",
        ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
      }),
    );

  it("tells v1.3.5 nothing was deleted and how to proceed, without deleting", async () => {
    const res = await del(LEGACY);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("confirmation_required");
    expect(body.error).toContain(preview.message);
    expect(body.error).toContain("Nothing was deleted");
    expect(body.error).toContain("update CT Pickup");
  });

  it("keeps the confirm flow for the new app", async () => {
    const res = await del(NEW_APP);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(preview.message);
    expect((await del(NEW_APP, { confirm_upcoming: true })).status).toBe(200);
  });

  it("lets v1.3.5 delete an account with nothing upcoming", async () => {
    h.deleteUserAccount = async () => ({ warnings: [], paymentsAnonymized: 0, rsvpsKept: 0 });
    expect((await del(LEGACY)).status).toBe(200);
  });

  it("gives the v1.3.5 admin screen an update message instead of a dead end", async () => {
    const adminDel = (headers: Record<string, string>) =>
      membersDELETE(
        req("/api/admin/members", { authorization: "Bearer staff", "content-type": "application/json", ...headers }, {
          method: "DELETE",
          body: JSON.stringify({ user_id: TARGET }),
        }),
      );
    const legacy = await adminDel(LEGACY);
    expect(legacy.status).toBe(409);
    expect((await legacy.json()).error).toContain("website admin");
    const current = await adminDel(NEW_APP);
    expect(current.status).toBe(409);
    expect((await current.json()).error).toBe(preview.message);
  });
});

describe("sessions/invite host check applies to v1.3.5", () => {
  beforeEach(() => {
    h.db.rows("pickup_runs").push({
      id: RUN,
      title: "Tuesday 7v7",
      start_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
      created_by: HOST,
      run_type: "select",
      status: "planning",
    });
  });

  it("rejects a legacy non-host with 403 and writes nothing", async () => {
    const res = await invitePOST(
      req("/api/sessions/invite", { ...LEGACY, authorization: "Bearer intruder", "content-type": "application/json" }, {
        method: "POST",
        body: JSON.stringify({ run_id: RUN, invitee_id: "invitee" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(h.db.rows("pickup_run_invites")).toHaveLength(0);
    expect(h.db.writes).toEqual([]);
  });
});
