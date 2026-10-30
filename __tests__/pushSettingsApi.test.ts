import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeClient, makeDb, type FakeDb } from "./helpers/fakeSupabase";
import { DEFAULT_PUSH_SETTINGS, deviceTimeZone, formatMinutes, parseSettings, quietSummary, stepMinutes } from "../mobile/lib/pushSettingsCore";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/server/runtimeClients", () => ({
  getSupabaseAdmin: () => ({
    ...fakeClient(h.db),
    auth: { getUser: async (t: string) => (t === "t_user" ? { data: { user: { id: "u1" } }, error: null } : { data: { user: null }, error: { message: "bad" } }) },
  }),
}));

import { GET, POST } from "@/app/api/mobile/push-settings/route";

const req = (method: "GET" | "POST", token: string, body?: unknown) =>
  new Request("http://x/api/mobile/push-settings", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  h.db = makeDb({ app_flags: [{ key: "notification_settings", enabled: false, allowlist: [] }], profiles: [{ id: "u1", is_admin: false }], user_push_devices: [] });
});

describe("/api/mobile/push-settings", () => {
  it("answers 403 feature_off until the flag is on", async () => {
    for (const r of [await GET(req("GET", "t_user")), await POST(req("POST", "t_user", { categories: { games: false } }))]) {
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "feature_off" });
    }
    expect(h.db.tables.profiles![0]!.push_cat_games).toBeUndefined();
  });
  it("needs a signed-in user", async () => {
    expect((await GET(req("GET", "nope"))).status).toBe(401);
  });
  it("reads defaults, saves a change, and rejects bad input", async () => {
    h.db.tables.app_flags![0]!.enabled = true;
    const first = await (await GET(req("GET", "t_user"))).json();
    expect(first.settings.categories).toMatchObject({ games: true, marketing: false });
    expect(first.settings.quiet).toMatchObject({ enabled: false, start: 1320, end: 420 });
    const saved = await POST(req("POST", "t_user", { categories: { games: false }, quiet: { enabled: true, start: 1380, end: 360, timezone: "America/Chicago" } }));
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.settings.categories.games).toBe(false);
    expect(body.settings.quiet).toEqual({ enabled: true, start: 1380, end: 360, timezone: "America/Chicago" });
    expect((await POST(req("POST", "t_user", { quiet: { timezone: "Nope/Nope" } }))).status).toBe(400);
    expect((await POST(req("POST", "t_user", {}))).status).toBe(400);
  });
});

describe("app helpers", () => {
  it("formats and steps times around midnight", () => {
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(12 * 60)).toBe("12:00 PM");
    expect(formatMinutes(22 * 60 + 30)).toBe("10:30 PM");
    expect(formatMinutes(7 * 60)).toBe("7:00 AM");
    expect(stepMinutes(23 * 60 + 30, 30)).toBe(0);
    expect(stepMinutes(0, -30)).toBe(23 * 60 + 30);
    expect(quietSummary({ enabled: true, start: 1320, end: 420, timezone: null })).toBe("10:00 PM to 7:00 AM");
    expect(quietSummary({ enabled: false, start: 1320, end: 420, timezone: null })).toBe("Off");
  });
  it("anything unclean from the server becomes the defaults; the device zone is a string or null", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(parseSettings({ categories: { games: "no" }, quiet: { start: 5000 } })).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(parseSettings({ categories: { chat: false } }).categories.chat).toBe(false);
    const tz = deviceTimeZone();
    expect(tz === null || typeof tz === "string").toBe(true);
  });
});
