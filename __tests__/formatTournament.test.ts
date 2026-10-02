import { describe, expect, it } from "vitest";
import { formatTournamentStartDisplay } from "../mobile/lib/formatTournament";

describe("formatTournamentStartDisplay", () => {
  it("shows midnight UTC as the Eastern evening before", () => {
    expect(formatTournamentStartDisplay("2026-06-03T00:00:00Z")).toMatch(/Jun 2, 2026.*8:00\sPM EDT/);
    expect(formatTournamentStartDisplay("2026-01-15T00:00:00+00:00")).toMatch(/Jan 14, 2026.*7:00\sPM EST/);
    expect(formatTournamentStartDisplay(null)).toBe("TBD");
  });
});
