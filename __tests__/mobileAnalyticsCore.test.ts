import { describe, expect, it, vi } from "vitest";

import { BATCH_SIZE, MAX_QUEUE, QUEUE_KEY, createAnalytics, type AnalyticsDeps } from "../mobile/lib/analytics/analyticsCore";
import { reasonCode, reasonsProp } from "../mobile/lib/analytics/reasonCodes";

function make(send: AnalyticsDeps["send"], store = new Map<string, string>()) {
  let n = 0;
  let t = 1_000_000;
  const a = createAnalytics({
    storage: {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => void store.set(k, v),
      removeItem: async (k) => void store.delete(k),
    },
    send,
    now: () => (t += 10),
    newId: () => `id${String(++n).padStart(8, "0")}`,
    platform: "ios",
    appVersion: "1.0.0",
  });
  return { a, store };
}

describe("mobile analytics queue", () => {
  it("records nothing until it is switched on", async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const { a, store } = make(send);
    await a.track("run_viewed", { run_id: "x" });
    expect(a.pending()).toBe(0);
    expect(store.size).toBe(0);
  });
  it("sends a batch and clears it", async () => {
    const send = vi.fn<AnalyticsDeps["send"]>(async () => ({ ok: true, status: 200 }));
    const { a } = make(send);
    a.configure({ enabled: true, token: "tok" });
    await a.track("run_viewed", { run_id: "x" });
    await a.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1].events).toHaveLength(1);
    expect(a.pending()).toBe(0);
  });
  it("keeps events when offline or the server errors, and retries later", async () => {
    let status = 0;
    const send = vi.fn(async () => ({ ok: status === 200, status }));
    const { a } = make(send);
    a.configure({ enabled: true, token: "tok" });
    await a.track("run_viewed");
    await a.flush();
    expect(a.pending()).toBe(1);
    status = 503;
    await a.flush();
    expect(a.pending()).toBe(1);
    status = 200;
    await a.flush();
    expect(a.pending()).toBe(0);
  });
  it("drops events the server will never accept (flag off, bad request)", async () => {
    const send = vi.fn(async () => ({ ok: false, status: 403 }));
    const { a } = make(send);
    a.configure({ enabled: true, token: "tok" });
    await a.track("run_viewed");
    await a.flush();
    expect(a.pending()).toBe(0);
  });
  it("switching off empties the queue and the saved copy", async () => {
    const send = vi.fn(async () => ({ ok: false, status: 0 }));
    const { a, store } = make(send);
    a.configure({ enabled: true, token: "tok" });
    await a.track("run_viewed");
    expect(store.has(QUEUE_KEY)).toBe(true);
    a.configure({ enabled: false, token: "tok" });
    expect(a.pending()).toBe(0);
    await Promise.resolve();
    expect(store.has(QUEUE_KEY)).toBe(false);
  });
  it("caps the queue and sends in batches", async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const { a } = make(send);
    a.configure({ enabled: true, token: "tok" });
    for (let i = 0; i < MAX_QUEUE + 20; i++) await a.track("run_viewed");
    expect(a.pending()).toBe(MAX_QUEUE);
    await a.flush();
    expect(send).toHaveBeenCalledTimes(Math.ceil(MAX_QUEUE / BATCH_SIZE));
  });
  it("restores saved events after a restart", async () => {
    const store = new Map<string, string>();
    const first = make(async () => ({ ok: false, status: 0 }), store);
    first.a.configure({ enabled: true, token: "tok" });
    await first.a.track("run_viewed");
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const second = make(send, store);
    second.a.configure({ enabled: true, token: "tok" });
    await second.a.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("reason codes", () => {
  it("turns labels into short tokens", () => {
    expect(reasonCode("Near you")).toBe("near_you");
    expect(reasonsProp(["Near you", "Your level", "third"])).toBe("near_you,your_level");
    expect(reasonsProp([])).toBeUndefined();
  });
});
