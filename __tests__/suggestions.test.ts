import { describe, expect, it } from "vitest";

import { approveSuggestion, rejectSuggestion } from "../lib/fields/suggestionApprove";
import {
  appendNotes,
  bboxAround,
  buildCorrectionPatch,
  buildVenueFromSuggestion,
  confirmationLabel,
  findDuplicates,
  metersBetween,
  newVenueProblem,
  normalizeWebsite,
  parsePermitNote,
  parsePriceNote,
  type SuggestionRow,
} from "../shared/fields/suggestions";

const NOW = "2026-10-15T12:00:00.000Z";

function sug(over: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: "abc",
    user_id: "u1",
    kind: "new_venue",
    venue_key: null,
    problem: null,
    lat: 41.1,
    lon: -73.2,
    name: " Waterside Turf ",
    setting: "outdoor",
    surface: "turf",
    price_note: null,
    permit_note: null,
    website: null,
    note: null,
    status: "pending",
    ...over,
  };
}

describe("duplicate distance", () => {
  it("measures meters", () => {
    expect(metersBetween(41, -73, 41, -73)).toBe(0);
    // 0.001 degrees of latitude is about 111 m
    expect(metersBetween(41, -73, 41.001, -73)).toBeGreaterThan(110);
    expect(metersBetween(41, -73, 41.001, -73)).toBeLessThan(112);
  });

  it("keeps fields within 150 m, nearest first, and drops missing coordinates", () => {
    const list = [
      { k: "far", lat: 41.002, lon: -73 }, // ~222 m
      { k: "near", lat: 41.0005, lon: -73 }, // ~56 m
      { k: "edge", lat: 41.0013, lon: -73 }, // ~145 m
      { k: "nocoords", lat: null, lon: null },
    ];
    const out = findDuplicates(list, 41, -73);
    expect(out.map((o) => o.k)).toEqual(["near", "edge"]);
    expect(out[0].meters).toBeLessThan(out[1].meters);
  });

  it("respects a custom radius", () => {
    expect(findDuplicates([{ lat: 41.0005, lon: -73 }], 41, -73, 30)).toHaveLength(0);
  });

  it("builds a box larger than the radius", () => {
    const b = bboxAround(41, -73, 150);
    expect(41 - b.minLat).toBeGreaterThan(150 / 111_000);
    expect(b.maxLon).toBeGreaterThan(-73);
  });
});

describe("form checks", () => {
  it("normalizes websites", () => {
    expect(normalizeWebsite("example.com")).toBe("https://example.com/");
    expect(normalizeWebsite("nope")).toBeNull();
    expect(normalizeWebsite("  ")).toBeNull();
  });

  it("finds the first problem with a new field", () => {
    expect(newVenueProblem({ name: "Turf", lat: null, lon: null, setting: "outdoor" })).toMatch(/pin/i);
    expect(newVenueProblem({ name: "", lat: 1, lon: 1, setting: "outdoor" })).toMatch(/name/i);
    expect(newVenueProblem({ name: "Turf", lat: 1, lon: 1, setting: null })).toMatch(/indoor/i);
    expect(newVenueProblem({ name: "Turf", lat: 1, lon: 1, setting: "indoor", website: "x" })).toMatch(/website/i);
    expect(newVenueProblem({ name: "Turf", lat: 1, lon: 1, setting: "both" })).toBeNull();
  });

  it("parses price and permit notes", () => {
    expect(parsePriceNote("Free")).toMatchObject({ price_status: "free", price_text: "Free" });
    expect(parsePriceNote("$40/hr")).toMatchObject({ price_status: "paid", price_min: 40, price_unit: "hour" });
    expect(parsePriceNote("ask the office")).toEqual({ price_text: "ask the office" });
    expect(parsePriceNote(" ")).toBeNull();
    expect(parsePermitNote("walk-up, no permit")).toMatchObject({ permit_required: "no" });
    expect(parsePermitNote("members only")).toMatchObject({ permit_type: "membership" });
    expect(parsePermitNote("hmm")).toEqual({});
  });

  it("appends notes", () => {
    expect(appendNotes(null, "a")).toBe("a");
    expect(appendNotes("x", "a")).toBe("x\na");
    expect(appendNotes("x", "")).toBe("x");
  });

  it("labels confirmations", () => {
    expect(confirmationLabel(0)).toBeNull();
    expect(confirmationLabel(1)).toBe("Confirmed by 1 player");
    expect(confirmationLabel(3)).toBe("Confirmed by 3 players");
  });
});

describe("what approval writes", () => {
  it("builds a player venue that imports cannot overwrite", () => {
    const row = buildVenueFromSuggestion(sug({ price_note: "$40/hr", permit_note: "reservation needed" }), NOW);
    expect(row).toMatchObject({ venue_key: "player-abc", name: "Waterside Turf", source: "player", verified: false, price_source: "manual", permit_basis: "manual" });
    expect(row.locked_fields).toEqual(expect.arrayContaining(["name", "lat", "lon", "setting"]));
  });

  it("does not mark price or permit manual when nothing was given", () => {
    const row = buildVenueFromSuggestion(sug(), NOW);
    expect(row.price_source).toBe("unknown");
    expect(row.permit_basis).toBeUndefined();
  });

  it("builds a correction patch and keeps earlier locks and notes", () => {
    const patch = buildCorrectionPatch(sug({ kind: "correction", venue_key: "v", problem: "wrong_price", lat: null, lon: null, name: null, setting: null, surface: null, price_note: "Free" }), { locked_fields: ["name"], player_notes: "old" }, NOW);
    expect(patch).toMatchObject({ price_status: "free", price_source: "manual" });
    expect(patch.locked_fields).toEqual(["name"]);
    expect(String(patch.player_notes)).toMatch(/^old\n/);
    expect(patch.name).toBeUndefined();
  });

  it("locks changed columns and notes a closure", () => {
    const patch = buildCorrectionPatch(sug({ kind: "correction", venue_key: "v", problem: "closed", name: "New", setting: "indoor", note: "gone" }), {}, NOW);
    expect(patch.locked_fields).toEqual(expect.arrayContaining(["name", "setting", "lat", "lon"]));
    expect(String(patch.player_notes)).toMatch(/Reported closed/);
  });
});

/** A tiny in-memory stand-in for the two tables the approve code touches. */
function fakeAdmin(seed: { suggestions: Record<string, unknown>[]; venues: Record<string, unknown>[] }) {
  const tables: Record<string, Record<string, unknown>[]> = { venue_suggestions: seed.suggestions, venues: seed.venues };
  return {
    tables,
    from(name: string) {
      const rows = tables[name];
      return {
        select: () => ({
          eq: (col: string, val: unknown) => ({ maybeSingle: async () => ({ data: rows.find((r) => r[col] === val) ?? null, error: null }) }),
        }),
        upsert: async (row: Record<string, unknown>, opts: { onConflict: string }) => {
          const i = rows.findIndex((r) => r[opts.onConflict] === row[opts.onConflict]);
          if (i >= 0) rows[i] = { ...rows[i], ...row };
          else rows.push(row);
          return { error: null };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async (col: string, val: unknown) => {
            for (const r of rows) if (r[col] === val) Object.assign(r, patch);
            return { error: null };
          },
        }),
      };
    },
  };
}

describe("approve and reject", () => {
  const asClient = (f: ReturnType<typeof fakeAdmin>) => f as unknown as Parameters<typeof approveSuggestion>[0];

  it("approves a new field", async () => {
    const f = fakeAdmin({ suggestions: [{ ...sug() }], venues: [] });
    expect(await approveSuggestion(asClient(f), "abc", "admin1", NOW)).toBe("approved");
    expect(f.tables.venues[0]).toMatchObject({ venue_key: "player-abc", source: "player" });
    expect(f.tables.venue_suggestions[0]).toMatchObject({ status: "approved", reviewed_by: "admin1", created_venue_key: "player-abc" });
  });

  it("is safe to retry and reports already handled", async () => {
    const f = fakeAdmin({ suggestions: [{ ...sug() }], venues: [] });
    await approveSuggestion(asClient(f), "abc", "admin1", NOW);
    expect(await approveSuggestion(asClient(f), "abc", "admin2", NOW)).toBe("already");
    expect(f.tables.venues).toHaveLength(1);
  });

  it("applies a correction to the venue", async () => {
    const f = fakeAdmin({
      suggestions: [{ ...sug({ kind: "correction", venue_key: "v1", problem: "wrong_price", name: null, lat: null, lon: null, setting: null, surface: null, price_note: "Free" }) }],
      venues: [{ venue_key: "v1", name: "Old", locked_fields: [], player_notes: null }],
    });
    expect(await approveSuggestion(asClient(f), "abc", "admin1", NOW)).toBe("approved");
    expect(f.tables.venues[0]).toMatchObject({ name: "Old", price_status: "free", price_source: "manual" });
  });

  it("does not approve when the venue is gone or the suggestion is missing", async () => {
    const f = fakeAdmin({ suggestions: [{ ...sug({ kind: "correction", venue_key: "gone", problem: "closed" }) }], venues: [] });
    expect(await approveSuggestion(asClient(f), "abc", "admin1", NOW)).toBe("venue_missing");
    expect(f.tables.venue_suggestions[0].status).toBe("pending");
    expect(await approveSuggestion(asClient(f), "nope", "admin1", NOW)).toBe("missing");
  });

  it("rejects once", async () => {
    const f = fakeAdmin({ suggestions: [{ ...sug() }], venues: [] });
    expect(await rejectSuggestion(asClient(f), "abc", "admin1", NOW)).toBe("rejected");
    expect(f.tables.venues).toHaveLength(0);
    expect(await rejectSuggestion(asClient(f), "abc", "admin1", NOW)).toBe("already");
    expect(await rejectSuggestion(asClient(f), "zzz", "admin1", NOW)).toBe("missing");
  });
});
