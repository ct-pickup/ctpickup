import { describe, expect, it } from "vitest";

import { applyReply, buildReplyChanges, modeFor, parseReplyInput, statusForOutcome, undoReply, type ReplyInput } from "../lib/fields/venueReply";

const NOW = "2026-10-15T12:00:00.000Z";

function input(over: Partial<ReplyInput> = {}): ReplyInput {
  return {
    replied_by_name: "Pat Parks", replied_by_contact: "pat@town.gov", replied_at: "2026-10-14", outcome: "approved", price_amount: 120, price_unit: "hour",
    permit_required: "yes", residency_rule: "residents_only", how_to_book: "Book at https://town.gov/fields", contact: "Pat 203-555-0100", notes: null,
    from_venue: true, no_field_that_day: false, ...over,
  };
}
const venueRow = (over: Record<string, unknown> = {}) => ({
  venue_key: "v1", name: "Riverside", price_status: "unknown", price_text: null, price_min: null, price_max: null, price_unit: null, price_source: "unknown",
  permit_required: "unknown", permit_type: null, permit_basis: null, booking_method: "unknown", booking_url: null, booking_phone: null, booking_basis: null,
  residency_rule: null, contact_text: null, availability_notes: null, last_verified_at: null, verified: false, locked_fields: [], ...over,
});

/** A tiny in-memory stand-in for the tables the reply code touches. */
function fakeAdmin(seed: { requests: Record<string, unknown>[]; venues: Record<string, unknown>[] }) {
  const tables: Record<string, Record<string, unknown>[]> = { venue_requests: seed.requests, venues: seed.venues, venue_replies: [], venue_data_events: [] };
  const from = (name: string) => {
    const rows = tables[name]!;
    return {
      select: () => {
        const filters: [string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => (filters.push([c, v]), q),
          maybeSingle: async () => {
            const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v));
            return { data: hit ? structuredClone(hit) : null, error: null }; // a copy, like a real database read
          },
          then: (res: (x: unknown) => unknown) => res({ data: structuredClone(rows.filter((r) => filters.every(([c, v]) => r[c] === v))), error: null }),
        };
        return q;
      },
      insert: async (r: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const x of Array.isArray(r) ? r : [r]) rows.push(structuredClone(x));
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (c: string, v: unknown) => {
          for (const r of rows) if (r[c] === v) Object.assign(r, patch);
          return { error: null };
        },
      }),
    };
  };
  return { tables, from } as unknown as { tables: typeof tables } & Parameters<typeof applyReply>[0];
}
const seed = (venueOver: Record<string, unknown> = {}, status = "new") =>
  fakeAdmin({ requests: [{ id: "r1", user_id: "u1", venue_key: "v1", status, requested_date: "2026-11-01", start_time: "18:00", duration_hours: 2 }], venues: [venueRow(venueOver)] });
let n = 0;
const ids = () => `id-${++n}`;
const run = (a: ReturnType<typeof seed>, i: ReplyInput, apply = true) => applyReply(a, { requestId: "r1", adminId: "admin", input: i, applyToVenue: apply, nowIso: NOW, newId: ids });

describe("parsing", () => {
  it("accepts a good reply and rejects bad ones", () => {
    const ok = parseReplyInput({ outcome: "approved", replied_at: "2026-10-14", price_amount: "$120", price_unit: "hour", permit_required: "yes", residency_rule: "open" });
    expect(ok).toMatchObject({ ok: true, input: { price_amount: 120, from_venue: true, no_field_that_day: false } });
    expect(parseReplyInput({ outcome: "maybe", replied_at: "2026-10-14" })).toMatchObject({ ok: false });
    expect(parseReplyInput({ outcome: "approved", replied_at: "10/14/2026" })).toMatchObject({ ok: false });
    expect(parseReplyInput({ outcome: "approved", replied_at: "2026-10-14", price_amount: 50 })).toMatchObject({ ok: false, error: expect.stringMatching(/per/) });
    expect(parseReplyInput({ outcome: "approved", replied_at: "2026-10-14", price_amount: -5, price_unit: "hour" })).toMatchObject({ ok: false });
    expect(parseReplyInput({ outcome: "approved", replied_at: "2026-10-14", from_venue: false })).toMatchObject({ ok: true, input: { from_venue: false } });
  });
  it("maps outcomes to request statuses", () => {
    expect(statusForOutcome("approved", "new")).toBe("approved");
    expect(statusForOutcome("denied", "new")).toBe("declined");
    expect(statusForOutcome("needs_permit", "new")).toBe("waiting_on_school");
    expect(statusForOutcome("pending", "new")).toBe("waiting_on_school");
    expect(statusForOutcome("no_answer", "new")).toBe("waiting_on_school");
    expect(statusForOutcome("no_answer", "approved")).toBe("approved");
  });
  it("treats a denial or a no-field day as availability only", () => {
    expect(modeFor(input())).toBe("apply");
    expect(modeFor(input({ outcome: "denied" }))).toBe("availability");
    expect(modeFor(input({ no_field_that_day: true }))).toBe("availability");
    expect(modeFor(input({ outcome: "no_answer" }))).toBe("none");
  });
});

describe("venue write", () => {
  it("writes price, permit, booking, contact and residency, marked as Verified when it came from the venue", () => {
    const { mode, changes } = buildReplyChanges(venueRow(), input(), NOW);
    expect(mode).toBe("apply");
    expect(changes).toMatchObject({
      price_status: "paid", price_min: 120, price_max: 120, price_unit: "hour", price_text: "$120/hour", price_source: "manual",
      permit_required: "yes", permit_type: "permit", permit_basis: "manual",
      booking_url: "https://town.gov/fields", booking_method: "online", booking_basis: "Book at https://town.gov/fields",
      contact_text: "Pat 203-555-0100", booking_phone: "203-555-0100", residency_rule: "Residents only", last_verified_at: NOW,
    });
    expect(changes).not.toHaveProperty("verified");
  });
  it("leaves the markers alone and does not call it verified when it did not come from the venue", () => {
    const { changes } = buildReplyChanges(venueRow(), input({ from_venue: false }), NOW);
    expect(changes).toMatchObject({ price_status: "paid", permit_required: "yes" });
    for (const k of ["price_source", "last_verified_at"]) expect(changes).not.toHaveProperty(k);
    expect(String(changes.permit_basis)).toMatch(/^reply:/);
  });
  it("zero means free, and no permit clears a stale permit type", () => {
    const { changes } = buildReplyChanges(venueRow({ permit_type: "permit", permit_required: "yes" }), input({ price_amount: 0, price_unit: null, permit_required: "no" }), NOW);
    expect(changes).toMatchObject({ price_status: "free", price_text: "Free", permit_required: "no", permit_type: null });
    expect(changes).not.toHaveProperty("price_min"); // already empty: not a change
  });
  it("only lists values that really change", () => {
    const v = venueRow({ price_status: "paid", price_text: "$120/hour", price_min: 120, price_max: 120, price_unit: "hour", price_source: "manual" });
    const { changes } = buildReplyChanges(v, input({ permit_required: null, residency_rule: null, how_to_book: null, contact: null }), NOW);
    expect(changes).not.toHaveProperty("price_status");
  });
  it("a denial or a no-field day is a dated availability note, nothing permanent", () => {
    for (const i of [input({ outcome: "denied", notes: "Field closed for renovation" }), input({ no_field_that_day: true, notes: "Games all day" })]) {
      const { mode, changes } = buildReplyChanges(venueRow({ availability_notes: "[2026-09-01] earlier" }), i, NOW);
      expect(mode).toBe("availability");
      expect(Object.keys(changes)).toEqual(["availability_notes"]);
      expect(String(changes.availability_notes)).toMatch(/^\[2026-09-01\] earlier\n\[2026-10-14\] (Denied|No field available): /);
    }
  });
});

describe("saving a reply", () => {
  it("updates the venue, the request status and the audit log", async () => {
    const a = seed();
    const res = await run(a, input());
    expect(res).toMatchObject({ ok: true, mode: "apply", previousStatus: "new", newStatus: "approved" });
    expect(a.tables.venues![0]).toMatchObject({ price_status: "paid", price_source: "manual", permit_basis: "manual", residency_rule: "Residents only", last_verified_at: NOW, name: "Riverside" });
    expect(a.tables.venue_requests![0]!.status).toBe("approved");
    expect(a.tables.venue_replies).toHaveLength(1);
    expect(a.tables.venue_replies![0]).toMatchObject({ outcome: "approved", from_venue: true, apply_mode: "apply", previous_status: "new", new_status: "approved", created_by: "admin" });
    const ev = a.tables.venue_data_events!;
    expect(ev.length).toBeGreaterThan(8);
    expect(ev.every((e) => e.source === "reply" && e.request_id === "r1" && e.changed_by === "admin" && e.venue_key === "v1")).toBe(true);
    expect(ev.find((e) => e.field === "price_min")).toMatchObject({ old_value: null, new_value: 120 });
  });
  it("locks price, permit, booking, contact and residency so imports keep them", async () => {
    const a = seed({ locked_fields: ["name"] });
    await run(a, input());
    expect(a.tables.venues![0]!.locked_fields).toEqual(expect.arrayContaining(["name", "price", "permit", "booking", "contact", "residency"]));
    expect(a.tables.venue_data_events!.find((e) => e.field === "locked_fields")).toMatchObject({ old_value: ["name"] });
  });
  it("with Apply off, only the request and the reply change", async () => {
    const a = seed();
    const res = await run(a, input(), false);
    expect(res).toMatchObject({ ok: true, fields: [], newStatus: "approved" });
    expect(a.tables.venues![0]).toMatchObject({ price_status: "unknown", price_source: "unknown" });
    expect(a.tables.venue_data_events).toHaveLength(0);
    expect(a.tables.venue_replies![0]).toMatchObject({ apply_to_venue: false, apply_mode: "none" });
  });
  it("a denial declines the request and only adds an availability note", async () => {
    const a = seed();
    const res = await run(a, input({ outcome: "denied", notes: "Not available this season" }));
    expect(res).toMatchObject({ ok: true, newStatus: "declined", fields: ["availability_notes"] });
    expect(a.tables.venues![0]).toMatchObject({ price_status: "unknown", locked_fields: [] });
    expect(String(a.tables.venues![0]!.availability_notes)).toMatch(/Denied: Not available this season/);
  });
  it("reports a missing request or venue", async () => {
    expect(await applyReply(seed(), { requestId: "nope", adminId: "a", input: input(), applyToVenue: true })).toEqual({ ok: false, error: "request_missing" });
    const noVenue = fakeAdmin({ requests: [{ id: "r1", venue_key: "gone", status: "new" }], venues: [] });
    expect(await applyReply(noVenue, { requestId: "r1", adminId: "a", input: input(), applyToVenue: true })).toEqual({ ok: false, error: "venue_missing" });
  });
});

describe("undo", () => {
  it("restores every old value from the log and the earlier request status", async () => {
    const a = seed({ price_text: "old text", locked_fields: ["name"] });
    const saved = await run(a, input());
    if (!saved.ok) throw new Error("save failed");
    const res = await undoReply(a, saved.replyId, "admin2", "2026-10-16T00:00:00.000Z");
    expect(res).toMatchObject({ ok: true, skipped: [], statusRestored: true });
    expect(a.tables.venues![0]).toMatchObject({ price_status: "unknown", price_text: "old text", price_min: null, price_source: "unknown", permit_basis: null, residency_rule: null, last_verified_at: null, locked_fields: ["name"] });
    expect(a.tables.venue_requests![0]!.status).toBe("new");
    expect(a.tables.venue_replies![0]).toMatchObject({ undone_by: "admin2" });
    expect(a.tables.venue_data_events!.every((e) => e.undone_at)).toBe(true);
  });
  it("leaves a field alone that changed again since, and reports it", async () => {
    const a = seed();
    const saved = await run(a, input());
    if (!saved.ok) throw new Error("save failed");
    a.tables.venues![0]!.price_min = 150; // someone edited it afterwards
    a.tables.venue_requests![0]!.status = "declined";
    const res = await undoReply(a, saved.replyId, "admin2");
    expect(res).toMatchObject({ ok: true, statusRestored: false });
    if (res.ok) expect(res.skipped).toEqual(["price_min"]);
    expect(a.tables.venues![0]!.price_min).toBe(150);
    expect(a.tables.venues![0]!.price_status).toBe("unknown");
  });
  it("undoes an availability note and cannot be undone twice", async () => {
    const a = seed();
    const saved = await run(a, input({ outcome: "denied", notes: "Closed" }));
    if (!saved.ok) throw new Error("save failed");
    expect((await undoReply(a, saved.replyId, "admin")).ok).toBe(true);
    expect(a.tables.venues![0]!.availability_notes).toBeNull();
    expect(await undoReply(a, saved.replyId, "admin")).toEqual({ ok: false, error: "already" });
    expect(await undoReply(a, "nope", "admin")).toEqual({ ok: false, error: "missing" });
  });
});
