import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./payments/fakes";

class PhotoDb extends FakeSupabase {
  rateLimit: "allow" | "limited" | "error" = "allow";
  rpcCalls: string[] = [];
  removed: string[] = [];
  async rpc(_fn: string, args: { p_bucket_key: string }) {
    this.rpcCalls.push(args.p_bucket_key);
    if (this.rateLimit === "error") return { data: null, error: { message: "function api_rate_limit_check does not exist" } };
    return { data: { allowed: this.rateLimit === "allow", retry_after_seconds: 60 }, error: null };
  }
  storage = {
    from: (_bucket: string) => ({
      remove: async (paths: string[]) => {
        this.removed.push(...paths);
        return { data: null, error: null };
      },
    }),
  };
}

const h = vi.hoisted(() => ({
  db: null as unknown as PhotoDb,
  pushes: [] as { userIds: string[]; title: string; data?: Record<string, unknown> }[],
  sentry: [] as string[],
}));

vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => h.db,
  getStripePickup: () => {
    throw new Error("stripe not used");
  },
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => h.db }));
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown) => h.sentry.push(String(e)),
  captureMessage: (m: string) => h.sentry.push(m),
}));
vi.mock("@/lib/push/sendExpoPush", () => ({
  sendPushToUsers: async (_a: unknown, userIds: string[], msg: { title: string; data?: Record<string, unknown> }) => {
    h.pushes.push({ userIds, title: msg.title, data: msg.data });
    return { tokens: 1, batches: [] };
  },
}));
vi.mock("@/lib/pickup/pickupPushNotifications", () => ({
  sendPickupRsvpConfirmedPush: async () => undefined,
  approvedUserIdsInRunServiceRegion: async () => [],
}));
vi.mock("@/lib/pickup/sessionLifecycle", () => ({
  scheduleSessionRateRemindersForRun: async () => undefined,
  promotePlanningRunsPastStart: async () => undefined,
}));
vi.mock("@/lib/waiver/checkWaiverAccepted", () => ({ userHasAcceptedCurrentWaiver: async () => true }));
vi.mock("@/lib/pickup/standing/participationGate", () => ({
  assertPickupStandingAllowsParticipation: async () => ({ ok: true }),
}));
vi.mock("@/lib/pickup/ensureRunInviteLink", () => ({ ensurePickupRunInviteLink: async () => undefined }));
vi.mock("@/lib/pickup/lookupPlayerByIdentifier", () => ({ lookupPickupPlayerByUsernameOrEmail: async () => null }));
vi.mock("@/lib/payments/recordCheckoutStarted", () => ({ recordPlatformCheckoutStarted: async () => undefined }));
vi.mock("@/lib/chat/runBanterRoom", () => ({
  addUserToRunBanterRoom: async () => undefined,
  removeUserFromRunBanterRoom: async () => undefined,
}));
vi.mock("@/lib/pickup/notifyFollowersOnPickupConfirm", () => ({ notifyFollowersWhenFollowedPlayerConfirmsRun: async () => undefined }));
vi.mock("@/lib/referral/pickupReferralCredit", () => ({ tryApplyReferralCreditToPickupJoin: async () => ({ applied: false }) }));
vi.mock("@/lib/pickup/waitlist", () => ({
  countAcceptedPickupRsvps: async () => 0,
  deletePendingWaitlistExpiringReminders: async () => undefined,
  promoteNextWaitlistPlayer: async () => ({ ok: true, promoted_user_id: null }),
}));
vi.mock("@/lib/pickup/hubPromote", () => ({ clearCurrentPickupRunsInRegion: async () => ({ ok: true }) }));

import { POST as rsvpPOST } from "@/app/api/pickup/rsvp/route";
import { POST as createPOST } from "@/app/api/sessions/create/route";
import { POST as adminCreateRunPOST } from "@/app/api/admin/pickup/create-run/route";
import { POST as reportPOST } from "@/app/api/profile-photo/report/route";
import { GET as statusGET } from "@/app/api/profile-photo/status/route";
import { GET as adminListGET, POST as adminReviewPOST } from "@/app/api/admin/photo-reports/route";
import { isProfilePhotoRequired } from "@/lib/profilePhoto/requirement";
import {
  AVATAR_PICKER_OPTIONS,
  avatarResize,
  avatarStoragePath,
  PHOTO_REQUIRED_LEGACY_MESSAGE,
  PHOTO_REQUIRED_MESSAGE,
} from "@/shared/profilePhoto";

const PLAYER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const FRIEND = "44444444-4444-4444-8444-444444444444";
const RUN = "run-1";
const AVATAR = "https://x.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar-1.jpg";

function post(handler: (r: Request) => Promise<Response>, url: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new Request(`http://test.local${url}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-app-version": "1.4.0", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const LEGACY_HEADERS = { "x-app-version": "", "user-agent": "CTPickup/47 CFNetwork/1490.0.4 Darwin/23.2.0" };

function profile(id: string, extra: Record<string, unknown> = {}) {
  h.db.rows("profiles").push({
    id,
    approved: true,
    is_admin: false,
    is_banned: false,
    tier_rank: 1,
    tier: null,
    first_name: "Pat",
    last_name: id.slice(0, 4),
    username: `u${id.slice(0, 4)}`,
    nearest_venue: null,
    avatar_url: null,
    ...extra,
  });
}

function seedFreeRun() {
  h.db.rows("pickup_runs").push({
    id: RUN,
    title: "Tuesday Run",
    run_type: "public",
    created_by: null,
    final_slot_id: null,
    fee_cents: 0,
    status: "active",
    capacity: 10,
    start_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
  });
}

const join = (token = PLAYER, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  post(rsvpPOST, "/api/pickup/rsvp", token, { action: "join", run_id: RUN, ...extra }, headers);

const host = (token = PLAYER) =>
  post(createPOST, "/api/sessions/create", token, {
    location_text: "Town field",
    start_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
    start_date: "2099-01-01",
    start_time: "18:00",
    capacity: 10,
    format: "Open",
  });

beforeEach(() => {
  h.db = new PhotoDb();
  h.pushes = [];
  h.sentry = [];
  vi.stubEnv("REQUIRE_PROFILE_PHOTO", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("REQUIRE_PROFILE_PHOTO flag", () => {
  it("is off unless set to true", () => {
    expect(isProfilePhotoRequired({})).toBe(false);
    expect(isProfilePhotoRequired({ REQUIRE_PROFILE_PHOTO: "false" })).toBe(false);
    expect(isProfilePhotoRequired({ REQUIRE_PROFILE_PHOTO: "1" })).toBe(false);
    expect(isProfilePhotoRequired({ REQUIRE_PROFILE_PHOTO: " TRUE " })).toBe(true);
  });

  it("flag off: join and host go through without a photo", async () => {
    vi.stubEnv("REQUIRE_PROFILE_PHOTO", "");
    profile(PLAYER);
    seedFreeRun();
    const j = await join();
    expect(j.status).toBe(200);
    expect((await j.json()).status).toBe("confirmed");
    const c = await host();
    expect(c.status).toBe(200);
  });

  it("status endpoint reports the flag", async () => {
    profile(PLAYER);
    const on = await (await statusGET(new Request("http://t/api/profile-photo/status", { headers: { authorization: `Bearer ${PLAYER}` } }))).json();
    expect(on).toEqual({ required: true, has_photo: false, removed: false });
    vi.stubEnv("REQUIRE_PROFILE_PHOTO", "false");
    const off = await (await statusGET(new Request("http://t/api/profile-photo/status"))).json();
    expect(off).toEqual({ required: false });
  });
});

describe("join (/api/pickup/rsvp) with the flag on", () => {
  it("rejects a player without a photo with 403 photo_required and a friendly message", async () => {
    profile(PLAYER);
    seedFreeRun();
    const r = await join();
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: PHOTO_REQUIRED_MESSAGE, code: "photo_required" });
    expect(h.db.rows("pickup_run_rsvps")).toHaveLength(0);
  });

  it("accepts a player with a photo", async () => {
    profile(PLAYER, { avatar_url: AVATAR });
    seedFreeRun();
    const r = await join();
    expect(r.status).toBe(200);
    expect(h.db.rows("pickup_run_rsvps")[0]).toMatchObject({ user_id: PLAYER, status: "confirmed" });
  });

  it("admins joining as a player are not exempt", async () => {
    profile(PLAYER, { is_admin: true });
    seedFreeRun();
    expect((await join()).status).toBe(403);
  });

  it("does not block finishing an already-held spot", async () => {
    profile(PLAYER);
    seedFreeRun();
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "pending_payment" });
    expect((await join()).status).toBe(200);
  });

  it("does not block leaving", async () => {
    profile(PLAYER);
    seedFreeRun();
    h.db.rows("pickup_run_rsvps").push({ run_id: RUN, user_id: PLAYER, status: "waitlist" });
    const r = await post(rsvpPOST, "/api/pickup/rsvp", PLAYER, { action: "decline", run_id: RUN });
    expect(r.status).toBe(200);
  });

  it("paying for a friend checks the friend's photo, not the payer's", async () => {
    profile(PLAYER);
    profile(FRIEND);
    seedFreeRun();
    const r = await join(PLAYER, { friend_user_id: FRIEND });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("friend_photo_required");
    h.db.rows("profiles").find((p) => p.id === FRIEND)!.avatar_url = AVATAR;
    expect((await join(PLAYER, { friend_user_id: FRIEND })).status).toBe(200);
  });

  it("legacy v1.3.5 clients are blocked too, with a message to update or use the website", async () => {
    profile(PLAYER);
    seedFreeRun();
    const r = await join(PLAYER, {}, LEGACY_HEADERS);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: PHOTO_REQUIRED_LEGACY_MESSAGE, code: "photo_required" });
  });

  it("lets the join through if the avatar lookup fails", async () => {
    profile(PLAYER);
    seedFreeRun();
    h.db.missingColumns.profiles = ["avatar_url"];
    expect((await join()).status).toBe(200);
  });
});

describe("host (/api/sessions/create) with the flag on", () => {
  it("rejects without a photo, admins included", async () => {
    profile(PLAYER, { is_admin: true });
    const r = await host();
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("photo_required");
    expect(h.db.rows("pickup_runs")).toHaveLength(0);
  });

  it("accepts with a photo", async () => {
    profile(PLAYER, { avatar_url: AVATAR });
    const r = await host();
    expect(r.status).toBe(200);
    expect(h.db.rows("pickup_runs")).toHaveLength(1);
  });
});

describe("admin operator paths are unaffected", () => {
  it("admin create-run works for an admin without a photo", async () => {
    profile(ADMIN, { is_admin: true });
    const base = h.db.from.bind(h.db);
    h.db.from = (table: string) => {
      const q = base(table);
      if (table !== "pickup_runs") return q;
      return Object.assign(q, {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({ single: async () => ({ data: { id: "run-new", ...row }, error: null }) }),
        }),
      });
    };
    const r = await post(adminCreateRunPOST, "/api/admin/pickup/create-run", ADMIN, {
      title: "Ops run",
      run_type: "select",
      start_at: "2099-01-01T18:00",
    });
    expect(r.status).not.toBe(403);
    expect(JSON.stringify(await r.json())).not.toContain("photo_required");
  });
});

describe("report photo", () => {
  const report = (body: Record<string, unknown>, token = PLAYER) => post(reportPOST, "/api/profile-photo/report", token, body);

  beforeEach(() => {
    profile(PLAYER);
    profile(OTHER, { avatar_url: AVATAR });
  });

  it("creates an open report with a photo snapshot", async () => {
    const r = await report({ reported_user_id: OTHER, reason: "not_them" });
    expect(r.status).toBe(200);
    expect(h.db.rows("photo_reports")[0]).toMatchObject({
      reporter_id: PLAYER,
      reported_user_id: OTHER,
      photo_url: AVATAR,
      reason: "not_them",
      status: "open",
    });
    expect(h.db.rpcCalls).toEqual([`photo_report:${PLAYER}`]);
  });

  it("stores no reason when none or an unknown one is given", async () => {
    await report({ reported_user_id: OTHER, reason: "made up" });
    expect(h.db.rows("photo_reports")[0].reason).toBeNull();
  });

  it("allows one open report per reporter per player", async () => {
    await report({ reported_user_id: OTHER });
    const again = await report({ reported_user_id: OTHER, reason: "other" });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("already_reported");
    expect(h.db.rows("photo_reports")).toHaveLength(1);
  });

  it("rate limits", async () => {
    h.db.rateLimit = "limited";
    const r = await report({ reported_user_id: OTHER });
    expect(r.status).toBe(429);
    expect(h.db.rows("photo_reports")).toHaveLength(0);
  });

  it("fails closed when the rate limit store is unavailable", async () => {
    h.db.rateLimit = "error";
    const r = await report({ reported_user_id: OTHER });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("Reporting isn't available right now. Try again in a moment.");
    expect(h.db.rows("photo_reports")).toHaveLength(0);
    expect(h.sentry.some((m) => m.includes("rate limit"))).toBe(true);
  });

  it("refuses self reports and players without a photo", async () => {
    expect((await report({ reported_user_id: PLAYER })).status).toBe(400);
    profile(FRIEND);
    expect((await report({ reported_user_id: FRIEND })).status).toBe(409);
  });
});

describe("admin photo review", () => {
  const review = (body: Record<string, unknown>, token = ADMIN) => post(adminReviewPOST, "/api/admin/photo-reports", token, body);

  beforeEach(() => {
    profile(ADMIN, { is_admin: true });
    profile(PLAYER);
    profile(FRIEND);
    profile(OTHER, { avatar_url: AVATAR });
    h.db.rows("photo_reports").push(
      { id: "r1", reporter_id: PLAYER, reported_user_id: OTHER, photo_url: AVATAR, reason: "not_them", status: "open", created_at: "2026-10-01T00:00:00Z" },
      { id: "r2", reporter_id: FRIEND, reported_user_id: OTHER, photo_url: AVATAR, reason: null, status: "open", created_at: "2026-10-02T00:00:00Z" },
    );
  });

  it("lists open reports grouped by player with the current photo", async () => {
    const r = await adminListGET(new Request("http://t/api/admin/photo-reports", { headers: { authorization: `Bearer ${ADMIN}` } }));
    const j = await r.json();
    expect(j.groups).toHaveLength(1);
    expect(j.groups[0]).toMatchObject({ user_id: OTHER, avatar_url: AVATAR });
    expect(j.groups[0].reports).toHaveLength(2);
  });

  it("remove clears avatar_url, deletes the file, resolves reports and notifies the player", async () => {
    const r = await review({ user_id: OTHER, action: "remove" });
    expect(r.status).toBe(200);
    expect(h.db.rows("profiles").find((p) => p.id === OTHER)!.avatar_url).toBeNull();
    expect(h.db.removed).toEqual([`${OTHER}/avatar-1.jpg`]);
    expect(h.db.rows("photo_reports").every((x) => x.status === "removed" && x.reviewed_by === ADMIN)).toBe(true);
    expect(h.pushes).toEqual([{ userIds: [OTHER], title: "Add a new profile photo", data: { kind: "photo_removed" } }]);

    const st = await (await statusGET(new Request("http://t/api/profile-photo/status", { headers: { authorization: `Bearer ${OTHER}` } }))).json();
    expect(st).toEqual({ required: true, has_photo: false, removed: true });

    seedFreeRun();
    expect((await join(OTHER)).status).toBe(403);
  });

  it("dismiss keeps the photo and closes the reports", async () => {
    const r = await review({ user_id: OTHER, action: "dismiss" });
    expect(r.status).toBe(200);
    expect(h.db.rows("profiles").find((p) => p.id === OTHER)!.avatar_url).toBe(AVATAR);
    expect(h.db.rows("photo_reports").every((x) => x.status === "dismissed")).toBe(true);
    expect(h.pushes).toHaveLength(0);
  });

  it("non-admins get 403 on list and review", async () => {
    const list = await adminListGET(new Request("http://t/api/admin/photo-reports", { headers: { authorization: `Bearer ${PLAYER}` } }));
    expect(list.status).toBe(403);
    const r = await review({ user_id: OTHER, action: "remove" }, PLAYER);
    expect(r.status).toBe(403);
    expect(h.db.rows("profiles").find((p) => p.id === OTHER)!.avatar_url).toBe(AVATAR);
  });

  it("an admin without a photo can still act on others", async () => {
    expect(h.db.rows("profiles").find((p) => p.id === ADMIN)!.avatar_url).toBeNull();
    expect((await review({ user_id: OTHER, action: "dismiss" })).status).toBe(200);
  });
});

describe("avatar picker and resize config", () => {
  it("square crop from camera or library", () => {
    expect(AVATAR_PICKER_OPTIONS).toMatchObject({ allowsEditing: true, aspect: [1, 1], mediaTypes: ["images"] });
  });

  it("resizes to 800px and never upscales", () => {
    expect(avatarResize(3024, 3024)).toEqual({ width: 800 });
    expect(avatarResize(1000, 2000)).toEqual({ height: 800 });
    expect(avatarResize(640, 640)).toBeNull();
  });

  it("finds the storage path only for avatars bucket URLs", () => {
    expect(avatarStoragePath(`${AVATAR}?t=1`)).toBe(`${OTHER}/avatar-1.jpg`);
    expect(avatarStoragePath("https://example.com/me.jpg")).toBeNull();
    expect(avatarStoragePath(null)).toBeNull();
  });
});
