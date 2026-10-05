import { describe, expect, it } from "vitest";

import { annualSaving, FALLBACK_PRICE, PLAN_META, renewLine } from "../mobile/lib/ctplus/plans";

describe("annualSaving", () => {
  it("computes the saving from live prices, not a constant", () => {
    // $2.99 x 12 = $35.88 against $19.99: saves $15.89, 44%.
    expect(annualSaving(2.99, 19.99, "USD")).toEqual({ percent: 44, amountText: "$15.89" });
    // A different storefront price gives a different answer.
    expect(annualSaving(3.99, 29.99, "USD")?.percent).toBe(37);
  });
  it("is null when a price is missing or yearly is not cheaper", () => {
    expect(annualSaving(null, 19.99)).toBeNull();
    expect(annualSaving(2.99, undefined)).toBeNull();
    expect(annualSaving(2.99, 35.88)).toBeNull();
    expect(annualSaving(2.99, 40)).toBeNull();
  });
});

describe("renewLine", () => {
  it("matches the selected plan", () => {
    expect(renewLine("monthly", "$2.99")).toBe("Auto-renews monthly at $2.99 until canceled. Cancel anytime in your Apple ID settings.");
    expect(renewLine("annual", "$19.99")).toBe("Auto-renews yearly at $19.99 until canceled. Cancel anytime in your Apple ID settings.");
  });
});

describe("plans", () => {
  it("uses the RevenueCat package ids and keeps prices only as fallbacks", () => {
    expect(PLAN_META.monthly.packageId).toBe("$rc_monthly");
    expect(PLAN_META.annual.packageId).toBe("$rc_annual");
    expect(FALLBACK_PRICE).toEqual({ monthly: "$2.99", annual: "$19.99" });
  });
});
