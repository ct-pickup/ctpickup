import { describe, expect, it } from "vitest";

import {
  groupNotifications,
  isSameDay,
  notificationIcon,
  notificationTarget,
  notificationTime,
  type NotificationItem,
} from "@/shared/notifications";

function item(id: string, createdAt: string, data: Record<string, unknown> = {}): NotificationItem {
  return { id, kind: "announcement", title: id, body: "", createdAt, data, unread: false };
}

describe("notification grouping", () => {
  const now = new Date("2026-10-07T15:00:00");

  it("splits today from earlier, keeping order", () => {
    const items = [
      item("a", "2026-10-07T14:00:00"),
      item("b", "2026-10-07T09:00:00"),
      item("c", "2026-10-06T23:59:00"),
      item("d", "2026-09-30T12:00:00"),
    ];
    const { today, earlier } = groupNotifications(items, now);
    expect(today.map((i) => i.id)).toEqual(["a", "b"]);
    expect(earlier.map((i) => i.id)).toEqual(["c", "d"]);
  });

  it("treats an unparseable date as earlier rather than dropping it", () => {
    const { today, earlier } = groupNotifications([item("x", "not-a-date")], now);
    expect(today).toEqual([]);
    expect(earlier.map((i) => i.id)).toEqual(["x"]);
  });

  it("handles an empty list", () => {
    expect(groupNotifications([], now)).toEqual({ today: [], earlier: [] });
  });

  it("compares calendar days, not elapsed hours", () => {
    expect(isSameDay(new Date("2026-10-07T00:05:00"), new Date("2026-10-07T23:55:00"))).toBe(true);
    expect(isSameDay(new Date("2026-10-06T23:55:00"), new Date("2026-10-07T00:05:00"))).toBe(false);
  });
});

describe("notification routing", () => {
  it("prefers a run id", () => {
    expect(notificationTarget({ run_id: "r1" })).toBe("/session/r1");
    expect(notificationTarget({ runId: "r2" })).toBe("/session/r2");
  });

  it("accepts an explicit screen path", () => {
    expect(notificationTarget({ screen: "/settings" })).toBe("/settings");
  });

  it("sends a room alert to messages", () => {
    expect(notificationTarget({ room_id: "abc" })).toBe("/(tabs)/messages");
  });

  it("returns null when there is nowhere to go, so the row stays flat", () => {
    expect(notificationTarget({})).toBeNull();
    expect(notificationTarget({ screen: "notatpath" })).toBeNull();
    expect(notificationTarget({ run_id: "   " })).toBeNull();
    expect(notificationTarget({ run_id: 42 })).toBeNull();
  });
});

describe("notification icons", () => {
  it("maps known kinds and falls back to a bell", () => {
    expect(notificationIcon("payment_confirmed")).toBe("credit-card");
    expect(notificationIcon("result_posted")).toBe("flag-checkered");
    expect(notificationIcon("something_new")).toBe("bell-o");
  });
});

describe("notification time", () => {
  const now = new Date("2026-10-07T15:00:00");

  it("shows a clock time today and a weekday within the week", () => {
    expect(notificationTime("2026-10-07T09:30:00", now)).toMatch(/9:30/);
    expect(notificationTime("2026-10-05T09:30:00", now)).toBe("Mon");
  });

  it("shows a date beyond a week and nothing for junk", () => {
    expect(notificationTime("2026-09-20T09:30:00", now)).toMatch(/Sep/);
    expect(notificationTime("nope", now)).toBe("");
  });
});
