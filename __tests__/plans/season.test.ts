import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/push/adminUserIds", () => ({ fetchAdminUserIds: async () => ({ ids: ["admin-1"] }) }));
const pushed: unknown[] = [];
vi.mock("../../lib/push/sendExpoPush", () => ({ sendPushToUsers: async (...a: unknown[]) => void pushed.push(a) }));

import { fulfillSeasonPurchase, seasonRequestRow, type SeasonPurchaseRow } from "../../lib/plans/seasonFulfillment";
import { draftSeasonEmail, formatSeasonWhen, nextWeekdayDate, seasonDates, validateSeasonInput, weekdayName } from "../../shared/fields/season";

describe("season rules", () => {
  it("finds the next date on a weekday, 1 to 7 days ahead", () => {
    // Tue Oct 13 2026
    expect(nextWeekdayDate("2026-10-13", 6)).toBe("2026-10-17"); // Saturday
    expect(nextWeekdayDate("2026-10-13", 3)).toBe("2026-10-14"); // Wednesday
    expect(nextWeekdayDate("2026-10-13", 2)).toBe("2026-10-20"); // today is Tuesday: next Tuesday, never today
    expect(nextWeekdayDate("2026-10-13", 0)).toBe("2026-10-18"); // Sunday
  });
  it("lists weekly dates", () => {
    expect(seasonDates("2026-10-17", 3)).toEqual(["2026-10-17", "2026-10-24", "2026-10-31"]);
    expect(seasonDates("2026-10-31", 2)).toEqual(["2026-10-31", "2026-11-07"]);
  });
  it("validates season input", () => {
    const ok = validateSeasonInput({ venue_key: "v", weekday: 6, start_time: "11:00", weeks: 10 });
    expect(ok).toEqual({ ok: true, value: { venue_key: "v", weekday: 6, start_time: "11:00", duration_hours: 2, weeks: 10, players: 14 } });
    expect(validateSeasonInput({ weekday: 6, start_time: "11:00", weeks: 10 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 7, start_time: "11:00", weeks: 10 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 1, start_time: "06:30", weeks: 10 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 1, start_time: "11:15", weeks: 10 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 1, start_time: "11:00", weeks: 0 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 1, start_time: "11:00", weeks: 21 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 1, start_time: "11:00", weeks: 8, duration_hours: 3 }).ok).toBe(false);
    expect(validateSeasonInput({ venue_key: "v", weekday: 0, start_time: "21:00", weeks: 20, duration_hours: 1.5 }).ok).toBe(true);
  });
  it("describes the season and drafts one email, with no player details", () => {
    expect(weekdayName(6)).toBe("Saturday");
    expect(formatSeasonWhen("2026-10-17", "11:00", 2, 10)).toBe("every Saturday, 11 AM–1 PM, for 10 weeks starting Sat, Oct 17");
    expect(formatSeasonWhen("2026-10-18", "09:30", 1.5, 1)).toBe("every Sunday, 9:30 AM–11 AM, for 1 week starting Sun, Oct 18");
    const d = draftSeasonEmail({ venueName: "Hillcrest High School Turf", venueKind: "school", startDate: "2026-10-17", startTime: "11:00", hours: 2, weeks: 10, players: 14 });
    expect(d.subject).toContain("Hillcrest High School Turf");
    expect(d.body).toContain("every Saturday");
    expect(d.body).toContain("10 weeks");
    expect(d.body).toContain("any permit");
  });
});

const purchase: SeasonPurchaseRow = {
  id: "p1",
  user_id: "user-1",
  venue_key: "v1",
  status: "pending",
  requested_start_date: "2026-10-17",
  start_time: "11:00:00",
  duration_hours: 2,
  weeks: 10,
  players: 14,
  venue_request_id: null,
};

describe("season request row", () => {
  it("is ONE request flagged season, with the weeks and a draft email", () => {
    const r = seasonRequestRow(purchase, { name: "Hillcrest High School Turf", venue_type: "school_public" });
    expect(r).toMatchObject({ user_id: "user-1", venue_key: "v1", requested_date: "2026-10-17", weeks: 10, plan: "season", plan_kind: "season" });
    expect(r.draft_email).toContain("facility-use process");
    expect(r.draft_email).toContain("for 10 weeks");
  });
});

/** A tiny in-memory stand-in for the Supabase client, recording what the fulfillment writes. */
function fakeAdmin(opts: { purchase: SeasonPurchaseRow | null; insert: { data?: { id: string }; error?: { code: string; message: string } }; existingId?: string }) {
  const log: { table: string; op: string; values?: unknown }[] = [];
  const from = (table: string) => {
    let op = "select";
    let values: unknown;
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      in: () => q,
      update: (v: unknown) => {
        op = "update";
        values = v;
        return q;
      },
      insert: (v: unknown) => {
        op = "insert";
        values = v;
        return q;
      },
      maybeSingle: async () => {
        log.push({ table, op: "maybeSingle" });
        if (table === "season_purchases") return { data: opts.purchase, error: null };
        if (table === "venues") return { data: { name: "Hillcrest High School Turf", venue_type: "school_public" }, error: null };
        if (table === "venue_requests") return { data: opts.existingId ? { id: opts.existingId } : null, error: null };
        return { data: { first_name: "Sam", last_name: "P" }, error: null };
      },
      single: async () => {
        log.push({ table, op, values });
        return opts.insert.error ? { data: null, error: opts.insert.error } : { data: opts.insert.data, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        log.push({ table, op, values });
        resolve({ error: null });
      },
    };
    return q;
  };
  return { admin: { from } as never, log };
}

describe("fulfillSeasonPurchase", () => {
  const args = { purchaseId: "p1", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 3900 };
  it("marks the purchase paid and creates one season request", async () => {
    const { admin, log } = fakeAdmin({ purchase, insert: { data: { id: "req-1" } } });
    expect(await fulfillSeasonPurchase(admin, args)).toBe("fulfilled");
    const paid = log.find((l) => l.table === "season_purchases" && l.op === "update");
    expect(paid?.values).toMatchObject({ status: "paid", stripe_payment_intent_id: "pi_1", amount_cents: 3900 });
    const inserted = log.filter((l) => l.table === "venue_requests" && l.op === "insert");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.values).toMatchObject({ plan_kind: "season", plan: "season", weeks: 10 });
    expect(log.some((l) => l.table === "season_purchases" && (l.values as { venue_request_id?: string })?.venue_request_id === "req-1")).toBe(true);
  });
  it("does nothing the second time (idempotent)", async () => {
    const { admin, log } = fakeAdmin({ purchase: { ...purchase, status: "paid", venue_request_id: "req-1" }, insert: { data: { id: "x" } } });
    expect(await fulfillSeasonPurchase(admin, args)).toBe("already");
    expect(log.some((l) => l.op === "insert")).toBe(false);
  });
  it("reports a purchase it cannot find", async () => {
    const { admin } = fakeAdmin({ purchase: null, insert: { data: { id: "x" } } });
    expect(await fulfillSeasonPurchase(admin, args)).toBe("missing");
  });
  it("upgrades an existing open request to the season instead of failing on a duplicate", async () => {
    const { admin, log } = fakeAdmin({ purchase, insert: { error: { code: "23505", message: "duplicate" } }, existingId: "req-existing" });
    expect(await fulfillSeasonPurchase(admin, args)).toBe("fulfilled");
    const upgraded = log.find((l) => l.table === "venue_requests" && l.op === "update");
    expect(upgraded?.values).toMatchObject({ plan_kind: "season", weeks: 10 });
  });
});
