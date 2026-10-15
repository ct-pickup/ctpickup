import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateAutoHide, markClosedUntil, mergeInto, movePin, removeField, restoreField, shouldAutoHide, submitReport } from "../lib/fields/venueReports";
import { closedBanner } from "../mobile/lib/fields/presentation";
import { planImport, type Item } from "../scripts/lib/researchImport";
import { cleanRow } from "../scripts/lib/researchImport";

const NOW = "2026-10-15T12:00:00.000Z";
type Row = Record<string, unknown>;

function fakeAdmin(seed: { venues: Row[]; suggestions?: Row[] }) {
  const tables: Record<string, Row[]> = { venues: seed.venues, venue_suggestions: seed.suggestions ?? [], venue_data_events: [] };
  const from = (name: string) => {
    const rows = tables[name]!;
    return {
      select: () => {
        const f: [string, unknown][] = [];
        const q = {
          eq: (c: string, v: unknown) => (f.push([c, v]), q),
          maybeSingle: async () => {
            const hit = rows.find((r) => f.every(([c, v]) => r[c] === v));
            return { data: hit ? structuredClone(hit) : null, error: null };
          },
          then: (res: (x: unknown) => unknown) => res({ data: structuredClone(rows.filter((r) => f.every(([c, v]) => r[c] === v))), error: null }),
        };
        return q;
      },
      insert: async (r: Row | Row[]) => {
        for (const x of Array.isArray(r) ? r : [r]) rows.push(structuredClone(x));
        return { error: null };
      },
      update: (patch: Row) => ({
        eq: async (c: string, v: unknown) => {
          for (const r of rows) if (r[c] === v) Object.assign(r, patch);
          return { error: null };
        },
      }),
    };
  };
  return { tables, from } as unknown as { tables: typeof tables } & Parameters<typeof evaluateAutoHide>[0];
}
const venue = (key: string, over: Row = {}): Row => ({ venue_key: key, name: key.toUpperCase(), lat: 41.1, lon: -73.2, status: "active", player_notes: null, availability_notes: null, contact_text: null, booking_phone: null, booking_url: null, website: null, booking_basis: null, locked_fields: [], ...over });
const report = (user_id: string, problem: string, status = "pending"): Row => ({ venue_key: "a", user_id, problem, status });

describe("3-report rule", () => {
  it("hides a field when 3 different players say it doesn't exist or isn't a soccer field", () => {
    expect(shouldAutoHide([report("u1", "doesnt_exist"), report("u2", "doesnt_exist"), report("u3", "not_soccer")] as never)).toBe(true);
  });
  it("2 players are not enough, and the same player 3 times is still one", () => {
    expect(shouldAutoHide([report("u1", "doesnt_exist"), report("u2", "not_soccer")] as never)).toBe(false);
    expect(shouldAutoHide([report("u1", "doesnt_exist"), report("u1", "not_soccer"), report("u1", "doesnt_exist")] as never)).toBe(false);
  });
  it("other reasons and rejected reports do not count", () => {
    expect(shouldAutoHide([report("u1", "closed"), report("u2", "private"), report("u3", "wrong_info")] as never)).toBe(false);
    expect(shouldAutoHide([report("u1", "doesnt_exist"), report("u2", "doesnt_exist"), report("u3", "doesnt_exist", "rejected")] as never)).toBe(false);
  });
  it("submitting the third report sets hidden_pending_review and logs it", async () => {
    const a = fakeAdmin({ venues: [venue("a")], suggestions: [report("u1", "doesnt_exist"), report("u2", "not_soccer")] });
    const res = await submitReport(a, "u3", { venue_key: "a", problem: "doesnt_exist" }, NOW);
    expect(res).toMatchObject({ ok: true, hidden: true });
    expect(a.tables.venues![0]).toMatchObject({ status: "hidden_pending_review" });
    expect(a.tables.venue_data_events!.find((e) => e.field === "status")).toMatchObject({ old_value: "active", new_value: "hidden_pending_review", source: "player" });
  });
  it("the second report leaves the field visible, and the same player cannot report twice", async () => {
    const a = fakeAdmin({ venues: [venue("a")], suggestions: [report("u1", "doesnt_exist")] });
    expect(await submitReport(a, "u2", { venue_key: "a", problem: "not_soccer" }, NOW)).toMatchObject({ ok: true, hidden: false });
    expect(a.tables.venues![0]!.status).toBe("active");
    expect(await submitReport(a, "u2", { venue_key: "a", problem: "not_soccer" }, NOW)).toMatchObject({ ok: true, duplicateReport: true });
    expect(a.tables.venue_suggestions).toHaveLength(2);
  });
  it("an already hidden or removed field is left alone", async () => {
    const a = fakeAdmin({ venues: [venue("a", { status: "removed" })], suggestions: [report("u1", "doesnt_exist"), report("u2", "doesnt_exist"), report("u3", "doesnt_exist")] });
    expect(await evaluateAutoHide(a, "a", NOW)).toMatchObject({ hidden: false, players: 3 });
    expect(a.tables.venues![0]!.status).toBe("removed");
  });
});

describe("report validation", () => {
  it("needs the right extras for each reason", async () => {
    const a = fakeAdmin({ venues: [venue("a"), venue("b")] });
    expect(await submitReport(a, "u", { venue_key: "a", problem: "wrong_info", detail: "x" } as never)).toMatchObject({ ok: false, code: "invalid" });
    expect(await submitReport(a, "u", { venue_key: "a", problem: "duplicate" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await submitReport(a, "u", { venue_key: "a", problem: "duplicate", duplicate_of: "a" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await submitReport(a, "u", { venue_key: "a", problem: "wrong_location", lat: 41.2 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await submitReport(a, "u", { venue_key: "a", problem: "wrong_setting" as never })).toMatchObject({ ok: false, code: "invalid" });
    expect(await submitReport(a, "u", { venue_key: "zzz", problem: "closed" })).toMatchObject({ ok: false, code: "venue_missing" });
    expect(await submitReport(a, "u", { venue_key: "a", problem: "duplicate", duplicate_of: "b", note: "same park" })).toMatchObject({ ok: true });
    expect(a.tables.venue_suggestions![0]).toMatchObject({ kind: "correction", problem: "duplicate", duplicate_of: "b", status: "pending" });
    expect(await submitReport(a, "u2", { venue_key: "a", problem: "wrong_location", lat: 41.2, lon: -73.3 })).toMatchObject({ ok: true });
    expect(a.tables.venue_suggestions![1]).toMatchObject({ lat: 41.2, lon: -73.3 });
  });
});

describe("admin actions", () => {
  it("remove keeps the row (never deleted) and restore brings it back", async () => {
    const a = fakeAdmin({ venues: [venue("a")] });
    expect(await removeField(a, "a", "admin", null, NOW)).toMatchObject({ ok: true });
    expect(a.tables.venues).toHaveLength(1);
    expect(a.tables.venues![0]).toMatchObject({ status: "removed" });
    await restoreField(a, "a", "admin", NOW);
    expect(a.tables.venues![0]).toMatchObject({ status: "active", status_reason: null });
    expect(await removeField(a, "nope", "admin")).toEqual({ ok: false, error: "venue_missing" });
  });

  it("merge moves notes and contacts to the other field and removes this one", async () => {
    const a = fakeAdmin({
      venues: [
        venue("dup", { name: "Riverside Annex", player_notes: "Gate code 1234", availability_notes: "[2026-09-01] closed Sundays", contact_text: "Pat 203-555-0100", booking_phone: "203-555-0100", website: "https://annex.example" }),
        venue("keep", { name: "Riverside Park", player_notes: "Existing note", website: "https://park.example" }),
      ],
    });
    const res = await mergeInto(a, "dup", "keep", "admin", NOW);
    expect(res.ok).toBe(true);
    const keep = a.tables.venues!.find((v) => v.venue_key === "keep")!;
    expect(String(keep.player_notes)).toBe("Existing note\n[merged from Riverside Annex]\nGate code 1234");
    expect(keep).toMatchObject({ contact_text: "Pat 203-555-0100", booking_phone: "203-555-0100", website: "https://park.example" }); // existing website kept
    expect(String(keep.availability_notes)).toMatch(/\[merged from Riverside Annex\] \[2026-09-01\] closed Sundays/);
    const dup = a.tables.venues!.find((v) => v.venue_key === "dup")!;
    expect(dup).toMatchObject({ status: "removed", merged_into: "keep" });
    expect(String(dup.status_reason)).toMatch(/Merged into Riverside Park/);
    expect(a.tables.venues).toHaveLength(2);
    expect(a.tables.venue_data_events!.some((e) => e.venue_key === "keep" && e.field === "player_notes")).toBe(true);
  });
  it("merge is safe to repeat and refuses bad targets", async () => {
    const a = fakeAdmin({ venues: [venue("dup", { player_notes: "n" }), venue("keep"), venue("gone", { status: "removed" })] });
    await mergeInto(a, "dup", "keep", "admin", NOW);
    const once = String(a.tables.venues!.find((v) => v.venue_key === "keep")!.player_notes);
    await mergeInto(a, "dup", "keep", "admin", NOW);
    expect(String(a.tables.venues!.find((v) => v.venue_key === "keep")!.player_notes)).toBe(once);
    expect(await mergeInto(a, "keep", "keep", "admin")).toEqual({ ok: false, error: "same_venue" });
    expect(await mergeInto(a, "keep", "nope", "admin")).toEqual({ ok: false, error: "target_missing" });
    expect(await mergeInto(a, "keep", "gone", "admin")).toEqual({ ok: false, error: "target_inactive" });
  });

  it("move pin applies the reported spot and locks it", async () => {
    const a = fakeAdmin({ venues: [venue("a")] });
    expect(await movePin(a, "a", 41.5, -73.5, "admin", NOW)).toMatchObject({ ok: true });
    expect(a.tables.venues![0]).toMatchObject({ lat: 41.5, lon: -73.5 });
    expect(a.tables.venues![0]!.locked_fields).toEqual(expect.arrayContaining(["lat", "lon"]));
    expect(await movePin(a, "a", null, null, "admin")).toEqual({ ok: false, error: "no_location" });
  });

  it("mark closed until sets a banner date and keeps the field active", async () => {
    const a = fakeAdmin({ venues: [venue("a")] });
    expect(await markClosedUntil(a, "a", "2027-03-01", "Construction", "admin", NOW)).toMatchObject({ ok: true });
    expect(a.tables.venues![0]).toMatchObject({ status: "active", closed_until: "2027-03-01", closed_reason: "Construction" });
    expect(await markClosedUntil(a, "a", "March 1", null, "admin")).toEqual({ ok: false, error: "bad_date" });
  });

  it("the closed banner shows until the date and then goes away", () => {
    const v = { closed_until: "2027-03-01", closed_reason: "Construction", status: "active" as const };
    expect(closedBanner(v, "2026-10-15")).toBe("Closed until Mar 1, 2027: Construction");
    expect(closedBanner(v, "2027-03-01")).toBe("Closed until Mar 1, 2027: Construction");
    expect(closedBanner(v, "2027-03-02")).toBeNull();
    expect(closedBanner({ status: "active" }, "2026-10-15")).toBeNull();
  });
});

describe("importers respect removed and hidden fields", () => {
  const item = (name: string, lat: number, lon: number): Item => ({ file: "ct_outdoor_soccer_fields.csv", line: 2, geo: { lat, lon, matched: "x" }, c: cleanRow({ name, venue_type: "park", operator: "", town: "Fairfield", county: "", address: "1 Main", setting: "outdoor", surface: "grass", field_count: "1", lit: "yes", free_or_paid: "paid", price_text: "$40/hr", price_unit: "hour", permit_required: "yes", permit_issuer: "", how_to_book: "", booking_url: "", contact_email: "", contact_phone: "", residency_rule: "", availability_notes: "", source_url: "", source_date: "", confidence: "high" }, "CT") });
  const gone = (status: string) => ({ venue_key: "old", name: "Riverside Park", lat: 41.15, lon: -73.27, status, price_status: "unknown", locked_fields: [] }) as Row & { venue_key: string; name: string; lat: number; lon: number };

  it("research rows for a removed or hidden field are blocked: not updated, not re-created", () => {
    for (const status of ["removed", "hidden_pending_review"]) {
      const plan = planImport([item("Riverside Park", 41.15, -73.27)], [gone(status)]);
      expect(plan.updates).toHaveLength(0);
      expect(plan.inserts).toHaveLength(0);
      expect(plan.blocked).toHaveLength(1);
      expect(plan.blocked[0]!.near.venue.venue_key).toBe("old");
    }
  });
  it("blocked even with --include-possible-duplicates, and when the name differs but the spot is the same", () => {
    const plan = planImport([item("Totally New Name", 41.15, -73.27), item("Other Name Complex", 41.1502, -73.27)], [gone("removed")], { includeDuplicates: true });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.blocked).toHaveLength(2);
  });
  it("an active field still updates, and a far-away new field is still inserted", () => {
    const active = { ...gone("active"), venue_key: "live" };
    const plan = planImport([item("Riverside Park", 41.15, -73.27), item("Faraway Park", 42.5, -73.27)], [active]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.blocked).toHaveLength(0);
  });
  it("a removed field never blocks an active one that took its place", () => {
    const survivor = { ...gone("active"), venue_key: "keep" };
    const plan = planImport([item("Riverside Park", 41.15, -73.27)], [gone("removed"), survivor]);
    expect(plan.updates.map((u) => u.venue.venue_key)).toEqual(["keep"]);
    expect(plan.blocked).toHaveLength(0);
  });

  // The OSM importer sends rows through upsert_venues(), which is SQL. This checks the migration text; the behaviour itself is
  // checked on dev with the query in the steps (it cannot run in vitest).
  it("upsert_venues skips removed / hidden rows and a removed field returning under a new key", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261022000000_venue_reports.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/x\.venue_key = r\.venue_key and x\.status in \('removed', 'hidden_pending_review'\)/);
    expect(sql).toMatch(/x\.status = 'removed' and x\.venue_key <> r\.venue_key/);
    expect(sql).toMatch(/x\.osm_ids = r\.osm_ids/);
    expect(sql).toMatch(/v\.status = 'active'/); // venues_nearby
    expect(sql).not.toMatch(/status\s*=\s*excluded\.status/); // an import never writes status
  });
});
