import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkFieldForGame, resolveGameLink } from "../lib/fields/gameAtField";
import { buildGamePrefill, dateBlockedByClosure, locationTextFor, needsPermit, pickApprovedRequest } from "../mobile/lib/fields/gamePrefill";

type Row = Record<string, unknown>;
const venue = (over: Row = {}): Row => ({ venue_key: "v1", name: "Riverside Park", address: "45 River Rd, Fairfield, CT", lat: 41.1565, lon: -73.2706, status: "active", closed_until: null, closed_reason: null, permit_required: "unknown", permit_type: null, ...over });
const request = (over: Row = {}): Row => ({ id: "r1", user_id: "captain", venue_key: "v1", status: "approved", requested_date: "2026-11-07", start_time: "18:30:00", ...over });

function fakeAdmin(seed: { venues?: Row[]; requests?: Row[]; runs?: Row[] }) {
  const tables: Record<string, Row[]> = { venues: seed.venues ?? [], venue_requests: seed.requests ?? [], pickup_runs: seed.runs ?? [] };
  return {
    from: (name: string) => ({
      select: () => {
        const f: [string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => (f.push([c, v]), q),
          maybeSingle: async () => ({ data: structuredClone(tables[name]!.find((r) => f.every(([c, v]) => r[c] === v)) ?? null), error: null }),
          then: (res: (x: unknown) => unknown) => res({ data: structuredClone(tables[name]!.filter((r) => f.every(([c, v]) => r[c] === v))), error: null }),
        };
        return q;
      },
    }),
  } as never;
}

describe("pre-fill from a field", () => {
  it("fills name, address, lat/lon and venue_key, and leaves date and time empty", () => {
    const p = buildGamePrefill(venue() as never, null, "captain", "2026-10-15");
    expect(p).toMatchObject({ venue_key: "v1", venue_request_id: null, location_text: "Riverside Park, 45 River Rd, Fairfield, CT", latitude: 41.1565, longitude: -73.2706, date: null, time: null, banner: null, blocked: null });
  });
  it("uses just the name when there is no address, and doesn't repeat an address already in the name", () => {
    expect(locationTextFor({ name: "Riverside Park", address: null })).toBe("Riverside Park");
    expect(locationTextFor({ name: "Riverside Park, 45 River Rd", address: "45 River Rd" })).toBe("Riverside Park, 45 River Rd");
  });
  it("knows which fields usually need a permit", () => {
    expect(needsPermit({ permit_required: "yes", permit_type: null })).toBe(true);
    expect(needsPermit({ permit_required: "unknown", permit_type: "reservation" })).toBe(true);
    expect(needsPermit({ permit_required: "no", permit_type: "walk_up" })).toBe(false);
    expect(needsPermit({ permit_required: "unknown", permit_type: null })).toBe(false);
    expect(needsPermit({ permit_required: "yes", permit_type: "walk_up" })).toBe(false);
  });
});

describe("pre-fill from an approved request", () => {
  it("fills the approved date and time, links the request and shows the banner", () => {
    const p = buildGamePrefill(venue() as never, request() as never, "captain", "2026-10-15");
    expect(p).toMatchObject({ venue_request_id: "r1", date: "2026-11-07", time: "18:30", banner: "Your request for this field was approved.", blocked: null });
  });
  it("does not fill a date that already passed", () => {
    const p = buildGamePrefill(venue() as never, request({ requested_date: "2026-10-01" }) as never, "captain", "2026-10-15");
    expect(p).toMatchObject({ venue_request_id: "r1", date: null, time: null });
  });
  it("ignores a request that isn't approved or is for another field", () => {
    expect(buildGamePrefill(venue() as never, request({ status: "waiting_on_school" }) as never, "captain", "2026-10-15").venue_request_id).toBeNull();
    expect(buildGamePrefill(venue() as never, request({ venue_key: "other" }) as never, "captain", "2026-10-15").venue_request_id).toBeNull();
  });
  it("picks the player's next approved request that has no game yet", () => {
    const list = [
      request({ id: "a", requested_date: "2026-12-01" }),
      request({ id: "b", requested_date: "2026-11-07" }),
      request({ id: "c", requested_date: "2026-11-01" }),
      request({ id: "d", user_id: "someone-else", requested_date: "2026-10-20" }),
      request({ id: "e", status: "declined", requested_date: "2026-10-21" }),
      request({ id: "f", requested_date: "2026-10-01" }),
    ] as never[];
    expect(pickApprovedRequest(list, "v1", "captain", "2026-10-15", new Set())?.id).toBe("c");
    expect(pickApprovedRequest(list, "v1", "captain", "2026-10-15", new Set(["c"]))?.id).toBe("b");
    expect(pickApprovedRequest(list, "v1", "nobody", "2026-10-15", new Set())).toBeNull();
  });
});

describe("only the request's owner can create a game from it", () => {
  it("is blocked in the app's pre-fill", () => {
    const p = buildGamePrefill(venue() as never, request() as never, "intruder", "2026-10-15");
    expect(p.blocked).toMatch(/Only the person who made the request/);
    expect(p.venue_request_id).toBeNull();
    expect(p.date).toBeNull();
  });
  it("is blocked on the server with a 403, before anything else is revealed", async () => {
    const admin = fakeAdmin({ venues: [venue()], requests: [request()] });
    expect(await resolveGameLink(admin, "intruder", { venue_key: "v1", venue_request_id: "r1" }, "2026-11-07")).toMatchObject({ ok: false, status: 403, code: "not_owner" });
  });
  it("lets the owner through and takes the field from the request", async () => {
    const admin = fakeAdmin({ venues: [venue()], requests: [request()] });
    const res = await resolveGameLink(admin, "captain", { venue_request_id: "r1" }, "2026-11-07");
    expect(res).toMatchObject({ ok: true, venue_key: "v1" });
  });
  it("needs an approved request, the same field, and only one game per request", async () => {
    const pending = fakeAdmin({ venues: [venue()], requests: [request({ status: "waiting_on_school" })] });
    expect(await resolveGameLink(pending, "captain", { venue_request_id: "r1" }, "2026-11-07")).toMatchObject({ ok: false, code: "not_approved", status: 409 });
    const ok = fakeAdmin({ venues: [venue(), venue({ venue_key: "v2" })], requests: [request()] });
    expect(await resolveGameLink(ok, "captain", { venue_key: "v2", venue_request_id: "r1" }, "2026-11-07")).toMatchObject({ ok: false, code: "wrong_field", status: 400 });
    const used = fakeAdmin({ venues: [venue()], requests: [request()], runs: [{ id: "g1", venue_request_id: "r1" }] });
    expect(await resolveGameLink(used, "captain", { venue_request_id: "r1" }, "2026-11-07")).toMatchObject({ ok: false, code: "already_used", status: 409 });
    expect(await resolveGameLink(fakeAdmin({}), "captain", { venue_request_id: "nope" }, "2026-11-07")).toMatchObject({ ok: false, code: "request_missing", status: 404 });
  });
});

describe("removed and hidden fields can't host new games", () => {
  it.each(["removed", "hidden_pending_review"])("%s is blocked in the pre-fill and on the server", async (status) => {
    expect(buildGamePrefill(venue({ status }) as never, null, "captain", "2026-10-15").blocked).toMatch(/isn.t available for new games/);
    expect(checkFieldForGame(venue({ status }), "2026-11-07")).toMatchObject({ ok: false, status: 409, code: "field_unavailable" });
    const res = await resolveGameLink(fakeAdmin({ venues: [venue({ status })] }), "captain", { venue_key: "v1" }, "2026-11-07");
    expect(res).toMatchObject({ ok: false, code: "field_unavailable" });
  });
  it("an approved request for a field that was removed since can't be used either", async () => {
    const admin = fakeAdmin({ venues: [venue({ status: "removed" })], requests: [request()] });
    expect(await resolveGameLink(admin, "captain", { venue_request_id: "r1" }, "2026-11-07")).toMatchObject({ ok: false, code: "field_unavailable" });
  });
  it("a field without the status column (before the migration) and active fields are fine; a missing field is 404", async () => {
    expect(checkFieldForGame(venue({ status: undefined }), "2026-11-07")).toBeNull();
    expect(checkFieldForGame(venue(), "2026-11-07")).toBeNull();
    expect(await resolveGameLink(fakeAdmin({}), "captain", { venue_key: "gone" }, "2026-11-07")).toMatchObject({ ok: false, status: 404, code: "field_missing" });
  });
  it("no field at all is a normal free-text game", async () => {
    expect(await resolveGameLink(fakeAdmin({}), "captain", {}, "2026-11-07")).toEqual({ ok: true, venue: null, request: null, venue_key: null });
  });
});

describe("closed until blocks early dates", () => {
  const closed = venue({ closed_until: "2026-12-01", closed_reason: "Construction" });
  it("shows the warning and a minimum date in the pre-fill", () => {
    const p = buildGamePrefill(closed as never, null, "captain", "2026-10-15");
    expect(p.closedWarning).toBe("Closed until Dec 1, 2026: Construction");
    expect(p.minDate).toBe("2026-12-01");
  });
  it("does not pre-fill an approved date inside the closure", () => {
    const p = buildGamePrefill(closed as never, request({ requested_date: "2026-11-07" }) as never, "captain", "2026-10-15");
    expect(p).toMatchObject({ venue_request_id: "r1", date: null, time: null });
    expect(buildGamePrefill(closed as never, request({ requested_date: "2026-12-05" }) as never, "captain", "2026-10-15").date).toBe("2026-12-05");
  });
  it("blocks dates before the closed-until date, allows that day and after", () => {
    expect(dateBlockedByClosure(closed as never, "2026-11-30")).toMatch(/closed until 2026-12-01/);
    expect(dateBlockedByClosure(closed as never, "2026-12-01")).toBeNull();
    expect(dateBlockedByClosure(closed as never, "2027-01-10")).toBeNull();
    expect(dateBlockedByClosure(venue() as never, "2026-10-16")).toBeNull();
  });
  it("blocks on the server too", async () => {
    expect(checkFieldForGame(closed, "2026-11-30")).toMatchObject({ ok: false, status: 409, code: "field_closed", error: expect.stringMatching(/closed until Dec 1, 2026/) });
    expect(checkFieldForGame(closed, "2026-12-01")).toBeNull();
    const admin = fakeAdmin({ venues: [closed] });
    expect(await resolveGameLink(admin, "captain", { venue_key: "v1" }, "2026-11-30")).toMatchObject({ ok: false, code: "field_closed" });
    expect(await resolveGameLink(admin, "captain", { venue_key: "v1" }, "2026-12-02")).toMatchObject({ ok: true });
  });
});

describe("migration", () => {
  it("adds nullable links only, and is unique per request", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261023000000_games_at_fields.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/add column if not exists venue_key text references public\.venues/);
    expect(sql).toMatch(/add column if not exists venue_request_id uuid references public\.venue_requests/);
    expect(sql).toMatch(/unique index if not exists pickup_runs_venue_request_uidx[\s\S]*where venue_request_id is not null/);
    expect(sql).not.toMatch(/venue_key text not null/);
    expect(sql).not.toMatch(/venue_request_id uuid not null/);
    expect(sql).toMatch(/Rollback/);
  });
});
