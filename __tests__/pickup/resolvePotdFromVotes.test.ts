import { describe, expect, it } from "vitest";
import { resolvePotdWinner } from "@/lib/pickup/resolvePotdFromVotes";

describe("resolvePotdWinner", () => {
  it("picks the nominee with the most votes", () => {
    const a = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const b = "11111111-2222-4333-8444-555555555555";
    const r = resolvePotdWinner(
      [
        { nominee_id: a },
        { nominee_id: a },
        { nominee_id: b },
      ],
      null,
    );
    expect(r.winnerId).toBe(a);
    expect(r.voteCount).toBe(2);
    expect(r.totalVotes).toBe(3);
    expect(r.tied).toBe(false);
  });

  it("uses host tiebreaker when vote counts tie", () => {
    const a = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const b = "11111111-2222-4333-8444-555555555555";
    const r = resolvePotdWinner(
      [
        { nominee_id: a, created_at: "2026-01-01T00:00:00Z" },
        { nominee_id: b, created_at: "2026-01-01T00:00:01Z" },
      ],
      b,
    );
    expect(r.winnerId).toBe(b);
    expect(r.tied).toBe(true);
  });

  it("falls back to host pick when there are no votes", () => {
    const a = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(resolvePotdWinner([], a).winnerId).toBe(a);
    expect(resolvePotdWinner([], null).winnerId).toBeNull();
  });
});
