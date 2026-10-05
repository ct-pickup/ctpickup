import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { activeMutedUserIds, filterUnmutedUserIds, isMuteActive } from "@/lib/chat/notificationMutes";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const FUTURE = "2026-10-09T13:00:00Z";
const PAST = "2026-10-09T11:00:00Z";

type Row = { user_id: string; muted_until: string | null };

/** A tiny stand-in for admin.from("chat_notification_mutes").select().eq().in(). */
function fakeAdmin(rows: Row[], error: { code?: string; message?: string } | null = null): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: error ? null : rows, error }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

afterEach(() => vi.restoreAllMocks());

describe("isMuteActive", () => {
  it("treats null as muted until turned off", () => {
    expect(isMuteActive(null, NOW)).toBe(true);
  });
  it("is active while the end time is in the future", () => {
    expect(isMuteActive(FUTURE, NOW)).toBe(true);
  });
  it("has expired once the end time has passed", () => {
    expect(isMuteActive(PAST, NOW)).toBe(false);
    expect(isMuteActive("2026-10-09T12:00:00Z", NOW)).toBe(false);
  });
  it("does not mute on an unreadable date", () => {
    expect(isMuteActive("not a date", NOW)).toBe(false);
  });
});

describe("filterUnmutedUserIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("keeps everyone when nobody has a mute", async () => {
    expect(await filterUnmutedUserIds(fakeAdmin([]), "room", ids, NOW)).toEqual(ids);
  });

  it("drops an active timed mute and a mute with no end", async () => {
    const admin = fakeAdmin([
      { user_id: "a", muted_until: FUTURE },
      { user_id: "b", muted_until: null },
    ]);
    expect(await filterUnmutedUserIds(admin, "room", ids, NOW)).toEqual(["c", "d"]);
  });

  it("keeps a user whose mute has expired", async () => {
    const admin = fakeAdmin([{ user_id: "a", muted_until: PAST }]);
    expect(await filterUnmutedUserIds(admin, "room", ids, NOW)).toEqual(ids);
  });

  it("returns nothing for no recipients", async () => {
    expect(await filterUnmutedUserIds(fakeAdmin([]), "room", [], NOW)).toEqual([]);
  });

  it("still sends when the lookup fails or the table is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = fakeAdmin([], { code: "42P01", message: "relation does not exist" });
    expect(await filterUnmutedUserIds(admin, "room", ids, NOW)).toEqual(ids);
  });
});

describe("activeMutedUserIds", () => {
  it("lists only users with an active mute", async () => {
    const admin = fakeAdmin([
      { user_id: "a", muted_until: FUTURE },
      { user_id: "b", muted_until: PAST },
      { user_id: "c", muted_until: null },
    ]);
    expect([...(await activeMutedUserIds(admin, "room", undefined, NOW))].sort()).toEqual(["a", "c"]);
  });
});
