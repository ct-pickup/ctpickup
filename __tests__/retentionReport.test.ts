import { describe, expect, it } from "vitest";

import { biggestDrop, buildRetentionReport, headlineSecondGame, type FunnelRow } from "@/lib/analytics/report";

const f = (step: string, label: string, players: number, step_order: number): FunnelRow => ({ step_order, step, label, players });

describe("biggestDrop", () => {
  it("names the step that loses the largest share", () => {
    const d = biggestDrop([f("account_approved", "Approved", 100, 1), f("run_list_viewed", "Looked", 80, 2), f("run_viewed", "Opened", 70, 3), f("rsvp_started", "Started", 20, 4), f("rsvp_completed", "Joined", 18, 5), f("attended", "Played", 15, 6)]);
    expect(d).toMatchObject({ from_label: "Opened", to_label: "Started", lost: 50, drop_pct: 71.4 });
  });
  it("skips steps with no data and compares across them", () => {
    const d = biggestDrop([f("account_approved", "Approved", 40, 1), f("run_list_viewed", "Looked", 0, 2), f("rsvp_completed", "Joined", 10, 5), f("attended", "Played", 9, 6)]);
    expect(d).toMatchObject({ from_label: "Approved", to_label: "Joined", lost: 30, drop_pct: 75 });
  });
  it("treats a bigger later step as no loss", () => {
    expect(biggestDrop([f("account_approved", "Approved", 10, 1), f("rsvp_started", "Started", 4, 4), f("rsvp_completed", "Joined", 9, 5)])?.to_label).toBe("Started");
    expect(biggestDrop([f("a", "A", 10, 1), f("b", "B", 12, 2)])).toBeNull();
  });
  it("says nothing when the numbers are too small or missing", () => {
    expect(biggestDrop([])).toBeNull();
    expect(biggestDrop([f("account_approved", "Approved", 3, 1), f("attended", "Played", 0, 6)])).toBeNull();
    expect(biggestDrop([f("account_approved", "Approved", 4, 1), f("attended", "Played", 1, 6)])).toBeNull();
  });
});

describe("headlineSecondGame", () => {
  it("uses finished cohorts only", () => {
    const h = headlineSecondGame([
      { cohort_week: "2026-08-03", players: 10, returned: 4, rate_pct: 40, mature: true },
      { cohort_week: "2026-08-10", players: 30, returned: 6, rate_pct: 20, mature: true },
      { cohort_week: "2026-10-19", players: 50, returned: 1, rate_pct: 2, mature: false },
    ]);
    expect(h).toEqual({ rate_pct: 25, players: 40, returned: 10, weeks: 2 });
  });
  it("is null with no finished cohort", () => {
    expect(headlineSecondGame([{ cohort_week: "2026-10-19", players: 5, returned: 0, rate_pct: 0, mature: false }])).toBeNull();
  });
});

describe("buildRetentionReport", () => {
  it("survives empty and junk input", () => {
    const r = buildRetentionReport({ funnel: null, second_game: undefined, cohorts: "x", run_health: {}, notifications: [] });
    expect(r).toMatchObject({ funnel: [], biggest_drop: null, has_app_steps: false, second_game: [], second_game_headline: null, cohorts: [], run_health: [] });
  });
  it("coerces view numbers that arrive as strings", () => {
    const r = buildRetentionReport({ funnel: [{ step_order: "1", step: "account_approved", label: "Approved", players: "12" }, { step_order: "3", step: "run_viewed", label: "Opened", players: "9" }], second_game: [], cohorts: [], run_health: [], notifications: [] });
    expect(r.funnel.map((s) => s.players)).toEqual([12, 9]);
    expect(r.has_app_steps).toBe(true);
  });
});
