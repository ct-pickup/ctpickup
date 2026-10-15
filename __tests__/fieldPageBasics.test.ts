import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { directionsUrl } from "../mobile/lib/fields/directions";
import { lastConfirmedLabel } from "../mobile/lib/fields/presentation";

describe("directions", () => {
  it("opens Apple Maps on iOS with the field's name", () => {
    const u = directionsUrl("ios", 41.1565, -73.2706, "Riverside Park & Field")!;
    expect(u).toMatch(/^http:\/\/maps\.apple\.com\/\?daddr=41\.1565,-73\.2706&q=Riverside%20Park%20%26%20Field/);
  });
  it("opens Google Maps on Android", () => {
    expect(directionsUrl("android", 41.1565, -73.2706, "Riverside")).toBe("https://www.google.com/maps/dir/?api=1&destination=41.1565,-73.2706");
  });
  it("gives no link for a field without a location", () => {
    expect(directionsUrl("ios", null, -73, "x")).toBeNull();
    expect(directionsUrl("android", 41, undefined, "x")).toBeNull();
    expect(directionsUrl("ios", Number.NaN, -73, "x")).toBeNull();
  });
});

describe("last confirmed", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("says Not confirmed yet when there is no date", () => {
    expect(lastConfirmedLabel(null, now)).toEqual({ text: "Not confirmed yet", stale: false });
    expect(lastConfirmedLabel(undefined, now)).toEqual({ text: "Not confirmed yet", stale: false });
    expect(lastConfirmedLabel("garbage", now)).toEqual({ text: "Not confirmed yet", stale: false });
  });
  it("shows month and year", () => {
    expect(lastConfirmedLabel("2026-09-03T10:00:00Z", now)).toEqual({ text: "Last confirmed Sep 2026", stale: false });
  });
  it("is not stale at exactly 12 months, and is stale after", () => {
    expect(lastConfirmedLabel("2025-10-15T12:00:00Z", now).stale).toBe(false);
    expect(lastConfirmedLabel("2025-10-16T00:00:00Z", now).stale).toBe(false);
    expect(lastConfirmedLabel("2025-09-14T00:00:00Z", now)).toEqual({ text: "Last confirmed Sep 2025", stale: true });
    expect(lastConfirmedLabel("2024-01-01T00:00:00Z", now).stale).toBe(true);
  });
});

describe("app config", () => {
  it("every location string covers pickup games and soccer fields", () => {
    const text = readFileSync(new URL("../mobile/app.json", import.meta.url), "utf8");
    expect(text).not.toMatch(/Show pickup sessions near you\./);
    const strings = [...text.matchAll(/"(?:NSLocationWhenInUseUsageDescription|locationWhenInUsePermission)":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(strings).toHaveLength(2);
    for (const s of strings) expect(s).toBe("Show pickup games and soccer fields near you.");
  });
});
