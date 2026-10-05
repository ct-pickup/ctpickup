import { beforeEach, describe, expect, it, vi } from "vitest";

type Inserted = Record<string, unknown>;

const h = vi.hoisted(() => ({
  inserts: [] as Inserted[],
  /** Column names the fake pickup_runs table pretends not to have. */
  missing: new Set<string>(),
}));

function fakeAdmin() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "host-1" } }, error: null }) },
    from(table: string) {
      if (table === "profiles") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { approved: true, is_admin: false, first_name: "Sam", last_name: "R", nearest_venue: "" }, error: null }),
        };
        return q;
      }
      return {
        insert: (row: Inserted) => ({
          select: () => ({
            maybeSingle: async () => {
              for (const col of h.missing) {
                if (col in row) {
                  return { data: null, error: { code: "PGRST204", message: `Could not find the '${col}' column of 'pickup_runs' in the schema cache` } };
                }
              }
              h.inserts.push(row);
              return { data: { id: "run-1" }, error: null };
            },
          }),
        }),
      };
    },
  };
}

vi.mock("@/lib/server/runtimeClients", () => ({ getSupabaseAdmin: () => fakeAdmin() }));
vi.mock("@/lib/profilePhoto/requirement", () => ({ profilePhotoGate: async () => null }));
vi.mock("@/lib/pickup/sessionLifecycle", () => ({
  promotePlanningRunsPastStart: async () => undefined,
  scheduleSessionRateRemindersForRun: async () => undefined,
}));
vi.mock("@/lib/pickup/pickupPushNotifications", () => ({ approvedUserIdsInRunServiceRegion: async () => [] }));
vi.mock("@/lib/push/sendExpoPush", () => ({ sendPushToUsers: async () => ({ tokens: 0, batches: [] }) }));

import { POST } from "@/app/api/sessions/create/route";

function req(body: Record<string, unknown>) {
  return new Request("http://x/api/sessions/create", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({
      location_text: "Field",
      start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      capacity: 10,
      format: "Open",
      ...body,
    }),
  });
}

beforeEach(() => {
  h.inserts.length = 0;
  h.missing.clear();
});

describe("POST /api/sessions/create min_star", () => {
  it("stores min_star and the tier band that contains it", async () => {
    const res = await POST(req({ min_star: 3.5, min_tier: "bronze" }));
    expect(res.status).toBe(200);
    expect(h.inserts[0]).toMatchObject({ min_star: 3.5, open_tier_rank: 4, level: "competitive" });
  });

  it("maps an in-between half star to its band (1.0 is bronze, 2.0 is silver)", async () => {
    await POST(req({ min_star: 1 }));
    await POST(req({ min_star: 2 }));
    expect(h.inserts.map((r) => [r.min_star, r.open_tier_rank])).toEqual([[1, 1], [2, 2]]);
  });

  it("behaves exactly as before when min_star is absent", async () => {
    const res = await POST(req({ min_tier: "gold" }));
    expect(res.status).toBe(200);
    expect(h.inserts[0]).toMatchObject({ open_tier_rank: 3, level: "competitive" });
    expect("min_star" in h.inserts[0]!).toBe(false);
    await POST(req({}));
    expect(h.inserts[1]).toMatchObject({ open_tier_rank: 0, level: "casual" });
  });

  it("rejects an invalid min_star with a clear error and writes nothing", async () => {
    for (const bad of [0, 0.25, 5.5, 2.7, "high"]) {
      const res = await POST(req({ min_star: bad }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/half star/);
    }
    expect(h.inserts).toHaveLength(0);
  });

  it("still creates the session, tier-only, when the min_star column does not exist yet", async () => {
    h.missing.add("min_star");
    const res = await POST(req({ min_star: 2.5 }));
    expect(res.status).toBe(200);
    expect(h.inserts).toHaveLength(1);
    expect("min_star" in h.inserts[0]!).toBe(false);
    expect(h.inserts[0]).toMatchObject({ open_tier_rank: 3, level: "competitive" });
  });
});
