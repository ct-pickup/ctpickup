import { describe, expect, it } from "vitest";

import {
  fillPatchGroup,
  guardPrice,
  notesBlockGroup,
  planImport,
  possibleDuplicate,
  withNotesGroup,
  type Item,
  cleanFacilityRow,
  isFacilityFile,
  isOutdoorFile,
  isSkipped,
  parseSkipList,
  readFacilityCsv,
  type FacilityRaw,
  cleanRow,
  csvEscape,
  fillPatch,
  findMatch,
  geocodeQuery,
  mergeNotes,
  namesSimilar,
  newVenue,
  nameTokens,
  notesBlock,
  parseCsv,
  parsePrice,
  readResearchCsv,
  stateFromFilename,
  venueKeyFor,
  VenueIndex,
  withNotes,
  type ResearchRaw,
  type Venue,
} from "../scripts/lib/researchImport";

function raw(over: Partial<ResearchRaw> = {}): ResearchRaw {
  return {
    name: "Riverside Park", venue_type: "park", operator: "Town of Fairfield", town: "Fairfield", county: "Fairfield", address: "45 River Rd",
    setting: "outdoor", surface: "grass", field_count: "2", lit: "yes", free_or_paid: "paid", price_text: "$40/hr", price_unit: "hour",
    permit_required: "yes", permit_issuer: "Parks Dept", how_to_book: "Book online", booking_url: "https://example.com/book", contact_email: "p@x.org",
    contact_phone: "203-555-0100", residency_rule: "Residents only", availability_notes: "Weekends", source_url: "https://example.com/src",
    source_date: "2026-09-01", confidence: "high", ...over,
  };
}
function venue(over: Partial<Venue> = {}): Venue {
  return { venue_key: "osm-1", name: "Riverside Park Field", lat: 41.15, lon: -73.27, price_status: "unknown", permit_required: "unknown", booking_method: "unknown", surface: null, lit: null, verified: false, price_source: "unknown", locked_fields: [], player_notes: null, ...over } as Venue;
}
const at = (m: number) => 41.15 + m / 111_000; // meters north of the venue

describe("csv", () => {
  it("handles quotes, commas, newlines and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "z"]]);
  });
  it("reads the research columns and demands name, address, town", () => {
    const text = "name,address,town,confidence\nA,1 Main,X,low\n";
    const { rows, missing } = readResearchCsv(text);
    expect(rows[0]).toMatchObject({ name: "A", confidence: "low", price_text: "" });
    expect(missing).toContain("price_text");
    expect(() => readResearchCsv("name,town\nA,B\n")).toThrow(/address/);
  });
  it("escapes cells", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape(null)).toBe("");
  });
});

describe("cleaning", () => {
  it("takes the state from the file name and builds the geocode query", () => {
    expect(stateFromFilename("data/research/ct_outdoor_soccer_fields.csv")).toBe("CT");
    expect(stateFromFilename("fields.csv")).toBeNull();
    expect(geocodeQuery({ address: "45 River Rd", town: "Fairfield" }, "CT")).toBe("45 River Rd, Fairfield, CT");
    expect(geocodeQuery({ address: "45 River Rd, Fairfield, CT", town: "Fairfield" }, "CT")).toBe("45 River Rd, Fairfield, CT");
    expect(geocodeQuery({ address: "", town: "Fairfield" }, "CT")).toBeNull();
  });
  it("parses prices without inventing any", () => {
    expect(parsePrice({ free_or_paid: "paid", price_text: "$40/hr", price_unit: "hour" })).toMatchObject({ status: "paid", min: 40, max: 40, unit: "hour" });
    expect(parsePrice({ free_or_paid: "paid", price_text: "$25-$40 per game", price_unit: "" })).toMatchObject({ min: 25, max: 40, unit: "game" });
    expect(parsePrice({ free_or_paid: "free", price_text: "", price_unit: "" }).status).toBe("free");
    expect(parsePrice({ free_or_paid: "unknown", price_text: "ask", price_unit: "" })).toEqual({ status: "unknown", text: null, min: null, max: null, unit: null });
  });
  it("flags low confidence and normalizes setting", () => {
    expect(cleanRow(raw({ confidence: "Low" }), "CT").lowConfidence).toBe(true);
    expect(cleanRow(raw({ setting: "Indoor" }), "CT").setting).toBe("indoor");
    expect(cleanRow(raw({ setting: "" }), "CT").setting).toBe("outdoor");
  });
});

describe("names", () => {
  it("ignores filler words", () => {
    expect(nameTokens("The Riverside Park Fields")).toEqual(["riverside"]);
    expect(namesSimilar("Riverside Park", "Riverside Field")).toBe(true);
    expect(namesSimilar("Lincoln High School", "Lincoln High School Turf")).toBe(true);
    expect(namesSimilar("Riverside Park", "Hillcrest School")).toBe(false);
  });
});

describe("matching", () => {
  const index = () => {
    const i = new VenueIndex();
    i.add(venue());
    i.add(venue({ venue_key: "osm-2", name: "Hillcrest School", lat: at(100) }));
    return i;
  };
  it("matches within 150 m with a similar name", () => {
    const m = findMatch("Riverside Park", at(120), -73.27, index());
    expect(m?.venue.venue_key).toBe("osm-1");
    expect(m?.reason).toBe("near + similar name");
  });
  it("does not match a similar name beyond 150 m", () => {
    expect(findMatch("Riverside Park", at(200), -73.27, index())).toBeNull();
  });
  it("does not match a different name between 40 and 150 m", () => {
    expect(findMatch("Totally Different Complex", at(-80), -73.27, index())).toBeNull();
  });
  it("matches any name within 40 m", () => {
    const m = findMatch("Totally Different Complex", at(-30), -73.27, index());
    expect(m).toMatchObject({ reason: "very near" });
    expect(m?.venue.venue_key).toBe("osm-1");
  });
  it("prefers the similar name over a closer different one", () => {
    const i = new VenueIndex();
    i.add(venue({ venue_key: "near", name: "Parking Lot B", lat: at(60) }));
    i.add(venue({ venue_key: "named", name: "Riverside Field", lat: at(100) }));
    expect(findMatch("Riverside Park", at(0) - 0 + 0, -73.27, i)?.venue.venue_key).toBe("named");
  });
});

describe("filling a matched venue", () => {
  it("fills only empty or unknown values, locks them, and never touches name, price_source or verified", () => {
    const patch = fillPatch(venue(), cleanRow(raw(), "CT"));
    expect(patch).toMatchObject({ price_status: "paid", price_min: 40, price_unit: "hour", permit_required: "yes", booking_method: "online", surface: "grass", lit: "yes" });
    expect(patch.locked_fields).toEqual(expect.arrayContaining(["price", "permit", "booking", "surface", "lit"]));
    for (const k of ["name", "price_source", "verified", "lat", "lon"]) expect(patch).not.toHaveProperty(k);
  });
  it("keeps values that are already known", () => {
    const v = venue({ price_status: "free", permit_required: "no", surface: "turf", lit: "no", booking_method: "phone", booking_url: "https://old", booking_phone: "1", booking_basis: "old" });
    expect(fillPatch(v, cleanRow(raw(), "CT"))).toEqual({});
  });
  it("skips research that says unknown instead of overwriting", () => {
    const c = cleanRow(raw({ free_or_paid: "unknown", price_text: "", permit_required: "unknown", booking_url: "", contact_phone: "", how_to_book: "", surface: "unknown", lit: "unknown" }), "CT");
    expect(fillPatch(venue(), c)).toEqual({});
  });
  it("keeps the existing locks when adding new ones", () => {
    const patch = fillPatch(venue({ locked_fields: ["name"] }), cleanRow(raw(), "CT"));
    expect(patch.locked_fields).toEqual(expect.arrayContaining(["name", "price"]));
  });
});

describe("notes", () => {
  it("stores source, residency, availability and contact, and flags low confidence", () => {
    const block = notesBlock(cleanRow(raw({ confidence: "low" }), "CT"));
    expect(block).toMatch(/Source: https:\/\/example.com\/src \(2026-09-01\)/);
    expect(block).toMatch(/Residency: Residents only/);
    expect(block).toMatch(/Availability: Weekends/);
    expect(block).toMatch(/LOW CONFIDENCE/);
    expect(block).toMatch(/p@x.org/);
  });
  it("replaces an earlier block on a rerun and keeps other notes", () => {
    const once = mergeNotes("admin note", notesBlock(cleanRow(raw(), "CT")));
    const twice = mergeNotes(once, notesBlock(cleanRow(raw({ residency_rule: "Open to all" }), "CT")));
    expect(twice.match(/\[research\]/g)).toHaveLength(1);
    expect(twice).toMatch(/^admin note/);
    expect(twice).toMatch(/Open to all/);
    expect(twice).not.toMatch(/Residents only/);
  });
  it("reports no change when the notes are already current", () => {
    const c = cleanRow(raw(), "CT");
    const v = venue({ player_notes: mergeNotes(null, notesBlock(c)) });
    expect(withNotes(v, {}, c)).toEqual({});
  });
});

describe("new venues", () => {
  it("are manual, unverified, never Verified-looking, and keyed by a stable hash", () => {
    const c = cleanRow(raw(), "CT");
    const v = newVenue(c, 41.1, -73.2, "45 RIVER RD, FAIRFIELD, CT");
    expect(v).toMatchObject({ source: "manual", verified: false, price_source: "unknown", setting: "outdoor", price_status: "paid", state: "CT" });
    expect(v.permit_basis).toMatch(/^research:/);
    expect(v.venue_key).toBe(venueKeyFor("Riverside Park", "45 River Rd"));
    expect(venueKeyFor("riverside  park", "45 river rd")).toBe(v.venue_key);
    expect(venueKeyFor("Other Park", "45 River Rd")).not.toBe(v.venue_key);
    expect(v.locked_fields).toEqual(expect.arrayContaining(["name", "price", "permit", "booking"]));
  });
  it("uses the row's setting and leaves unknown prices unknown", () => {
    const v = newVenue(cleanRow(raw({ setting: "indoor", free_or_paid: "unknown", price_text: "", permit_required: "unknown" }), "CT"), 1, 2, null);
    expect(v).toMatchObject({ setting: "indoor", price_status: "unknown", permit_required: "unknown", permit_basis: null });
  });
});

function fac(over: Partial<FacilityRaw> = {}): FacilityRaw {
  return {
    name: "Indoor Kicks", operator_or_chain: "Kicks LLC", address: "10 Dome Way", town: "Stamford", county: "Fairfield", setting: "indoor", surface: "Turf",
    field_count: "2", field_sizes: "7v7", price_text: "$150/hr", price_unit: "hour", min_booking: "1 hour", pickup_or_dropin: "Thursday drop-in",
    pickup_price: "$12", membership_required: "no", booking_url: "https://kicks.example/book", phone: "203-555-0111", email: "hi@kicks.example",
    website: "kicks.example", hours: "9am-11pm", source_url: "https://src.example", source_date: "2026-09-02", confidence: "medium", ...over,
  };
}

describe("facility files", () => {
  it("tells the two file kinds apart", () => {
    expect(isFacilityFile("data/research/ct_soccer_facilities_2026.csv")).toBe(true);
    expect(isFacilityFile("data/research/ct_outdoor_soccer_fields.csv")).toBe(false);
    expect(isOutdoorFile("data/research/ct_outdoor_soccer_fields.csv")).toBe(true);
  });

  it("parses multi-line quoted price text", () => {
    const header = "name,address,town,price_text,confidence";
    const text = `${header}\r\n"Indoor Kicks","10 Dome Way","Stamford","Weekday $150/hr\r\nWeekend $200/hr, 2 hr min","high"\r\nSecond,"2 Main St",Town,"$80/hr",low\r\n`;
    const { rows } = readFacilityCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.price_text).toBe("Weekday $150/hr\r\nWeekend $200/hr, 2 hr min");
    expect(rows[1]).toMatchObject({ name: "Second", confidence: "low" });
    const c = cleanFacilityRow({ ...fac(), ...rows[0]! }, "CT");
    expect(c.price).toMatchObject({ status: "paid", min: 150, max: 200, unit: "hour" });
    expect(c.raw.price_text).toBe("Weekday $150/hr; Weekend $200/hr, 2 hr min");
  });
});

describe("skip list", () => {
  const skip = ["Danbury PAL Center", "Boys & Girls Club of Ridgefield", "Raymond P. Lavietes Clubhouse", "Erin's Gym"];
  it("skips listed names, ignoring case, punctuation and & / and", () => {
    expect(isSkipped("danbury pal center", skip)).toBe(true);
    expect(isSkipped("Boys and Girls Club of Ridgefield", skip)).toBe(true);
    expect(isSkipped("Raymond P Lavietes Clubhouse", skip)).toBe(true);
    expect(isSkipped("Erins Gym - Ridgefield", skip)).toBe(true);
  });
  it("does not skip other rows or partial words", () => {
    expect(isSkipped("Danbury Soccer Dome", skip)).toBe(false);
    expect(isSkipped("Boys & Girls Club of Norwalk", skip)).toBe(false);
    expect(isSkipped("Anything", [])).toBe(false);
  });
  it("reads both file shapes and rejects a bad one", () => {
    expect(parseSkipList(["A", " B "])).toEqual(["A", "B"]);
    expect(parseSkipList({ names: ["A"] })).toEqual(["A"]);
    expect(() => parseSkipList({ name: ["A"] })).toThrow();
    expect(() => parseSkipList([1])).toThrow();
  });
});

describe("birthday and package prices", () => {
  it("are never a rental price, but stay in the notes", () => {
    const c = cleanFacilityRow(fac({ price_text: "Birthday party package $350 for 12 kids" }), "CT");
    expect(c.priceGuarded).toBe(true);
    expect(c.price.status).toBe("unknown");
    expect(fillPatch(venue(), c)).not.toHaveProperty("price_status");
    const v = newVenue(c, 1, 2, null);
    expect(v).toMatchObject({ price_status: "unknown", price_min: null, price_text: null, price_source: "unknown" });
    expect(notesBlock(c)).toMatch(/not used as a rental price.*Birthday party package \$350/);
    expect(String(v.player_notes)).toMatch(/\$350/);
  });
  it("keeps a normal rental price", () => {
    const c = cleanFacilityRow(fac(), "CT");
    expect(c.priceGuarded).toBe(false);
    expect(c.price).toMatchObject({ status: "paid", min: 150, unit: "hour" });
  });
});

describe("facility column mapping", () => {
  it("maps phone, booking url, website and membership onto columns, and the rest into notes", () => {
    const c = cleanFacilityRow(fac({ membership_required: "yes" }), "CT");
    const patch = fillPatch(venue(), c);
    expect(patch).toMatchObject({ booking_method: "online", booking_url: "https://kicks.example/book", booking_phone: "203-555-0111", website: "https://kicks.example", permit_required: "yes", permit_type: "membership" });
    expect(patch.locked_fields).toEqual(expect.arrayContaining(["booking", "website", "permit"]));
    const notes = notesBlock(c);
    for (const t of ["hi@kicks.example", "Hours: 9am-11pm", "Minimum booking: 1 hour", "Pickup / drop-in: Thursday drop-in, price $12", "Field sizes: 7v7", "Membership required"]) expect(notes).toContain(t);
  });
  it("uses phone booking when there is no link, and never marks anything verified", () => {
    const v = newVenue(cleanFacilityRow(fac({ booking_url: "" }), "CT"), 1, 2, null);
    expect(v).toMatchObject({ booking_method: "phone", verified: false, source: "manual", price_source: "unknown", setting: "indoor", operator: "Kicks LLC", website: "https://kicks.example" });
  });
});

const item = (c: ReturnType<typeof cleanRow>, lat: number, lon: number, line = 1): Item => ({ file: "ct_outdoor_soccer_fields.csv", line, c, geo: { lat, lon, matched: "X" } });
const campus = (over: Partial<ResearchRaw>) => cleanRow(raw({ free_or_paid: "unknown", price_text: "", permit_required: "unknown", booking_url: "", contact_phone: "", how_to_book: "", surface: "unknown", lit: "unknown", ...over }), "CT");

describe("many rows, one venue", () => {
  it("fills a value when every matching row agrees", () => {
    const a = campus({ name: "Hillcrest Field 1", surface: "Turf", lit: "yes" });
    const b = campus({ name: "Hillcrest Field 2", surface: "turf", lit: "yes" });
    const { patch, disagreements } = fillPatchGroup(venue(), [a, b]);
    expect(patch).toMatchObject({ surface: "turf", lit: "yes" });
    expect(disagreements).toEqual([]);
  });
  it("leaves a value empty when the rows disagree, and says so", () => {
    const a = campus({ name: "Hillcrest Field 1", surface: "turf", lit: "yes", free_or_paid: "paid", price_text: "$40/hr", permit_required: "yes" });
    const b = campus({ name: "Hillcrest Field 2", surface: "grass", lit: "yes", free_or_paid: "paid", price_text: "$60/hr", permit_required: "no" });
    const { patch, disagreements } = fillPatchGroup(venue(), [a, b]);
    expect(patch).toMatchObject({ lit: "yes" });
    for (const k of ["surface", "price_status", "price_min", "permit_required"]) expect(patch).not.toHaveProperty(k);
    expect(disagreements).toEqual(expect.arrayContaining(["surface", "price", "permit"]));
    expect(disagreements).not.toContain("lit");
    expect(notesBlockGroup([a, b], disagreements)).toMatch(/multiple fields on this campus/);
  });
  it("a row with no opinion does not block the others", () => {
    const a = campus({ name: "A", surface: "turf" });
    const b = campus({ name: "B", surface: "unknown" });
    expect(fillPatchGroup(venue(), [a, b]).patch).toMatchObject({ surface: "turf" });
  });
  it("combines every row in the notes, not just the last", () => {
    const a = campus({ name: "Hillcrest Field 1", residency_rule: "Residents only", source_url: "https://a.example" });
    const b = campus({ name: "Hillcrest Field 2", availability_notes: "Weekends only", source_url: "https://b.example" });
    const block = notesBlockGroup([a, b], []);
    for (const t of ["2 research rows matched", "-- Hillcrest Field 1 --", "-- Hillcrest Field 2 --", "https://a.example", "https://b.example", "Residents only", "Weekends only"]) expect(block).toContain(t);
    expect(block.match(/\[research\]/g)).toHaveLength(1);
    const notes = withNotesGroup(venue(), {}, [a, b]).player_notes as string;
    expect(notes).toContain("Hillcrest Field 2");
  });
  it("plans several rows matching one venue as one update", () => {
    const plan = planImport([item(campus({ name: "Riverside Park", surface: "turf" }), 41.15, -73.27, 2), item(campus({ name: "Riverside Field 2", surface: "grass" }), at(20), -73.27, 3)], [venue()]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.items).toHaveLength(2);
    expect(plan.updates[0]!.patch).not.toHaveProperty("surface");
    expect(String(plan.updates[0]!.patch.player_notes)).toMatch(/multiple fields on this campus/);
    expect(plan.inserts).toHaveLength(0);
  });
});

describe("group, organization and non-resident prices", () => {
  it.each(["Group 3: $25/hr", "For-profit $120/hr", "Commercial rate $200", "Organization rate $90/hr", "Non-resident $80/hr", "Outside group $75"])("%s is kept in the notes only", (text) => {
    const c = cleanRow(raw({ free_or_paid: "paid", price_text: text }), "CT");
    expect(c.priceGuarded).toBe(true);
    expect(c.price).toEqual({ status: "unknown", text: null, min: null, max: null, unit: null });
    const patch = fillPatch(venue(), c);
    for (const k of ["price_status", "price_min", "price_max", "price_text"]) expect(patch).not.toHaveProperty(k);
    expect(notesBlock(c)).toContain(text);
    expect(newVenue(c, 1, 2, null)).toMatchObject({ price_status: "unknown", price_min: null, price_max: null });
  });
  it("applies to facility rows too, and leaves an ordinary price alone", () => {
    expect(cleanFacilityRow(fac({ price_text: "Non-resident $90/hr" }), "CT").priceGuarded).toBe(true);
    expect(guardPrice(cleanRow(raw({ price_text: "$40/hr" }), "CT")).priceGuarded).toBe(false);
  });
});

describe("duplicate prevention for new venues", () => {
  const c = (name: string, extra: Partial<ResearchRaw> = {}) => cleanRow(raw({ name, ...extra }), "CT");
  const existing = [venue({ venue_key: "osm-9", name: "Something Else", lat: 41.15, lon: -73.27 })];
  it("holds back a new venue within 300 m of an existing one", () => {
    const plan = planImport([item(c("Brand New Complex"), at(250), -73.27)], existing);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.duplicates[0]!.near.venue.venue_key).toBe("osm-9");
    expect(Math.round(plan.duplicates[0]!.near.meters)).toBeGreaterThan(200);
  });
  it("inserts a new venue that is more than 300 m from everything", () => {
    const plan = planImport([item(c("Brand New Complex"), at(400), -73.27)], existing);
    expect(plan.duplicates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]!.nearest?.venue.venue_key).toBe("osm-9");
  });
  it("holds back a school whose school_name matches within 800 m", () => {
    const sch = [venue({ venue_key: "osm-s", name: "Stadium Turf", school_name: "Lincoln High School", lat: 41.15, lon: -73.27 })];
    const row = c("Lincoln High School", { venue_type: "school" });
    const dup = possibleDuplicate(row, at(600), -73.27, (() => { const i = new VenueIndex(); sch.forEach((v) => i.add(v)); return i; })());
    expect(dup?.why).toMatch(/same school within 800/);
    const plan = planImport([item(row, at(600), -73.27)], sch);
    expect(plan.duplicates).toHaveLength(1);
    // a different school at the same distance is not a duplicate
    expect(planImport([item(c("Washington High School", { venue_type: "school" }), at(600), -73.27)], sch).inserts).toHaveLength(1);
  });
  it("inserts them anyway with --include-possible-duplicates, flagged", () => {
    const plan = planImport([item(c("Brand New Complex"), at(250), -73.27)], existing, { includeDuplicates: true });
    expect(plan.duplicates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ flaggedDuplicate: true });
  });
  it("ignores a repeated new row instead of inserting twice", () => {
    const plan = planImport([item(c("Brand New Complex"), at(900), -73.27, 2), item(c("Brand New Complex"), at(900), -73.27, 3)], existing);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.repeats).toHaveLength(1);
  });
  it("lists geocode failures separately", () => {
    const plan = planImport([{ file: "f", line: 2, c: c("Nowhere"), geo: null }], existing);
    expect(plan.noGeo).toHaveLength(1);
  });
});
