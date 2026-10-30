import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG, applyResults, expectedResult, resultSignals, settleV1, settleV2, settleV2Base, voterWeight,
  type Attendee, type Session, type Vote,
} from "../lib/rating/ratingMath";

const mk = (id: string, score = 50, over: Partial<Attendee> = {}): Attendee => ({ id, score, sessions: 5, reliability: 92, organizerScore: 5, hostPriorGames: 0, prior: { hosts: new Set(["x", "y", "z"]), voters: new Set("abcdefg".split("")), games: 20 }, ...over });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
/** Everyone votes for the same three players. */
const ballot = (voters: string[], picks: string[], prior = 0): Vote[] => voters.flatMap((v) => picks.filter((p) => p !== v).slice(0, 3).map((p) => ({ voter: v, votee: p, priorPairGames: prior })));
const session = (attendees: Attendee[], votes: Vote[], extra: Partial<Session> = {}): Session => ({ organizerId: "host", attendees, votes, ...extra });
const by = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)!;

describe("v1 (today)", () => {
  it("is the old formula: a top-voted, top-scored new player gains the whole k", () => {
    const att = ids(6).map((id) => mk(id, 50, { sessions: 0, organizerScore: id === "p0" ? 10 : 5 }));
    const out = settleV1(session(att, ballot(ids(6), ["p0", "p1", "p2"])));
    expect(by(out, "p0").delta).toBeCloseTo(16 * (0.95 * 1 + 0.05 * 1), 1); // k=16, org_signal 1, vote_signal 1, w_org .95
  });
  it("thin turnout gives the host everything", () => {
    const att = ids(10).map((id) => mk(id, 50, { organizerScore: 10 }));
    const out = settleV1(session(att, ballot(["p0", "p1"], ["p2", "p3", "p4"])));
    expect(by(out, "p5").hostWeight).toBe(1);
  });
  it("needs four attendees", () => {
    expect(() => settleV1(session(ids(3).map((i) => mk(i)), []))).toThrow();
  });
});

describe("expectation-based signals", () => {
  /** Eight players: `star` and seven others at `field`. Everyone votes for the same three, the host scores everyone `os`, star gets `starOs`. */
  const room = (starScore: number, field: number, o: { starOs: number; othersOs?: number; picks?: string[]; cfg?: Partial<typeof DEFAULT_CONFIG> }) => {
    const att = [mk("star", starScore, { organizerScore: o.starOs, sessions: 0 }), ...ids(7).map((i) => mk(i, field, { organizerScore: o.othersOs ?? 5, sessions: 0 }))];
    return by(settleV2Base(session(att, ballot(ids(7), o.picks ?? ["p0", "p1", "p2"])), { ...DEFAULT_CONFIG, ...o.cfg }), "star");
  };
  it("expected votes add up to the votes cast, and a stronger player is expected to draw more", () => {
    const att = [mk("star", 80), mk("mid", 50), mk("low", 20), ...ids(5).map((i) => mk(i, 50))];
    const out = settleV2Base(session(att, ballot(ids(5), ["p0", "p1", "p2"])));
    const totalExpected = out.reduce((t, o) => t + o.expected, 0);
    const totalReceived = out.reduce((t, o) => t + o.weightedVotes, 0);
    expect(totalExpected).toBeCloseTo(totalReceived, 6);
    expect(by(out, "star").expected).toBeGreaterThan(by(out, "mid").expected);
    expect(by(out, "mid").expected).toBeGreaterThan(by(out, "low").expected);
  });
  it("a player far above the field who does what is expected gains nothing", () => {
    // Draws exactly the votes the formula expects and is scored exactly as expected: the change is about zero.
    const att = [mk("star", 80, { organizerScore: 7.5 }), ...ids(7).map((i) => mk(i, 40, { organizerScore: 5 }))];
    const probe = settleV2Base(session(att, []));
    const expectedHost = by(probe, "star").expectedHost!;
    const exact = [mk("star", 80, { organizerScore: expectedHost }), ...ids(7).map((i) => mk(i, 40, { organizerScore: 5 }))];
    const out = by(settleV2Base(session(exact, [])), "star"); // nobody voted: thin turnout, host part only
    expect(Math.abs(out.delta)).toBeLessThan(0.05);
  });
  it("the same player gains when the weak field is beaten by more than expected, and loses when they fall short", () => {
    const better = room(80, 40, { starOs: 10 });
    const worse = room(80, 40, { starOs: 3 });
    expect(better.delta).toBeGreaterThan(0);
    expect(worse.delta).toBeLessThan(0);
    // and a strong player drawing the same raw host score gains less than an average player would
    const atField = room(40, 40, { starOs: 7 });
    const aboveField = room(80, 40, { starOs: 7 });
    expect(aboveField.delta).toBeLessThan(atField.delta);
  });
  it("a weak player who beats expectation gains, one who does what is expected does not", () => {
    expect(room(20, 60, { starOs: 7 }).delta).toBeGreaterThan(0);
    const probe = room(20, 60, { starOs: 5, picks: [] }); // nobody voted: the host score alone decides
    expect(room(20, 60, { starOs: probe.expectedHost!, picks: [] }).delta).toBeCloseTo(0, 1);
  });
  it("a host who gives everyone the same high score moves nobody much", () => {
    const att = ids(8).map((i) => mk(i, 50, { organizerScore: 10, sessions: 0 }));
    for (const o of settleV2Base(session(att, []))) expect(Math.abs(o.delta)).toBeLessThan(0.05);
  });
  it("host_abs_weight 1 reads the host score against the player's own rating instead", () => {
    const att = ids(8).map((i) => mk(i, 70, { organizerScore: 6.6, sessions: 0 })); // 1 + 9 * 0.7 = 7.3 expected from the rating alone
    const rel = settleV2Base(session(att, []))[0]!;
    const abs = settleV2Base(session(att, []), { ...DEFAULT_CONFIG, host_abs_weight: 1 })[0]!;
    expect(abs.expectedHost).toBeCloseTo(7.3, 6);
    expect(abs.delta).toBeLessThan(rel.delta);
  });
  it("there is no separate field strength factor any more", () => {
    expect(room(80, 30, { starOs: 9 }).fieldFactor).toBe(1);
    expect("field_gain_scale" in DEFAULT_CONFIG).toBe(false);
  });
});

describe("vote weights", () => {
  const strong = { score: 80, sessions: 20, reliability: 95 };
  it("a stronger, more reliable, established voter weighs more", () => {
    expect(voterWeight(strong, 0, DEFAULT_CONFIG)).toBeGreaterThan(voterWeight({ score: 50, sessions: 20, reliability: 95 }, 0, DEFAULT_CONFIG));
    expect(voterWeight({ ...strong, reliability: 50 }, 0, DEFAULT_CONFIG)).toBeLessThan(voterWeight(strong, 0, DEFAULT_CONFIG));
  });
  it("a new account weighs less and the weight rises with rated games", () => {
    const w = (sessions: number) => voterWeight({ score: 50, sessions, reliability: 92 }, 0, DEFAULT_CONFIG);
    expect(w(0)).toBeCloseTo(0.4 * (92 / 90 > 1 ? 1 : 92 / 90), 6);
    expect(w(0)).toBeLessThan(w(2));
    expect(w(2)).toBeLessThan(w(5));
    expect(w(5)).toBe(w(50));
  });
  it("is bounded: nobody weighs more than score max, nobody less than the floors multiply to", () => {
    expect(voterWeight({ score: 100, sessions: 99, reliability: 100 }, 0, DEFAULT_CONFIG)).toBeCloseTo(1.5, 6);
    expect(voterWeight({ score: 0, sessions: 0, reliability: 0 }, 99, DEFAULT_CONFIG)).toBeCloseTo(0.5 * 0.5 * 0.4 * 0.1, 6);
  });
  it("expected votes are recomputed from the weighted total", () => {
    const att = ids(8).map((i) => mk(i));
    const full = settleV2Base(session(att, ballot(ids(8), ["p0", "p1", "p2"])));
    const light = settleV2Base(session(att, ballot(ids(8), ["p0", "p1", "p2"]), { voters: Object.fromEntries(ids(8).map((i) => [i, { score: 50, sessions: 0, reliability: 50 }])) }));
    expect(light[0]!.expected).toBeLessThan(full[0]!.expected);
    expect(full[0]!.expected).toBeGreaterThan(0.5);
  });
});

describe("host limits and collusion damping", () => {
  it("a repeat host and player pairing counts less, down to the floor", () => {
    const run = (n: number) => by(settleV2Base(session([mk("a", 50, { organizerScore: 10, hostPriorGames: n }), ...ids(6).map((i) => mk(i))], ballot(ids(6), ["p0", "p1", "p2"]))), "a");
    expect(run(0).hostWeight).toBeGreaterThan(run(1).hostWeight);
    expect(run(1).hostWeight).toBeGreaterThan(run(3).hostWeight);
    expect(run(20).hostWeight).toBeCloseTo(0.25 * (0.45 + 0.5 * Math.exp(-1)), 3);
  });
  it("the host score alone can never move a player by more than 70% of k, even with thin turnout", () => {
    const att = [mk("a", 20, { organizerScore: 10, sessions: 0 }), ...ids(8).map((i) => mk(i, 20, { sessions: 0 }))];
    const o = by(settleV2Base(session(att, [])), "a"); // nobody voted: thin turnout, w_org = 1
    expect(o.delta).toBeLessThanOrEqual(0.7 * o.k + 0.01);
    expect(by(settleV1(session(att, [])), "a").delta).toBeCloseTo(o.k, 1); // today the host alone moves them the whole k
  });
  it("a host cannot score themselves up", () => {
    const att = [mk("host", 50, { organizerScore: 10 }), ...ids(6).map((i) => mk(i))];
    const o = by(settleV2Base(session(att, ballot(ids(6), ["p0", "p1", "p2"]))), "host");
    expect(o.hostWeight).toBeGreaterThan(0);
    expect(o.delta).toBeLessThanOrEqual(0); // no host part; no votes either
  });
  it("the same voter naming the same player again counts progressively less", () => {
    const run = (prior: number) => {
      const att = ids(8).map((i) => mk(i));
      return by(settleV2Base(session(att, ballot(ids(8), ["p0", "p1", "p2"], prior))), "p0");
    };
    // all pairs repeated: the weighted total falls, so expected falls too; look at one colluding pair instead
    const one = (prior: number) => {
      const att = ids(8).map((i) => mk(i));
      const votes = ballot(ids(8).slice(2), ["p3", "p4", "p5"]);
      votes.push({ voter: "p0", votee: "p6", priorPairGames: prior });
      return by(settleV2Base(session(att, votes)), "p6").weightedVotes;
    };
    expect(one(0)).toBeGreaterThan(one(1));
    expect(one(1)).toBeGreaterThan(one(3));
    expect(run(0).votes).toBe(run(5).votes);
  });
});

describe("distinct evidence", () => {
  // A new player rated 88 among equals, scored 10 by the host, named by nobody: a plain gain from the host score.
  const gameFor = (prior: Attendee["prior"], score = 88) => {
    const att = [mk("a", score, { organizerScore: 10, sessions: 0, prior, hostPriorGames: 0 }), ...ids(7).map((i) => mk(i, score))];
    return by(settleV2Base(session(att, ballot(ids(7), ["p0", "p1", "p2"]))), "a");
  };
  const enough = () => ({ hosts: new Set(["h1", "h2"]), voters: new Set("abcdef".split("")), games: 7 }); // the host of this game is the third, this game the 8th
  it("stops a score at the cap without enough distinct hosts, voters and games", () => {
    const o = gameFor({ hosts: new Set(["h1"]), voters: new Set(["v1"]), games: 2 });
    expect(o.scoreAfter).toBeCloseTo(89.9, 2);
    expect(o.capped).toBe(true);
    expect(o.evidenceOk).toBe(false);
  });
  it("lets it through with the evidence", () => {
    const o = gameFor(enough());
    expect(o.evidenceOk).toBe(true);
    expect(o.capped).toBe(false);
    expect(o.scoreAfter).toBeGreaterThan(89.9);
  });
  it("holds a score already above the cap instead of cutting it", () => {
    const o = gameFor({ hosts: new Set(["h1"]), voters: new Set(["v1"]), games: 2 }, 95);
    expect(o.scoreAfter).toBe(95); // a gain is held where it is; a loss would still count
  });
  it("each of the three conditions matters", () => {
    expect(gameFor(enough()).evidenceOk).toBe(true);
    expect(gameFor({ ...enough(), hosts: new Set(["h1"]) }).evidenceOk).toBe(false);
    expect(gameFor({ ...enough(), voters: new Set("abcde".split("")) }).evidenceOk).toBe(false);
    expect(gameFor({ ...enough(), games: 6 }).evidenceOk).toBe(false);
  });
  it("the player's own game as host does not count as a distinct host", () => {
    const att = [mk("host", 88, { organizerScore: 10, sessions: 0, prior: { hosts: new Set(["h1", "h2"]), voters: new Set("abcdef".split("")), games: 7 } }), ...ids(7).map((i) => mk(i, 88))];
    expect(by(settleV2Base(session(att, ballot(ids(7), ["p0", "p1", "p2"]))), "host").evidenceOk).toBe(false);
  });
});

describe("results", () => {
  const teams = (n: number) => Object.fromEntries(ids(n).map((id, i) => [id, i % 2 === 0 ? "A" : "B"])) as Record<string, "A" | "B">;
  const game = (scoresA: number, scoresB: number, winner: "A" | "B" | null, extra: Record<string, unknown> = {}) => {
    const att = ids(10).map((id, i) => mk(id, i % 2 === 0 ? scoresA : scoresB));
    return session(att, ballot(ids(10), ["p0", "p1", "p2"]), { result: { teams: teams(10), winningTeam: winner, verified: true, ...extra } });
  };
  it("expected result is 0.5 for equal teams and about 73% for a 12 point edge", () => {
    expect(expectedResult(50, 50, 12)).toBe(0.5);
    expect(expectedResult(62, 50, 12)).toBeCloseTo(0.731, 2);
  });
  it("beating an equal team is +0.5, losing is -0.5, a draw is 0", () => {
    const win = resultSignals(game(50, 50, "A"), DEFAULT_CONFIG);
    expect(win.p0).toBeCloseTo(0.5, 6);
    expect(win.p1).toBeCloseTo(-0.5, 6);
    expect(resultSignals(game(50, 50, null), DEFAULT_CONFIG).p0).toBeCloseTo(0, 6);
  });
  it("an upset counts more than an expected win", () => {
    const upset = resultSignals(game(40, 70, "A"), DEFAULT_CONFIG).p0!;
    const expected = resultSignals(game(70, 40, "A"), DEFAULT_CONFIG).p0!;
    expect(upset).toBeGreaterThan(0.9);
    expect(expected).toBeLessThan(0.1);
  });
  it("does not count unless verified, with too few players, uneven teams, or three teams", () => {
    expect(resultSignals(game(50, 50, "A", { verified: false }), DEFAULT_CONFIG)).toEqual({});
    const small = session(ids(6).map((id) => mk(id)), [], { result: { teams: teams(6), winningTeam: "A", verified: true } });
    expect(resultSignals(small, DEFAULT_CONFIG)).toEqual({});
    const uneven = { ...teams(10), p1: "A" as const, p3: "A" as const };
    expect(resultSignals(game(50, 50, "A", { teams: uneven }), DEFAULT_CONFIG)).toEqual({});
    expect(resultSignals(game(50, 50, "A", { teams: { ...teams(10), p0: "C" } }), DEFAULT_CONFIG)).toEqual({});
    expect(resultSignals({ ...game(50, 50, "A"), result: null }, DEFAULT_CONFIG)).toEqual({});
  });
  it("ignores a player when one host has entered too many results involving them", () => {
    const s = game(50, 50, "A", { hostResultCount: { p0: 7, p1: 6 } });
    const sig = resultSignals(s, DEFAULT_CONFIG);
    expect(sig.p0).toBeUndefined();
    expect(sig.p1).toBeDefined();
  });
  it("moves a player by at most 2 points and at most 15% of k, and does nothing without a result", () => {
    const s = game(50, 50, "A");
    const base = settleV2Base(s);
    const withR = applyResults(s, base);
    for (let i = 0; i < 10; i++) {
      expect(Math.abs(withR[i]!.deltaResult)).toBeLessThanOrEqual(2);
      expect(Math.abs(withR[i]!.deltaResult)).toBeLessThanOrEqual(0.15 * base[i]!.k + 0.01);
    }
    expect(applyResults({ ...s, result: null }, base)).toEqual(base);
    expect(settleV2(s, DEFAULT_CONFIG, false).map((o) => o.scoreAfter)).toEqual(base.map((o) => o.scoreAfter));
  });
  it("a hard cap holds even if k_share is raised", () => {
    const s = game(40, 70, "A");
    const out = applyResults(s, settleV2Base(s, { ...DEFAULT_CONFIG, result_k_share: 5 }), { ...DEFAULT_CONFIG, result_k_share: 5 });
    for (const o of out) expect(Math.abs(o.deltaResult)).toBeLessThanOrEqual(2);
  });
});
