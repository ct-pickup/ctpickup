import { describe, expect, it } from "vitest";

import { adminPrizeList, excludedStaffEntrants, rankEligibleEntrants, type SeasonEntrantStats } from "@/lib/season/prizeRanking";

function e(id: string, over: Partial<SeasonEntrantStats> = {}): SeasonEntrantStats {
  return { user_id: id, points: 100, wins: 5, potd: 1, games: 12, accepted_at: "2026-09-02T12:00:00Z", disqualified: false, ...over };
}

describe("tie-break order: points, wins, Player of the Day, earliest entry", () => {
  it("ranks by points first", () => {
    const r = rankEligibleEntrants([e("a", { points: 90 }), e("b", { points: 120 }), e("c", { points: 100 })]);
    expect(r.map((x) => x.user_id)).toEqual(["b", "c", "a"]);
  });

  it("breaks a points tie by wins", () => {
    const r = rankEligibleEntrants([e("a", { wins: 4, potd: 9 }), e("b", { wins: 6, potd: 0 })]);
    expect(r[0]?.user_id).toBe("b");
  });

  it("then by Player of the Day awards", () => {
    const r = rankEligibleEntrants([e("a", { potd: 1, accepted_at: "2026-09-01T00:00:00Z" }), e("b", { potd: 3 })]);
    expect(r[0]?.user_id).toBe("b");
  });

  it("then by earliest season entry", () => {
    const r = rankEligibleEntrants([e("late", { accepted_at: "2026-09-20T00:00:00Z" }), e("early", { accepted_at: "2026-09-03T00:00:00Z" })]);
    expect(r.map((x) => x.user_id)).toEqual(["early", "late"]);
  });
});

describe("one winner", () => {
  it("marks only the first eligible entrant as the winner", () => {
    const r = rankEligibleEntrants([e("a", { points: 50 }), e("b", { points: 80 })]);
    expect(r.filter((x) => x.is_winner).map((x) => x.user_id)).toEqual(["b"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
  });

  it("skips a disqualified winner and moves to the next eligible player", () => {
    const r = rankEligibleEntrants([e("a", { points: 200, disqualified: true }), e("b", { points: 80 }), e("c", { points: 70 })]);
    expect(r[0]).toMatchObject({ user_id: "b", is_winner: true, rank: 1 });
  });

  it("leaves out players under the game minimum and banned players", () => {
    const r = rankEligibleEntrants([e("few", { points: 500, games: 9 }), e("banned", { points: 400, in_good_standing: false }), e("ok", { points: 10 })]);
    expect(r.map((x) => x.user_id)).toEqual(["ok"]);
  });

  it("lists at most 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => e(`p${String(i).padStart(2, "0")}`, { points: 100 - i }));
    expect(adminPrizeList(many)).toHaveLength(10);
  });

  it("has no winner with no eligible entrants", () => {
    expect(adminPrizeList([e("a", { games: 2 })])).toEqual([]);
  });
});

describe("staff and admin accounts", () => {
  it("never rank, even with the most points, and the win goes to the next player", () => {
    const r = rankEligibleEntrants([e("admin", { points: 999, is_staff: true }), e("a", { points: 80 }), e("b", { points: 70 })]);
    expect(r.map((x) => x.user_id)).toEqual(["a", "b"]);
    expect(r[0]).toMatchObject({ user_id: "a", is_winner: true });
    expect(adminPrizeList([e("admin", { points: 999, is_staff: true }), e("a")]).map((x) => x.user_id)).toEqual(["a"]);
  });

  it("are listed as excluded instead of vanishing, most points first", () => {
    const list = [e("s1", { points: 10, is_staff: true }), e("s2", { points: 50, is_staff: true, games: 2 }), e("a")];
    expect(excludedStaffEntrants(list).map((x) => x.user_id)).toEqual(["s2", "s1"]);
  });

  it("leave the game minimum and other rules alone", () => {
    expect(rankEligibleEntrants([e("few", { games: 9 }), e("ok", { games: 10 })]).map((x) => x.user_id)).toEqual(["ok"]);
  });
});
