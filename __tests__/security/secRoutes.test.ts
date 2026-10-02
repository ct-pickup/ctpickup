import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

class FakeDb {
  tables: Record<string, Row[]> = {};
  failWrites = new Set<string>();
  writes: string[] = [];
  auth = {
    getUser: async (token: string) => ({ data: { user: token ? { id: token } : null }, error: null }),
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
      const key = `${this.table}.${this.op}`;
      if (this.db.failWrites.has(key)) return { data: null, error: { message: "write failed" } };
      this.db.writes.push(key);
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
  captured: [] as unknown[],
  adminUserId: "staff" as string | null,
}));

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: (e: unknown) => h.captured.push(e) }));
vi.mock("@/lib/admin/requireAdmin", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAdminBearer: async () =>
      h.adminUserId
        ? { ok: true, userId: h.adminUserId }
        : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
  };
});

import { POST as tierPOST } from "@/app/api/admin/tier/route";
import { POST as verificationPOST } from "@/app/api/admin/verification/route";
import { GET as leaderboardsGET } from "@/app/api/leaderboards/route";
import { GET as publicProfileGET } from "@/app/api/profile/public/[userId]/route";
import { POST as invitePOST } from "@/app/api/sessions/invite/route";

const HOST = "host-1";
const RUN = "run-1";
const TARGET = "11111111-1111-4111-8111-111111111111";

function post(url: string, userId: string | null, body: Record<string, unknown>) {
  return new Request(`http://test.local${url}`, {
    method: "POST",
    headers: { ...(userId ? { authorization: `Bearer ${userId}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    verification_level: "document",
    attended_count: 7,
    ...overrides,
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeDb();
  h.captured = [];
  h.adminUserId = "staff";
  seedProfile(HOST);
  seedProfile("invitee");
  seedProfile("intruder");
  seedProfile("staff", { is_admin: true });
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday 7v7",
    start_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    created_by: HOST,
    run_type: "select",
    status: "planning",
  });
});

describe("sessions/invite authorization", () => {
  const invite = (caller: string, invitee: string) =>
    invitePOST(post("/api/sessions/invite", caller, { run_id: RUN, invitee_id: invitee }));

  it("rejects a non-host non-admin with 403 and writes no invite row", async () => {
    const res = await invite("intruder", "intruder");
    expect(res.status).toBe(403);
    expect(h.db.rows("pickup_run_invites")).toHaveLength(0);
    expect(h.db.writes).toEqual([]);

    expect((await invite("intruder", "invitee")).status).toBe(403);
    expect(h.db.rows("pickup_run_invites")).toHaveLength(0);
  });

  it("lets the host invite", async () => {
    const res = await invite(HOST, "invitee");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already_invited: false });
    expect(h.db.rows("pickup_run_invites")).toMatchObject([{ run_id: RUN, user_id: "invitee" }]);
  });

  it("lets an admin invite on someone else's run", async () => {
    const res = await invite("staff", "invitee");
    expect(res.status).toBe(200);
    expect(h.db.rows("pickup_run_invites")).toMatchObject([{ run_id: RUN, user_id: "invitee" }]);
  });
});

describe("ratings internals are not exposed", () => {
  it("leaderboards tiers send points, not tier, score or reliability", async () => {
    h.db.rows("player_ratings").push({ user_id: HOST, tier: "gold", score: 77, sessions: 4, reliability: 93, verification: "document" });
    const res = await leaderboardsGET(new Request("http://test.local/api/leaderboards"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tiers).toHaveLength(1);
    expect(body.tiers[0]).toMatchObject({ user_id: HOST, sessions: 4, points: 160 });
    for (const row of body.tiers) {
      expect(row).not.toHaveProperty("tier");
      expect(row).not.toHaveProperty("score");
      expect(row).not.toHaveProperty("reliability");
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain("reliability");
    expect(text).not.toContain("\"score\"");
  });

  it("profile/public omits tier, reliability and verification", async () => {
    seedProfile(TARGET, { tier: "wave-1" });
    h.db.rows("player_ratings").push({ user_id: TARGET, tier: "silver", score: 55, sessions: 3, reliability: 88, verification: "vouched" });
    const req = new Request(`http://test.local/api/profile/public/${TARGET}`, { headers: { authorization: `Bearer ${HOST}` } });
    const res = await publicProfileGET(req, { params: Promise.resolve({ userId: TARGET }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("reliability");
    expect(body).not.toHaveProperty("verification");
    expect(body).not.toHaveProperty("score");
    expect(body).not.toHaveProperty("tier");
    expect(body).toMatchObject({ id: TARGET, verification_level: "document", rating_sessions: 3 });
  });

  it("profile/public does not fall back to the profiles wave label as a tier", async () => {
    seedProfile(TARGET, { tier: "wave-1" });
    const req = new Request(`http://test.local/api/profile/public/${TARGET}`, { headers: { authorization: `Bearer ${HOST}` } });
    const body = await (await publicProfileGET(req, { params: Promise.resolve({ userId: TARGET }) })).json();
    expect(body).not.toHaveProperty("tier");
  });
});

describe("admin write errors", () => {
  it("tier returns 500 and reports when the ratings upsert fails", async () => {
    h.db.failWrites.add("player_ratings.upsert");
    const res = await tierPOST(post("/api/admin/tier", "staff", { user_id: TARGET, tier: "gold" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(h.captured).toHaveLength(1);
  });

  it("tier returns 500 when the profile update fails", async () => {
    h.db.failWrites.add("profiles.update");
    const res = await tierPOST(post("/api/admin/tier", "staff", { user_id: TARGET, verification: "vouched" }));
    expect(res.status).toBe(500);
    expect(h.captured).toHaveLength(1);
  });

  it("tier succeeds when writes succeed", async () => {
    const res = await tierPOST(post("/api/admin/tier", "staff", { user_id: TARGET, tier: "gold" }));
    expect(res.status).toBe(200);
    expect(h.captured).toHaveLength(0);
  });

  it("verification returns 500 and reports when a write fails", async () => {
    h.db.rows("verification_requests").push({ id: "vr-1", user_id: TARGET, status: "pending" });
    h.db.failWrites.add("verification_requests.update");
    const res = await verificationPOST(post("/api/admin/verification", "staff", { request_id: "vr-1", decision: "approved" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(h.captured).toHaveLength(1);
    expect(h.db.writes).toEqual([]);
  });

  it("verification returns 500 when the ratings upsert fails after approval", async () => {
    h.db.rows("verification_requests").push({ id: "vr-1", user_id: TARGET, status: "pending" });
    h.db.failWrites.add("player_ratings.upsert");
    const res = await verificationPOST(post("/api/admin/verification", "staff", { request_id: "vr-1", decision: "approved" }));
    expect(res.status).toBe(500);
    expect(h.captured).toHaveLength(1);
  });
});
