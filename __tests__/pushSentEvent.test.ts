import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAnalyticsBackoff } from "@/lib/analytics/events";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { fakeClient, makeDb } from "./helpers/fakeSupabase";

const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";

describe("push_sent events", () => {
  beforeEach(() => {
    resetAnalyticsBackoff();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records one push_sent per player reached and tags the push with the same id", async () => {
    const db = makeDb({
      profiles: [{ id: U1 }, { id: U2 }],
      user_push_devices: [{ user_id: U1, expo_push_token: "ExponentPushToken[aaaaaaaaaa]", push_notifications_enabled: true, installation_context: "standalone" }],
      analytics_events: [],
    });
    await sendPushToUsers(fakeClient(db) as never, [U1, U2], { title: "t", body: "b", data: { kind: "pickup_invite" } });
    const events = db.tables.analytics_events as { name: string; user_id: string; properties: Record<string, string>; event_key: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "push_sent", user_id: U1 });
    expect(events[0]!.properties.kind).toBe("pickup_invite");
    const sent = JSON.parse(((fetch as unknown) as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]![1].body)[0];
    expect(sent.data.push_id).toBe(events[0]!.properties.push_id);
    expect(sent.data.kind).toBe("pickup_invite");
  });

  it("does not fail the push when analytics is unavailable", async () => {
    const db = makeDb({
      profiles: [{ id: U1 }],
      user_push_devices: [{ user_id: U1, expo_push_token: "ExponentPushToken[aaaaaaaaaa]", push_notifications_enabled: true, installation_context: "standalone" }],
    });
    db.failTables.analytics_events = 'relation "analytics_events" does not exist';
    const r = await sendPushToUsers(fakeClient(db) as never, [U1], { title: "t", body: "b", data: { kind: "pickup_invite" } });
    expect(r.tokens).toBe(1);
    expect(r.batches[0]?.ok).toBe(true);
  });
});
