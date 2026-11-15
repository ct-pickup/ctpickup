import { describe, expect, it } from "vitest";
import {
  matchStatus,
  planAdvancement,
  projectKnockout,
  upcomingSlots,
  validateScoreEntry,
  wonOnPenalties,
  type AdvancementPlan,
  type BracketMatch,
} from "../../lib/tournament/bracketLogic";

const m = (o: Partial<BracketMatch> & { id: string; stage: string; match_number: number }): BracketMatch => ({
  group_name: null,
  team_a_id: null,
  team_b_id: null,
  score_a: null,
  score_b: null,
  winner_id: null,
  is_bye: false,
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  ...o,
});

const done = (o: Parameters<typeof m>[0], a: number, b: number, winner: string): BracketMatch =>
  m({ ...o, score_a: a, score_b: b, winner_id: winner, completed_at: "2026-11-14T15:00:00Z" });

/** Applies a plan the way the server does, so a second plan can be computed from the result. */
function apply(matches: BracketMatch[], plan: AdvancementPlan): BracketMatch[] {
  let out = matches.filter((x) => !plan.deletes.includes(x.id));
  out = out.map((x) => {
    const u = plan.updates.find((p) => p.id === x.id);
    if (!u) return x;
    const base = { ...x, team_a_id: u.team_a_id, team_b_id: u.team_b_id, is_bye: u.is_bye };
    if (u.is_bye) return { ...base, winner_id: u.team_a_id, score_a: null, score_b: null, completed_at: "bye" };
    return u.reset ? { ...base, winner_id: null, score_a: null, score_b: null, completed_at: null, started_at: null } : base;
  });
  for (const c of plan.creates) {
    out.push(
      m({
        id: `${c.stage}-${c.match_number}`,
        stage: c.stage,
        match_number: c.match_number,
        team_a_id: c.team_a_id,
        team_b_id: c.team_b_id,
        is_bye: c.is_bye,
        winner_id: c.is_bye ? c.team_a_id : null,
        completed_at: c.is_bye ? "bye" : null,
      }),
    );
  }
  return out;
}

describe("score entry", () => {
  const ko = { stage: "sf", team_a_id: "A", team_b_id: "B" };
  it("a level knockout match needs the penalty winner", () => {
    const r = validateScoreEntry({ ...ko, score_a: 1, score_b: 1 });
    expect(r).toMatchObject({ ok: false, code: "penalty_winner_required" });
    expect((r as { error: string }).error).toMatch(/penalties/i);
  });
  it("stores the named winner and marks it as won on penalties", () => {
    expect(validateScoreEntry({ ...ko, score_a: 2, score_b: 2, winner_id: "B" })).toEqual({
      ok: true,
      score_a: 2,
      score_b: 2,
      winner_id: "B",
      won_on_penalties: true,
    });
  });
  it("the penalty winner must be one of the two teams", () => {
    expect(validateScoreEntry({ ...ko, score_a: 0, score_b: 0, winner_id: "Z" })).toMatchObject({ ok: false, code: "winner_not_in_match" });
  });
  it("an unlevel knockout score decides the winner and a different winner is refused", () => {
    expect(validateScoreEntry({ ...ko, score_a: 3, score_b: 1 })).toMatchObject({ ok: true, winner_id: "A", won_on_penalties: false });
    expect(validateScoreEntry({ ...ko, score_a: 3, score_b: 1, winner_id: "B" })).toMatchObject({ ok: false, code: "winner_mismatch" });
  });
  it("group matches may end level with no winner", () => {
    expect(validateScoreEntry({ stage: "group", team_a_id: "A", team_b_id: "B", score_a: 2, score_b: 2 })).toEqual({
      ok: true,
      score_a: 2,
      score_b: 2,
      winner_id: null,
      won_on_penalties: false,
    });
  });
  it("rejects bad scores and matches that cannot be scored", () => {
    for (const bad of [-1, 100, 1.5, "x", null, undefined]) {
      expect(validateScoreEntry({ ...ko, score_a: bad, score_b: 1 })).toMatchObject({ ok: false, code: "bad_score" });
    }
    expect(validateScoreEntry({ stage: "group", team_a_id: "A", team_b_id: null, score_a: 1, score_b: 0 })).toMatchObject({ ok: false, code: "bad_match" });
    expect(validateScoreEntry({ ...ko, is_bye: true, score_a: 1, score_b: 0 })).toMatchObject({ ok: false, code: "bad_match" });
  });
  it("accepts numeric strings from a form", () => {
    expect(validateScoreEntry({ stage: "group", team_a_id: "A", team_b_id: "B", score_a: "2", score_b: " 1 " })).toMatchObject({ ok: true, winner_id: "A" });
  });
});

describe("how a match reads", () => {
  it("scheduled, in progress, final and bye", () => {
    expect(matchStatus({ is_bye: false, started_at: null, completed_at: null })).toBe("scheduled");
    expect(matchStatus({ is_bye: false, started_at: "t", completed_at: null })).toBe("in_progress");
    expect(matchStatus({ is_bye: false, started_at: "t", completed_at: "t" })).toBe("final");
    expect(matchStatus({ is_bye: true, started_at: null, completed_at: null })).toBe("bye");
  });
  it("won on penalties only for a finished level knockout match with a winner", () => {
    const base = { stage: "sf", score_a: 1, score_b: 1, winner_id: "A", completed_at: "t", is_bye: false };
    expect(wonOnPenalties(base)).toBe(true);
    expect(wonOnPenalties({ ...base, stage: "group" })).toBe(false);
    expect(wonOnPenalties({ ...base, score_b: 0 })).toBe(false);
    expect(wonOnPenalties({ ...base, completed_at: null })).toBe(false);
    expect(wonOnPenalties({ ...base, winner_id: null })).toBe(false);
  });
});

describe("knockout advancement: two semi-finals into a final", () => {
  const sf1 = { id: "sf1", stage: "sf", match_number: 1000, team_a_id: "A", team_b_id: "B" };
  const sf2 = { id: "sf2", stage: "sf", match_number: 1001, team_a_id: "C", team_b_id: "D" };

  it("nothing to do before any result", () => {
    const plan = planAdvancement([m(sf1), m(sf2)]);
    expect(plan).toEqual({ creates: [], updates: [], deletes: [], destructive: [] });
  });

  it("one finished semi-final shows its winner in the final slot but creates no row yet", () => {
    const matches = [done(sf1, 2, 1, "A"), m(sf2)];
    expect(planAdvancement(matches).creates).toEqual([]);
    const slots = upcomingSlots(matches);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ stage: "final", team_a_id: "A", team_b_id: null, label_b: "Winner of Semi-final 2" });
  });

  it("both finished: the winners meet in the final, penalties included", () => {
    const matches = [done(sf1, 2, 1, "A"), done(sf2, 1, 1, "D")];
    const plan = planAdvancement(matches);
    expect(plan.creates).toEqual([{ stage: "final", match_number: 3000, team_a_id: "A", team_b_id: "D", is_bye: false }]);
    expect(plan.destructive).toEqual([]);
    expect(planAdvancement(apply(matches, plan))).toEqual({ creates: [], updates: [], deletes: [], destructive: [] });
  });

  it("editing a semi-final so the other team wins rewrites the final; nothing is lost while it is unplayed", () => {
    const first = apply([done(sf1, 2, 1, "A"), done(sf2, 3, 0, "C")], planAdvancement([done(sf1, 2, 1, "A"), done(sf2, 3, 0, "C")]));
    const edited = first.map((x) => (x.id === "sf1" ? done(sf1, 0, 1, "B") : x));
    const plan = planAdvancement(edited);
    expect(plan.updates).toEqual([{ id: "final-3000", team_a_id: "B", team_b_id: "C", is_bye: false, reset: false }]);
    expect(plan.destructive).toEqual([]);
  });

  it("editing a semi-final after the final was played flags the final as destructive and resets it", () => {
    const first = apply([done(sf1, 2, 1, "A"), done(sf2, 3, 0, "C")], planAdvancement([done(sf1, 2, 1, "A"), done(sf2, 3, 0, "C")]));
    const played = first.map((x) => (x.id === "final-3000" ? done({ id: "final-3000", stage: "final", match_number: 3000, team_a_id: "A", team_b_id: "C" }, 1, 0, "A") : x));
    const edited = played.map((x) => (x.id === "sf1" ? done(sf1, 0, 1, "B") : x));
    const plan = planAdvancement(edited);
    expect(plan.updates).toEqual([{ id: "final-3000", team_a_id: "B", team_b_id: "C", is_bye: false, reset: true }]);
    expect(plan.destructive).toEqual([{ id: "final-3000", stage: "final", match_number: 3000 }]);
    // Same winner re-saved with a different score changes nothing downstream.
    const sameWinner = played.map((x) => (x.id === "sf1" ? done(sf1, 5, 0, "A") : x));
    expect(planAdvancement(sameWinner)).toEqual({ creates: [], updates: [], deletes: [], destructive: [] });
  });

  it("clearing a semi-final result removes the final built from it", () => {
    const first = apply([done(sf1, 2, 1, "A"), done(sf2, 3, 0, "C")], planAdvancement([done(sf1, 2, 1, "A"), done(sf2, 3, 0, "C")]));
    const cleared = first.map((x) => (x.id === "sf2" ? m(sf2) : x));
    expect(planAdvancement(cleared).deletes).toEqual(["final-3000"]);
  });

  it("a finished knockout match with no winner stored does not advance anyone", () => {
    const stuck = m({ ...sf1, score_a: 1, score_b: 1, completed_at: "t", winner_id: null });
    expect(planAdvancement([stuck, done(sf2, 1, 0, "C")]).creates).toEqual([]);
  });
});

describe("knockout advancement: quarter-finals", () => {
  const q = (n: number, a: string, b: string) => ({ id: `q${n}`, stage: "qf", match_number: 1000 + n - 1, team_a_id: a, team_b_id: b });

  it("four quarter-finals feed two semi-finals and then a final", () => {
    let matches = [done(q(1, "A", "B"), 1, 0, "A"), done(q(2, "C", "D"), 0, 2, "D"), done(q(3, "E", "F"), 3, 1, "E"), done(q(4, "G", "H"), 1, 2, "H")];
    matches = apply(matches, planAdvancement(matches));
    expect(matches.filter((x) => x.stage === "sf").map((x) => [x.match_number, x.team_a_id, x.team_b_id])).toEqual([
      [2000, "A", "D"],
      [2001, "E", "H"],
    ]);
    matches = matches.map((x) => (x.stage === "sf" && x.match_number === 2000 ? done({ id: x.id, stage: "sf", match_number: 2000, team_a_id: "A", team_b_id: "D" }, 2, 0, "A") : x));
    matches = matches.map((x) => (x.stage === "sf" && x.match_number === 2001 ? done({ id: x.id, stage: "sf", match_number: 2001, team_a_id: "E", team_b_id: "H" }, 1, 1, "H") : x));
    matches = apply(matches, planAdvancement(matches));
    const final = matches.find((x) => x.stage === "final");
    expect([final?.team_a_id, final?.team_b_id]).toEqual(["A", "H"]);
  });

  it("three quarter-finals (three groups): the odd team gets a bye into the final", () => {
    let matches = [done(q(1, "A", "B"), 1, 0, "A"), done(q(2, "C", "D"), 0, 2, "D"), done(q(3, "E", "F"), 3, 1, "E")];
    matches = apply(matches, planAdvancement(matches));
    const sf = matches.filter((x) => x.stage === "sf").sort((a, b) => a.match_number - b.match_number);
    expect(sf.map((x) => [x.team_a_id, x.team_b_id, x.is_bye])).toEqual([
      ["A", "D", false],
      ["E", null, true],
    ]);
    expect(sf[1]!.winner_id).toBe("E");
    // Once the real semi-final is played the final is A or D against E.
    matches = matches.map((x) => (x.id === sf[0]!.id ? done({ id: x.id, stage: "sf", match_number: 2000, team_a_id: "A", team_b_id: "D" }, 0, 0, "D") : x));
    matches = apply(matches, planAdvancement(matches));
    const final = matches.find((x) => x.stage === "final");
    expect([final?.team_a_id, final?.team_b_id]).toEqual(["D", "E"]);
  });

  it("the projection lists every round so the screen can show what is still to fill in", () => {
    const rounds = projectKnockout([m(q(1, "A", "B")), m(q(2, "C", "D"))]);
    expect(rounds.map((r) => [r.stage, r.slots.length])).toEqual([
      ["qf", 2],
      ["sf", 1],
    ]);
    expect(upcomingSlots([m(q(1, "A", "B")), m(q(2, "C", "D"))])[0]).toMatchObject({ label_a: "Winner of Quarter-final 1", label_b: "Winner of Quarter-final 2" });
  });
});
