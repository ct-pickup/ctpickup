import { beforeEach, describe, expect, it, vi } from "vitest";

type State = {
  flags: Record<string, { enabled: boolean; allowlist: string[]; note?: string | null } | undefined>;
  admins: Set<string>;
  users: Record<string, string>; // id -> email
  flagsError: boolean;
  profilesError: boolean;
  events: Record<string, unknown>[];
};
const h = vi.hoisted(() => ({
  s: { flags: {}, admins: new Set<string>(), users: {}, flagsError: false, profilesError: false, events: [] } as State,
  tokens: { t_user: "user-1", t_admin: "admin-1", t_listed: "listed-1", t_other: "other-1" } as Record<string, string>,
}));

function fakeAdmin() {
  const chain = (table: string) => {
    const f: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        f[c] = v;
        return q;
      },
      ilike: (c: string, v: unknown) => {
        f[c] = v;
        return q;
      },
      order: () => q,
      limit: () => Promise.resolve({ data: h.s.events, error: null }),
      maybeSingle: async () => {
        if (table === "app_flags") {
          if (h.s.flagsError) return { data: null, error: { message: "relation app_flags does not exist" } };
          const r = h.s.flags[String(f.key)];
          return { data: r ? { key: f.key, ...r } : null, error: null };
        }
        if (table === "profiles") {
          if (h.s.profilesError) return { data: null, error: { message: "boom" } };
          if ("email" in f) {
            const id = Object.keys(h.s.users).find((u) => h.s.users[u] === String(f.email).toLowerCase());
            return { data: id ? { id } : null, error: null };
          }
          return { data: { is_admin: h.s.admins.has(String(f.id)), approved: true, first_name: "Sam", last_name: "R", nearest_venue: "" }, error: null };
        }
        return { data: null, error: null };
      },
      upsert: async (row: { key: string; enabled: boolean; allowlist: string[] }) => {
        h.s.flags[row.key] = { enabled: row.enabled, allowlist: row.allowlist };
        return { error: null };
      },
      insert: (row: Record<string, unknown>) => {
        if (table === "app_flag_events") h.s.events.push({ id: h.s.events.length + 1, created_at: "now", ...row });
        return Object.assign(Promise.resolve({ error: null }), { select: () => ({ maybeSingle: async () => ({ data: { id: "run-1" }, error: null }) }) });
      },
      then: undefined,
    };
    return q;
  };
  return {
    auth: {
      getUser: async (token: string) => (h.tokens[token] ? { data: { user: { id: h.tokens[token] } }, error: null } : { data: { user: null }, error: { message: "bad" } }),
      admin: {
        getUserById: async (id: string) => ({ data: { user: h.s.users[id] ? { email: h.s.users[id] } : null } }),
        listUsers: async () => ({ data: { users: Object.entries(h.s.users).map(([id, email]) => ({ id, email })) }, error: null }),
      },
    },
    from: chain,
  };
}

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => fakeAdmin() }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => fakeAdmin() }));
vi.mock("@/lib/server/persistentRateLimit", () => ({ checkPersistentRateLimit: async () => ({ ok: true }), rateLimitResponse: () => new Response("limited", { status: 429 }) }));
vi.mock("@/lib/fields/venueReports", () => ({ submitReport: async () => ({ ok: true }) }));
vi.mock("@/lib/profilePhoto/requirement", () => ({ profilePhotoGate: async () => null }));
vi.mock("@/lib/pickup/sessionLifecycle", () => ({ promotePlanningRunsPastStart: async () => undefined, scheduleSessionRateRemindersForRun: async () => undefined }));
vi.mock("@/lib/pickup/pickupPushNotifications", () => ({ approvedUserIdsInRunServiceRegion: async () => [] }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));
vi.mock("@/lib/push/adminUserIds", () => ({ fetchAdminUserIds: async () => [] }));

import { POST as checkoutPOST } from "@/app/api/plans/checkout/route";
import { GET as flagsGET, POST as flagsPOST } from "@/app/api/admin/flags/route";
import { POST as reportPOST } from "@/app/api/fields/report/route";
import { POST as requestsPOST } from "@/app/api/fields/requests/route";
import { POST as sessionsPOST } from "@/app/api/sessions/create/route";
import { evaluateFlag, isFlagOn, requireFlag } from "@/lib/flags";
import { changeFlag } from "@/lib/flagsAdmin";

const post = (url: string, token: string, body: unknown) =>
  new Request(`http://x${url}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  h.s.flags = { fields: { enabled: false, allowlist: [] }, paid_plans: { enabled: false, allowlist: [] } };
  h.s.admins = new Set(["admin-1"]);
  h.s.users = { "user-1": "user@x.com", "admin-1": "admin@x.com", "listed-1": "listed@x.com", "other-1": "other@x.com" };
  h.s.flagsError = false;
  h.s.profilesError = false;
  h.s.events = [];
});

describe("the flag rule", () => {
  it.each([
    ["off, ordinary player", { enabled: false, allowlist: [] }, "u", false, false],
    ["on for everyone", { enabled: true, allowlist: [] }, "u", false, true],
    ["on the allowlist", { enabled: false, allowlist: ["x", "u"] }, "u", false, true],
    ["allowlist of someone else", { enabled: false, allowlist: ["x"] }, "u", false, false],
    ["admin, flag off", { enabled: false, allowlist: [] }, "u", true, true],
    ["admin, no row at all", null, "u", true, true],
    ["no row, ordinary player", null, "u", false, false],
    ["no user", { enabled: true, allowlist: [] }, null, false, false],
    ["enabled is not a boolean", { enabled: "true" as never, allowlist: [] }, "u", false, false],
  ] as const)("%s", (_n, row, user, admin, want) => {
    expect(evaluateFlag(row as never, user, admin)).toBe(want);
  });
  it("reads the table and the admin bit; any read failure is OFF (admins keep working)", async () => {
    const admin = fakeAdmin() as never;
    expect(await isFlagOn(admin, "fields", "user-1")).toBe(false);
    h.s.flags.fields = { enabled: false, allowlist: ["user-1"] };
    expect(await isFlagOn(admin, "fields", "user-1")).toBe(true);
    expect(await isFlagOn(admin, "fields", "admin-1")).toBe(true);
    h.s.flags.fields = { enabled: true, allowlist: [] };
    h.s.flagsError = true;
    expect(await isFlagOn(admin, "fields", "user-1")).toBe(false);
    expect(await isFlagOn(admin, "fields", "admin-1")).toBe(true);
    h.s.profilesError = true;
    expect(await isFlagOn(admin, "fields", "admin-1")).toBe(false);
    expect(await isFlagOn({ from: () => { throw new Error("down"); } } as never, "fields", "user-1")).toBe(false);
  });
  it("requireFlag answers 403 {error: feature_off} unless every flag is on", async () => {
    const admin = fakeAdmin() as never;
    const off = await requireFlag(admin, ["paid_plans", "fields"], "user-1");
    expect(off?.status).toBe(403);
    expect(await off?.json()).toEqual({ error: "feature_off" });
    h.s.flags = { fields: { enabled: true, allowlist: [] }, paid_plans: { enabled: false, allowlist: [] } };
    expect((await requireFlag(admin, ["paid_plans", "fields"], "user-1"))?.status).toBe(403);
    h.s.flags.paid_plans = { enabled: false, allowlist: ["user-1"] };
    expect(await requireFlag(admin, ["paid_plans", "fields"], "user-1")).toBeNull();
  });
});

describe("Fields API routes", () => {
  const reqBody = { venue_key: "nope", requested_date: "2030-01-01", start_time: "18:00", players: 10, duration_hours: 1 };

  it("POST /api/fields/requests: 403 feature_off when off, and past the flag when on", async () => {
    const off = await requestsPOST(post("/api/fields/requests", "t_user", reqBody));
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual({ error: "feature_off" });
    h.s.flags.fields = { enabled: true, allowlist: [] };
    expect((await requestsPOST(post("/api/fields/requests", "t_user", reqBody))).status).not.toBe(403);
  });
  it("POST /api/fields/requests: the allowlist and admins get through while it is off for everyone", async () => {
    h.s.flags.fields = { enabled: false, allowlist: ["listed-1"] };
    expect((await requestsPOST(post("/api/fields/requests", "t_listed", reqBody))).status).not.toBe(403);
    expect((await requestsPOST(post("/api/fields/requests", "t_admin", reqBody))).status).not.toBe(403);
    expect((await requestsPOST(post("/api/fields/requests", "t_other", reqBody))).status).toBe(403);
  });
  it("POST /api/fields/report: 403 when off, ok when on", async () => {
    const body = { venue_key: "v", problem: "wrong_info" };
    expect((await reportPOST(post("/api/fields/report", "t_user", body))).status).toBe(403);
    h.s.flags.fields = { enabled: true, allowlist: [] };
    const ok = await reportPOST(post("/api/fields/report", "t_user", body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
  });
  it("POST /api/plans/checkout needs paid_plans AND fields", async () => {
    const body = { plan: "nope" };
    expect((await checkoutPOST(post("/api/plans/checkout", "t_user", body))).status).toBe(403);
    h.s.flags.fields = { enabled: true, allowlist: [] };
    const stillOff = await checkoutPOST(post("/api/plans/checkout", "t_user", body));
    expect(stillOff.status).toBe(403);
    expect(await stillOff.json()).toEqual({ error: "feature_off" });
    h.s.flags.paid_plans = { enabled: true, allowlist: [] };
    expect((await checkoutPOST(post("/api/plans/checkout", "t_user", body))).status).toBe(400); // "Pick a plan." (past the flags)
    expect((await checkoutPOST(post("/api/plans/checkout", "t_admin", body))).status).toBe(400);
  });
  it("POST /api/sessions/create: a game at a field needs 'fields'; a game without a field never looks at the flag", async () => {
    const base = { location_text: "Field", start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), capacity: 10, format: "Open" };
    const withField = await sessionsPOST(post("/api/sessions/create", "t_user", { ...base, venue_key: "osm-1" }));
    expect(withField.status).toBe(403);
    expect(await withField.json()).toEqual({ error: "feature_off" });
    const withRequest = await sessionsPOST(post("/api/sessions/create", "t_user", { ...base, venue_request_id: "r1" }));
    expect(withRequest.status).toBe(403);
    h.s.flagsError = true; // a broken flags table must not affect ordinary games
    expect((await sessionsPOST(post("/api/sessions/create", "t_user", base))).status).not.toBe(403);
  });
});

describe("admin: change a flag", () => {
  const admin = () => fakeAdmin() as never;
  it("turns it on for everyone and logs who did it", async () => {
    const r = await changeFlag(admin(), "admin-1", { key: "fields", enabled: true });
    expect(r.ok && r.flag.enabled).toBe(true);
    expect(h.s.flags.fields?.enabled).toBe(true);
    expect(h.s.events).toHaveLength(1);
    expect(h.s.events[0]).toMatchObject({ flag_key: "fields", actor_id: "admin-1", change: { enabled: { from: false, to: true } } });
  });
  it("resolves an email to an id server-side, adds it once, and removes it", async () => {
    let r = await changeFlag(admin(), "admin-1", { key: "paid_plans", add_email: "  Listed@X.com " });
    expect(r.ok && r.flag.allowlist).toEqual([{ id: "listed-1", email: "listed@x.com" }]);
    await changeFlag(admin(), "admin-1", { key: "paid_plans", add_email: "listed@x.com" });
    expect(h.s.flags.paid_plans?.allowlist).toEqual(["listed-1"]);
    expect(h.s.events).toHaveLength(1); // adding the same player twice changes nothing and logs nothing
    r = await changeFlag(admin(), "admin-1", { key: "paid_plans", remove_id: "listed-1" });
    expect(h.s.flags.paid_plans?.allowlist).toEqual([]);
    expect(h.s.events[1]).toMatchObject({ change: { removed: { id: "listed-1" } } });
  });
  it("refuses an unknown email, an unknown flag and a bad value", async () => {
    expect(await changeFlag(admin(), "a", { key: "fields", add_email: "nobody@x.com" })).toMatchObject({ ok: false, status: 404 });
    expect(await changeFlag(admin(), "a", { key: "everything", enabled: true })).toMatchObject({ ok: false, status: 400 });
    expect(await changeFlag(admin(), "a", { key: "fields", enabled: "yes" })).toMatchObject({ ok: false, status: 400 });
    expect(h.s.events).toHaveLength(0);
  });
  it("the admin route is admin only", async () => {
    expect((await flagsPOST(post("/api/admin/flags", "t_user", { key: "fields", enabled: true }))).status).toBe(403);
    expect(h.s.flags.fields?.enabled).toBe(false);
    expect((await flagsGET(new Request("http://x/api/admin/flags", { headers: { authorization: "Bearer t_user" } }))).status).toBe(403);
    const ok = await flagsPOST(post("/api/admin/flags", "t_admin", { key: "fields", enabled: true }));
    expect(ok.status).toBe(200);
    expect(h.s.flags.fields?.enabled).toBe(true);
  });
});
