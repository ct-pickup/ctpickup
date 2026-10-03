import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Err = { message: string; code?: string };
type Result = { data: unknown; error: Err | null };

const TABLE = "instagram_verification_requests";
/** star_seed_unverified_cap(): the highest star without verification. */
const UNVERIFIED_CAP = 3.0;

class FakeDb {
  tables: Record<string, Row[]> = {};
  missingTables = new Set<string>();
  missingColumns: Record<string, string[]> = {};
  rateBuckets = new Map<string, number>();
  rpcFails = false;
  /** Functions the 20261006100000 migration adds; remove one to simulate it not being applied yet. */
  migratedFunctions = new Set(['approve_instagram_with_level']);
  failWrites = new Set<string>();
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
  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "approve_instagram_with_level") return this.approveInstagramWithLevel(args);
    if (this.rpcFails || name !== "api_rate_limit_check") {
      return { data: null, error: { message: `Could not find the function public.${name}` } };
    }
    const bucketKey = String(args.p_bucket_key);
    const limit = Number(args.p_limit);
    const n = (this.rateBuckets.get(bucketKey) ?? 0) + 1;
    if (n > limit) return { data: { allowed: false, retry_after_seconds: 3600 }, error: null };
    this.rateBuckets.set(bucketKey, n);
    return { data: { allowed: true, retry_after_seconds: 0 }, error: null };
  }

  /** Mirrors public.approve_instagram_with_level: seed while provisional, lift the 3.0 cap only above it. */
  private async approveInstagramWithLevel(args: Record<string, unknown>) {
    if (!this.migratedFunctions.has("approve_instagram_with_level")) {
      return { data: null, error: { message: "Could not find the function public.approve_instagram_with_level", code: "PGRST202" } };
    }
    if (this.failWrites.has("rpc.approve_instagram_with_level")) return { data: null, error: { message: "write failed" } };
    const level = Number(args.p_level);
    if (!Number.isFinite(level) || level < 0.5 || level > 5 || level * 2 !== Math.floor(level * 2)) {
      return { data: null, error: { message: `approve_instagram_with_level: unknown level ${level}` } };
    }
    const ratings = this.rows("player_ratings");
    let r = ratings.find((x) => x.user_id === args.p_user_id);
    if (!r) {
      r = { user_id: args.p_user_id, score: 50, verification: "self", star_provisional: true };
      ratings.push(r);
    }
    const lift = level > UNVERIFIED_CAP;
    const provisional = r.star_provisional !== false;
    this.rows("rating_seed_log").push({
      user_id: args.p_user_id,
      actor_id: args.p_admin_id,
      source: "admin",
      chosen_level: level,
      applied_level: provisional ? level : null,
      old_score: r.score,
    });
    if (lift) r.verification = "instagram";
    if (provisional) r.seeded_level = level;
    return { data: { seeded: provisional, cap_lifted: lift }, error: null };
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private cols = "*";
  private payload: Row = {};
  private returning = false;
  private single = false;
  private max: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*") {
    if (this.op === "select") this.cols = cols;
    else this.returning = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.payload = row;
    return this;
  }
  upsert(row: Row) {
    this.op = "upsert";
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
  lte(col: string, val: string) {
    this.filters.push((r) => new Date(String(r[col])).getTime() <= new Date(val).getTime());
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private columnsTouched(): string[] {
    if (this.op === "select") return this.cols.split(",").map((c) => c.trim());
    return Object.keys(this.payload);
  }

  private exec(): Result {
    if (this.db.missingTables.has(this.table)) {
      return { data: null, error: { message: `relation "public.${this.table}" does not exist`, code: "42P01" } };
    }
    const gone = (this.db.missingColumns[this.table] ?? []).find((c) => this.columnsTouched().includes(c));
    if (gone) return { data: null, error: { message: `column ${this.table}.${gone} does not exist`, code: "42703" } };
    if (this.op !== "select" && this.db.failWrites.has(`${this.table}.${this.op}`)) {
      return { data: null, error: { message: "write failed" } };
    }
    const rows = this.db.rows(this.table);

    if (this.op === "insert") {
      const row: Row = { id: `req-${rows.length + 1}`, created_at: new Date().toISOString(), ...this.payload };
      if (this.table === TABLE) {
        if (rows.some((r) => r.code_hash === row.code_hash)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "ig_verify_code_hash_unique" (code_hash)' } };
        }
        if (row.status === "pending" && rows.some((r) => r.user_id === row.user_id && r.status === "pending")) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "ig_verify_one_pending_per_user"' } };
        }
      }
      rows.push(row);
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const existing = rows.find((r) => r.user_id === this.payload.user_id);
      if (existing) Object.assign(existing, this.payload);
      else rows.push({ ...this.payload });
      return { data: null, error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of matched) Object.assign(r, this.payload);
      return { data: this.returning ? matched.map((r) => ({ id: r.id })) : null, error: null };
    }
    let out = [...matched];
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
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
  randomInt: null as ((max: number) => number) | null,
}));

vi.mock("crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("crypto")>();
  const randomInt = (max: number) => (h.randomInt ? h.randomInt(max) : real.randomInt(max));
  return { ...real, default: { ...real, randomInt }, randomInt };
});

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => h.db }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown) => h.captured.push(e),
  captureMessage: (m: unknown) => h.captured.push(m),
}));

import { GET as userGET, POST as userPOST } from "@/app/api/account/instagram-verification/route";
import { POST as visibilityPOST } from "@/app/api/account/instagram-visibility/route";
import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/instagram-verification/route";
import { GET as publicProfileGET } from "@/app/api/profile/public/[userId]/route";
import {
  generateVerificationCode,
  hashVerificationCode,
  isVerificationExpired,
  openVerificationCode,
  sealVerificationCode,
  verificationCodeHint,
  verificationCodeMatches,
  verificationExpiresAt,
  VERIFICATION_TTL_MS,
} from "@/lib/verification/instagram";
import { INSTAGRAM_VERIFICATION_HANDLE } from "@/lib/brand";
import { INSTAGRAM_VERIFICATION_HANDLE as MOBILE_INSTAGRAM_VERIFICATION_HANDLE } from "../../mobile/lib/brand";
import {
  formatVerificationCode,
  instagramProfileUrls,
  verificationDmInstruction,
  maskedVerificationHint,
  normalizeInstagramHandle,
  normalizeVerificationCodeInput,
  VERIFICATION_CODE_ALPHABET,
  VERIFICATION_UNAVAILABLE_MESSAGE,
} from "@/shared/instagramVerification";

process.env.INSTAGRAM_VERIFY_SECRET = "test-only-instagram-secret";

const PLAYER = "11111111-1111-4111-8111-111111111111";
const STAFF = "staff-1";
const VIEWER = "viewer-1";

function req(path: string, userId: string | null, body?: unknown) {
  return new Request(`http://test.local${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(userId ? { authorization: `Bearer ${userId}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const start = (userId: string | null, handle: unknown) => userPOST(req("/api/account/instagram-verification", userId, { handle }));
const status = (userId: string) => userGET(req("/api/account/instagram-verification", userId));
const LEVEL_COLLEGE = 4.0;
const review = (userId: string, body: Record<string, unknown>) => adminPOST(req("/api/admin/instagram-verification", userId, body));

function seedProfile(id: string, overrides: Row = {}) {
  h.db.rows("profiles").push({
    id,
    first_name: "Pat",
    last_name: "Player",
    username: "pat",
    avatar_url: null,
    approved: true,
    is_admin: false,
    verification_level: "self",
    show_instagram: false,
    instagram_handle: null,
    ...overrides,
  });
}

function profile(id: string) {
  return h.db.rows("profiles").find((p) => p.id === id)!;
}

function requests() {
  return h.db.rows(TABLE);
}

async function startAndGetCode(handle = "pat.player") {
  const res = await start(PLAYER, handle);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { code: string };
  return body.code;
}

beforeEach(() => {
  h.db = new FakeDb();
  h.captured = [];
  seedProfile(PLAYER);
  seedProfile(STAFF, { is_admin: true, first_name: "Staff" });
  seedProfile(VIEWER, { first_name: "Vic" });
});

describe("handle normalisation", () => {
  it("strips @, trims and lowercases", () => {
    expect(normalizeInstagramHandle("  @Pat.Player_9 ")).toBe("pat.player_9");
    expect(normalizeInstagramHandle("@@some_player")).toBe("some_player");
  });
  it("rejects bad characters, empty and over 30", () => {
    expect(normalizeInstagramHandle("pat-player")).toBeNull();
    expect(normalizeInstagramHandle("pat player")).toBeNull();
    expect(normalizeInstagramHandle("@")).toBeNull();
    expect(normalizeInstagramHandle("a".repeat(31))).toBeNull();
    expect(normalizeInstagramHandle("a".repeat(30))).toBe("a".repeat(30));
    expect(normalizeInstagramHandle(42)).toBeNull();
  });
  it("the start route rejects an invalid handle", async () => {
    const res = await start(PLAYER, "not a handle!");
    expect(res.status).toBe(400);
    expect(requests()).toHaveLength(0);
  });
});

describe("code alphabet and format", () => {
  it("has no ambiguous characters", () => {
    for (const ch of "01OIL") expect(VERIFICATION_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(VERIFICATION_CODE_ALPHABET).size).toBe(VERIFICATION_CODE_ALPHABET.length);
  });
  it("generates 6 characters from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    }
    expect(generateVerificationCode(() => 0)).toBe("AAAAAA");
  });
  it("formats, masks and parses admin input", () => {
    expect(formatVerificationCode("ABC234")).toBe("CTP-ABC234");
    expect(maskedVerificationHint("34")).toBe("CTP-••••34");
    expect(normalizeVerificationCodeInput("ctp-abc234")).toBe("ABC234");
    expect(normalizeVerificationCodeInput(" ABC 234 ")).toBe("ABC234");
    expect(normalizeVerificationCodeInput("CTP-ABC0I4")).toBeNull();
    expect(normalizeVerificationCodeInput("ABC23")).toBeNull();
  });
});

describe("DM handle", () => {
  it("comes from the brand module, identical on web and mobile", () => {
    expect(INSTAGRAM_VERIFICATION_HANDLE).toBe("competitivetogether");
    expect(MOBILE_INSTAGRAM_VERIFICATION_HANDLE).toBe(INSTAGRAM_VERIFICATION_HANDLE);
  });
  it("builds the DM copy and Instagram links", () => {
    expect(verificationDmInstruction(INSTAGRAM_VERIFICATION_HANDLE, "pat.player", "CTP-ABC234")).toBe(
      "DM this code to @competitivetogether from @pat.player: CTP-ABC234",
    );
    expect(instagramProfileUrls(INSTAGRAM_VERIFICATION_HANDLE)).toEqual({
      app: "instagram://user?username=competitivetogether",
      web: "https://instagram.com/competitivetogether",
    });
  });
});

describe("hash, seal and expiry", () => {
  it("checks the code against its HMAC hash", () => {
    const hash = hashVerificationCode("ABC234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verificationCodeMatches("ABC234", hash)).toBe(true);
    expect(verificationCodeMatches("ABC235", hash)).toBe(false);
    expect(verificationCodeMatches("ABC234", "zz")).toBe(false);
  });
  it("depends on the secret", () => {
    const hash = hashVerificationCode("ABC234");
    process.env.INSTAGRAM_VERIFY_SECRET = "another-secret";
    try {
      expect(verificationCodeMatches("ABC234", hash)).toBe(false);
    } finally {
      process.env.INSTAGRAM_VERIFY_SECRET = "test-only-instagram-secret";
    }
  });
  it("only the owner can open the sealed code", () => {
    const sealed = sealVerificationCode("ABC234", PLAYER);
    expect(sealed).not.toContain("ABC234");
    expect(openVerificationCode(sealed, PLAYER)).toBe("ABC234");
    expect(openVerificationCode(sealed, VIEWER)).toBeNull();
  });
  it("expires after 7 days", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const expiresAt = verificationExpiresAt(now);
    expect(new Date(expiresAt).getTime() - now.getTime()).toBe(VERIFICATION_TTL_MS);
    expect(isVerificationExpired({ expires_at: expiresAt }, new Date(now.getTime() + VERIFICATION_TTL_MS - 1))).toBe(false);
    expect(isVerificationExpired({ expires_at: expiresAt }, new Date(now.getTime() + VERIFICATION_TTL_MS))).toBe(true);
    expect(verificationCodeHint("ABC234")).toBe("34");
  });
});

describe("requesting a code", () => {
  it("stores hash, hint and ciphertext, never the code, and shows it only to the owner", async () => {
    const code = await startAndGetCode();
    expect(code).toMatch(/^CTP-[A-HJKMNP-Z2-9]{6}$/);
    const row = requests()[0];
    const bare = code.slice(4);
    expect(row).toMatchObject({ user_id: PLAYER, handle: "pat.player", status: "pending", code_hint: bare.slice(-2) });
    expect(JSON.stringify(row)).not.toContain(bare);
    expect(verificationCodeMatches(bare, String(row.code_hash))).toBe(true);

    const again = (await (await status(PLAYER)).json()) as { status: string; code: string };
    expect(again).toMatchObject({ status: "pending", code });
  });

  it("allows only one pending request", async () => {
    await startAndGetCode();
    const res = await start(PLAYER, "other.handle");
    expect(res.status).toBe(409);
    expect(requests()).toHaveLength(1);
  });

  it("an expired request frees the slot and reports expired", async () => {
    await startAndGetCode();
    requests()[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(((await (await status(PLAYER)).json()) as { status: string; code: string | null })).toMatchObject({
      status: "expired",
      code: null,
    });
    const code = await startAndGetCode("pat.player");
    expect(requests()[0].status).toBe("expired");
    expect(requests()).toHaveLength(2);
    expect(code).toMatch(/^CTP-/);
  });

  it("never reuses a code: a colliding hash is retried with a new code", async () => {
    const taken = hashVerificationCode("AAAAAA");
    requests().push({ id: "old", user_id: VIEWER, code_hash: taken, status: "approved" });
    let calls = 0;
    h.randomInt = () => (calls++ < 6 ? 0 : 1);
    try {
      const code = await startAndGetCode();
      expect(calls).toBe(12);
      expect(code).toBe("CTP-BBBBBB");
      expect(new Set(requests().map((r) => r.code_hash)).size).toBe(requests().length);
    } finally {
      h.randomInt = null;
    }
  });

  it("refuses players who are already verified", async () => {
    profile(PLAYER).verification_level = "document";
    expect((await start(PLAYER, "pat")).status).toBe(409);
    profile(PLAYER).verification_level = "instagram";
    expect((await start(PLAYER, "pat")).status).toBe(409);
  });

  it("rate limits code generation to 5 a day", async () => {
    for (let i = 0; i < 5; i++) {
      await startAndGetCode();
      requests()[requests().length - 1].status = "rejected";
      requests()[requests().length - 1].reject_reason = "x";
    }
    const res = await start(PLAYER, "pat.player");
    expect(res.status).toBe(429);
    expect(requests()).toHaveLength(5);
  });

  it("fails closed when the rate limit store is unavailable", async () => {
    h.db.rpcFails = true;
    const res = await start(PLAYER, "pat.player");
    expect(res.status).toBe(503);
    expect(requests()).toHaveLength(0);
  });

  it("requires sign-in", async () => {
    expect((await start(null, "pat")).status).toBe(401);
  });
});

describe("admin review", () => {
  it("non-admins get 403 on list and review", async () => {
    await startAndGetCode();
    expect((await adminGET(req("/api/admin/instagram-verification", VIEWER))).status).toBe(403);
    expect((await review(VIEWER, { request_id: "req-1", decision: "reject", reason: "no" })).status).toBe(403);
    expect((await adminGET(req("/api/admin/instagram-verification", null))).status).toBe(401);
  });

  it("the queue shows handle, masked hint, name and avatar but never the code", async () => {
    const code = await startAndGetCode();
    const res = await adminGET(req("/api/admin/instagram-verification", STAFF));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Row[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ handle: "pat.player", code_hint: code.slice(-2), name: "Pat Player", avatar_url: null });
    const text = JSON.stringify(body);
    expect(text).not.toContain(code.slice(4));
    expect(text).not.toContain("code_hash");
    expect(text).not.toContain("code_ciphertext");
  });

  it("approve with the right code sets instagram on both columns and records the reviewer", async () => {
    const code = await startAndGetCode();
    h.db.rows("player_ratings").push({ user_id: PLAYER, score: 80, verification: "self" });
    const res = await review(STAFF, { request_id: "req-1", decision: "approve", code: code.toLowerCase(), level: LEVEL_COLLEGE });
    expect(res.status).toBe(200);
    expect(profile(PLAYER).verification_level).toBe("instagram");
    expect(h.db.rows("player_ratings")[0]).toMatchObject({ verification: "instagram", seeded_level: 4.0 });
    expect(h.db.rows("rating_seed_log")[0]).toMatchObject({ user_id: PLAYER, actor_id: STAFF, source: "admin", chosen_level: 4.0 });
    expect(requests()[0]).toMatchObject({ status: "approved", reviewed_by: STAFF });
    expect(typeof requests()[0].reviewed_at).toBe("string");
  });

  it("approve without a level is rejected and changes nothing", async () => {
    const code = await startAndGetCode();
    h.db.rows("player_ratings").push({ user_id: PLAYER, score: 50, verification: "self", star_provisional: true });
    for (const level of [undefined, null, "", "abc", 0.5, 2.2, 5.5]) {
      const res = await review(STAFF, { request_id: "req-1", decision: "approve", code, level });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/starting level/i);
    }
    expect(profile(PLAYER).verification_level).toBe("self");
    expect(h.db.rows("player_ratings")[0].verification).toBe("self");
    expect(h.db.rows("rating_seed_log")).toHaveLength(0);
    expect(requests()[0].status).toBe("pending");
    expect(requests()[0].reviewed_by ?? null).toBeNull();
  });

  it("approving at 3.0 verifies the profile but keeps the 3.0 cap", async () => {
    const code = await startAndGetCode();
    h.db.rows("player_ratings").push({ user_id: PLAYER, score: 50, verification: "self", star_provisional: true });
    const res = await review(STAFF, { request_id: "req-1", decision: "approve", code, level: 3.0 });
    expect(res.status).toBe(200);
    expect(profile(PLAYER).verification_level).toBe("instagram");
    expect(h.db.rows("player_ratings")[0]).toMatchObject({ verification: "self", seeded_level: 3.0 });
    expect(h.db.rows("rating_seed_log")[0]).toMatchObject({ chosen_level: 3.0 });
  });

  it("lifts the cap only for a level above 3.0", async () => {
    const lifted: Record<string, boolean> = {};
    for (const level of [1.0, 2.5, 3.0, 3.5, 4.0, 5.0]) {
      h.db.tables = {};
      h.db.rateBuckets.clear();
      seedProfile(PLAYER);
      seedProfile(STAFF, { is_admin: true, first_name: "Staff" });
      h.db.rows("player_ratings").push({ user_id: PLAYER, score: 50, verification: "self", star_provisional: true });
      const code = await startAndGetCode();
      const res = await review(STAFF, { request_id: "req-1", decision: "approve", code, level });
      expect(res.status).toBe(200);
      lifted[String(level)] = h.db.rows("player_ratings")[0].verification === "instagram";
    }
    expect(lifted).toEqual({ "1": false, "2.5": false, "3": false, "3.5": true, "4": true, "5": true });
  });

  it("answers unavailable and rolls back when the level migration has not run", async () => {
    const code = await startAndGetCode();
    h.db.migratedFunctions.delete("approve_instagram_with_level");
    const res = await review(STAFF, { request_id: "req-1", decision: "approve", code, level: LEVEL_COLLEGE });
    expect(res.status).toBe(503);
    expect(profile(PLAYER).verification_level).toBe("self");
    expect(requests()[0].status).toBe("pending");
  });

  it("approve with the wrong code changes nothing", async () => {
    const code = await startAndGetCode();
    const wrong = code.slice(0, -1) + (code.endsWith("A") ? "B" : "A");
    const res = await review(STAFF, { request_id: "req-1", decision: "approve", code: wrong, level: LEVEL_COLLEGE });
    expect(res.status).toBe(400);
    expect(profile(PLAYER).verification_level).toBe("self");
    expect(requests()[0].status).toBe("pending");
  });

  it("approve fails on an expired code", async () => {
    const code = await startAndGetCode();
    requests()[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await review(STAFF, { request_id: "req-1", decision: "approve", code, level: LEVEL_COLLEGE });
    expect(res.status).toBe(409);
    expect(requests()[0].status).toBe("expired");
    expect(profile(PLAYER).verification_level).toBe("self");
  });

  it("a failed rating write rolls the approval back", async () => {
    const code = await startAndGetCode();
    h.db.failWrites.add("rpc.approve_instagram_with_level");
    const res = await review(STAFF, { request_id: "req-1", decision: "approve", code, level: LEVEL_COLLEGE });
    expect(res.status).toBe(500);
    expect(profile(PLAYER).verification_level).toBe("self");
    expect(requests()[0]).toMatchObject({ status: "pending", reviewed_by: null });
  });

  it("reject needs a reason, then shows Not approved with it and allows a retry", async () => {
    await startAndGetCode();
    expect((await review(STAFF, { request_id: "req-1", decision: "reject", reason: "   " })).status).toBe(400);
    expect(requests()[0].status).toBe("pending");

    const res = await review(STAFF, { request_id: "req-1", decision: "reject", reason: "DM came from a different account" });
    expect(res.status).toBe(200);
    expect(requests()[0]).toMatchObject({ status: "rejected", reviewed_by: STAFF, reject_reason: "DM came from a different account" });
    expect(await (await status(PLAYER)).json()).toMatchObject({
      status: "rejected",
      reject_reason: "DM came from a different account",
      code: null,
    });
    await startAndGetCode();
    expect(requests()).toHaveLength(2);
  });

  it("cannot review twice", async () => {
    const code = await startAndGetCode();
    expect((await review(STAFF, { request_id: "req-1", decision: "approve", code, level: LEVEL_COLLEGE })).status).toBe(200);
    expect((await review(STAFF, { request_id: "req-1", decision: "reject", reason: "x" })).status).toBe(409);
  });
});

describe("show Instagram toggle", () => {
  async function verify() {
    const code = await startAndGetCode("pat.player");
    await review(STAFF, { request_id: "req-1", decision: "approve", code, level: LEVEL_COLLEGE });
  }
  const toggle = (userId: string, show: unknown) => visibilityPOST(req("/api/account/instagram-visibility", userId, { show }));
  const publicProfile = async () => {
    const res = await publicProfileGET(req(`/api/profile/public/${PLAYER}`, VIEWER), { params: Promise.resolve({ userId: PLAYER }) });
    return (await res.json()) as Row;
  };

  it("cannot be turned on before Instagram verification", async () => {
    expect((await toggle(PLAYER, true)).status).toBe(409);
    expect(profile(PLAYER).show_instagram).toBe(false);
  });

  it("the public profile has the handle only when verified and toggled on", async () => {
    await verify();
    expect(profile(PLAYER).instagram_handle).toBeNull();
    expect(await publicProfile()).not.toHaveProperty("instagram_handle");

    expect((await toggle(PLAYER, true)).status).toBe(200);
    expect(profile(PLAYER)).toMatchObject({ show_instagram: true, instagram_handle: "pat.player" });
    expect(await publicProfile()).toMatchObject({ instagram_handle: "pat.player" });

    expect((await toggle(PLAYER, false)).status).toBe(200);
    expect(profile(PLAYER)).toMatchObject({ show_instagram: false, instagram_handle: null });
    expect(await publicProfile()).not.toHaveProperty("instagram_handle");
  });

  it("a stale handle is not shown once verification is no longer instagram", async () => {
    await verify();
    await toggle(PLAYER, true);
    profile(PLAYER).verification_level = "self";
    expect(await publicProfile()).not.toHaveProperty("instagram_handle");
  });

  it("rejects a non-boolean body", async () => {
    expect((await toggle(PLAYER, "yes")).status).toBe(400);
  });
});

describe("before the migrations run", () => {
  beforeEach(() => {
    h.db.missingTables.add(TABLE);
    h.db.missingColumns.profiles = ["show_instagram", "instagram_handle"];
  });

  it("the player sees Verification isn't available yet", async () => {
    for (const res of [await status(PLAYER), await start(PLAYER, "pat.player"), await visibilityPOST(req("/api/account/instagram-visibility", PLAYER, { show: true }))]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: VERIFICATION_UNAVAILABLE_MESSAGE, unavailable: true });
    }
  });

  it("the admin queue reports unavailable", async () => {
    const res = await adminGET(req("/api/admin/instagram-verification", STAFF));
    expect(res.status).toBe(503);
    expect((await review(STAFF, { request_id: "x", decision: "reject", reason: "r" })).status).toBe(503);
  });

  it("the public profile still loads without the handle", async () => {
    const res = await publicProfileGET(req(`/api/profile/public/${PLAYER}`, VIEWER), { params: Promise.resolve({ userId: PLAYER }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Row;
    expect(body).toMatchObject({ id: PLAYER });
    expect(body).not.toHaveProperty("instagram_handle");
  });

  it("a missing secret is reported as unavailable, not as a crash", async () => {
    h.db.missingTables.clear();
    h.db.missingColumns = {};
    delete process.env.INSTAGRAM_VERIFY_SECRET;
    try {
      const res = await start(PLAYER, "pat.player");
      expect(res.status).toBe(503);
      expect(h.captured.length).toBeGreaterThan(0);
    } finally {
      process.env.INSTAGRAM_VERIFY_SECRET = "test-only-instagram-secret";
    }
  });
});
