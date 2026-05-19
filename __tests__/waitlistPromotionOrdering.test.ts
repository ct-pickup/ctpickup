import { describe, expect, it } from "vitest";
import { pickNextWaitlistCandidate, sortWaitlistCandidates } from "@/lib/pickup/waitlistOrdering";

describe("waitlist promotion ordering", () => {
  const rows = [
    { user_id: "c", waitlist_position: 3, created_at: "2026-01-01T00:00:00Z" },
    { user_id: "a", waitlist_position: 1, created_at: "2026-01-03T00:00:00Z" },
    { user_id: "b", waitlist_position: 2, created_at: "2026-01-02T00:00:00Z" },
    { user_id: "d", waitlist_position: null, created_at: "2025-12-01T00:00:00Z" },
  ];

  it("sorts by waitlist_position ascending, then created_at", () => {
    const sorted = sortWaitlistCandidates(rows);
    expect(sorted.map((r) => r.user_id)).toEqual(["a", "b", "c", "d"]);
  });

  it("picks the first candidate in sort order", () => {
    expect(pickNextWaitlistCandidate(rows)?.user_id).toBe("a");
  });

  it("breaks ties on created_at when positions match", () => {
    const tied = [
      { user_id: "late", waitlist_position: 1, created_at: "2026-02-02T00:00:00Z" },
      { user_id: "early", waitlist_position: 1, created_at: "2026-02-01T00:00:00Z" },
    ];
    expect(pickNextWaitlistCandidate(tied)?.user_id).toBe("early");
  });
});
