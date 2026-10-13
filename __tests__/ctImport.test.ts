import { describe, expect, it } from "vitest";
import { checkTarget, chunk, extractRows, normalizeSchool, normalizeVenue, redact, toBoolean } from "../scripts/lib/ctImport";

describe("normalizeVenue", () => {
  it("turns verified 0/1 into booleans and numbers into numbers", () => {
    const a = normalizeVenue({ venue_key: "a", name: "A", verified: 1, lat: "41.5", field_count: "2", price_status: "free" });
    expect(a.row).toMatchObject({ verified: true, lat: 41.5, field_count: 2, price_status: "free" });
    expect(normalizeVenue({ venue_key: "b", name: "B", verified: 0 }).row?.verified).toBe(false);
    expect(normalizeVenue({ venue_key: "c", name: "C" }).row).not.toHaveProperty("verified");
  });
  it("never guesses a verified flag it cannot read", () => {
    const r = normalizeVenue({ venue_key: "a", name: "A", verified: "maybe" });
    expect(r.row).toBeNull();
    expect(r.problems.join()).toContain("verified");
  });
  it("turns blank strings into null and ignores unknown fields", () => {
    const r = normalizeVenue({ venue_key: "a", name: "A", website: "  ", extra_field: 1 });
    expect(r.row?.website).toBeNull();
    expect(r.droppedKeys).toEqual(["extra_field"]);
  });
  it("rejects values the database would refuse", () => {
    expect(normalizeVenue({ venue_key: "a", name: "A", price_status: "cheap" }).row).toBeNull();
    expect(normalizeVenue({ venue_key: "a", name: "A", booking_method: "email" }).row).toBeNull();
    expect(normalizeVenue({ name: "A" }).row).toBeNull();
  });
});

describe("normalizeSchool", () => {
  it("converts has_field_mapped", () => {
    expect(normalizeSchool({ school_key: "s", name: "S", has_field_mapped: "1" }).row?.has_field_mapped).toBe(true);
  });
});

describe("helpers", () => {
  it("reads booleans", () => {
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean("0")).toBe(false);
    expect(toBoolean("x")).toBeNull();
  });
  it("extracts rows from an array or a wrapper", () => {
    expect(extractRows([1])).toEqual([1]);
    expect(extractRows({ venues: [1, 2] })).toEqual([1, 2]);
    expect(() => extractRows({ nope: 1 })).toThrow();
  });
  it("chunks and redacts", () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(redact("token abc123 failed", "abc123")).toBe("token [redacted] failed");
  });
});

describe("checkTarget", () => {
  const base = { allowProd: false, expectHost: null as string | null, prodHosts: [] as string[] };
  it("refuses anything that looks like production without --allow-prod", () => {
    expect(checkTarget("https://myapp-prod.supabase.co", { ...base, expectHost: "myapp-prod.supabase.co" }).ok).toBe(false);
    expect(checkTarget("https://abcdef.supabase.co", { ...base, expectHost: "abcdef.supabase.co", prodHosts: ["abcdef.supabase.co"] }).ok).toBe(false);
  });
  it("allows production only with the flag and the host echoed back", () => {
    expect(checkTarget("https://myapp-prod.supabase.co", { ...base, allowProd: true, expectHost: "myapp-prod.supabase.co" }).ok).toBe(true);
    expect(checkTarget("https://myapp-prod.supabase.co", { ...base, allowProd: true }).ok).toBe(false);
  });
  it("allows a local database and requires the host for a remote one", () => {
    expect(checkTarget("http://127.0.0.1:54321", base).ok).toBe(true);
    expect(checkTarget("https://devref.supabase.co", base).ok).toBe(false);
    expect(checkTarget("https://devref.supabase.co", { ...base, expectHost: "devref.supabase.co" }).ok).toBe(true);
    expect(checkTarget("https://devref.supabase.co", { ...base, expectHost: "other.supabase.co" }).ok).toBe(false);
  });
});
