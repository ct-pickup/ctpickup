import { describe, expect, it } from "vitest";
import { formatTournamentStartDisplay } from "../mobile/lib/formatTournament";

describe("formatTournamentStartDisplay", () => {
  it("shows UTC calendar day for date-only anchors", () => {
    expect(formatTournamentStartDisplay("2026-06-03T00:00:00Z")).toMatch(/Jun 3, 2026/);
    expect(formatTournamentStartDisplay("2026-06-03T00:00:00+00:00")).toMatch(/Jun 3, 2026/);
    expect(formatTournamentStartDisplay("2026-06-03T00:00:00Z")).not.toMatch(/Jun 2/);
  });
});
