import { describe, expect, it } from "vitest";
import {
  fmtPickupDateFromDateOnlyStartAt,
  fmtPickupRunDateDisplay,
  isPickupRunDateOnlyStartAt,
} from "@/lib/pickup/runStartAtDisplay";

describe("isPickupRunDateOnlyStartAt", () => {
  it("recognizes midnight UTC anchors with Z or +00:00", () => {
    expect(isPickupRunDateOnlyStartAt("2026-06-03T00:00:00Z")).toBe(true);
    expect(isPickupRunDateOnlyStartAt("2026-06-03T00:00:00.000Z")).toBe(true);
    expect(isPickupRunDateOnlyStartAt("2026-06-03T00:00:00+00:00")).toBe(true);
    expect(isPickupRunDateOnlyStartAt("2026-06-03")).toBe(true);
  });

  it("does not treat Eastern kickoff instants as date-only", () => {
    expect(isPickupRunDateOnlyStartAt("2026-05-26T00:00:00.000Z")).toBe(true);
    expect(isPickupRunDateOnlyStartAt("2026-05-26T12:00:00.000Z")).toBe(false);
  });
});

describe("fmtPickupRunDateDisplay", () => {
  it("shows the UTC calendar day for date-only anchors", () => {
    expect(fmtPickupDateFromDateOnlyStartAt("2026-06-03T00:00:00Z")).toMatch(/Jun 3, 2026/);
    expect(fmtPickupDateFromDateOnlyStartAt("2026-06-03T00:00:00+00:00")).toMatch(/Jun 3, 2026/);
    expect(fmtPickupRunDateDisplay("2026-06-03T00:00:00+00:00")).toMatch(/Jun 3, 2026/);
    expect(fmtPickupRunDateDisplay("2026-06-03T00:00:00+00:00")).not.toMatch(/Jun 2/);
  });
});
