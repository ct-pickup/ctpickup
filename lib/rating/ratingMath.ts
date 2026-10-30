/**
 * The rating formulas as pure functions. Used by scripts/dev/rating_sim.ts and by the tests that compare them with the SQL.
 * The SQL (settle_session and settle_session_v2) is the real engine; this file is its twin. Keep them in step:
 * the tests in __tests__/ratingMath.test.ts and __tests__/sql/ratingV2.sql.test.ts check that they agree.
 *
 * Scores are 0..100. Stars are not used here.
 */

export type RatingConfig = {
  // Field strength (compare a player with the average of the others in the game)
  field_gain_scale: number; // points above the field average over which gains shrink by a factor of e
  field_loss_amp: number; // most extra weight a loss gets when a stronger player does badly against a weaker field (0.5 = up to 1.5x)
  field_loss_scale: number; // points above the field average over which that extra weight builds up
  // Weight of one peer vote
  vote_score_ref: number; // a voter at this score weighs 1 before the other factors
  vote_w_min: number; // lowest score factor
  vote_w_max: number; // highest score factor
  vote_rel_ref: number; // reliability at or above this weighs 1
  vote_rel_min: number; // lowest reliability factor
  vote_new_sessions: number; // rated games before an account counts fully
  vote_new_floor: number; // weight of a brand new account
  // Same voter, same player, repeated
  pair_window_days: number;
  pair_decay: number; // each earlier game where this voter already named this player multiplies the weight by this
  pair_floor: number; // lowest the repeated-pair factor goes
  // Host score
  host_max_share: number; // the host score can move a player by at most this share of that game's k
  host_pair_days: number; // look-back for the same host and the same player
  host_pair_decay: number; // each earlier game with this host multiplies the host weight by this
  host_pair_floor: number;
  org_anchor: number; // 0 = host score read against the middle of the scale (today). 1 = read against the player's own score.
  // Distinct evidence for the top bands
  evidence_min_hosts: number;
  evidence_min_voters: number;
  evidence_min_games: number;
  evidence_cap_score: number; // without that evidence a score cannot go above this (a score already above it is held, not cut)
  // Results (only with rating_results on)
  result_scale: number; // logistic scale in points of team average difference
  result_k_share: number; // share of the game's k a result can move a player
  result_max_delta: number; // hard cap per game, in points
  result_min_attendance: number;
  result_max_team_diff: number; // teams may differ by at most this many players
  result_host_max_30d: number; // results one host entered that involve one player in 30 days; more than this are ignored
};

export const DEFAULT_CONFIG: RatingConfig = {
  field_gain_scale: 15,
  field_loss_amp: 0.5,
  field_loss_scale: 15,
  vote_score_ref: 50,
  vote_w_min: 0.5,
  vote_w_max: 1.5,
  vote_rel_ref: 90,
  vote_rel_min: 0.5,
  vote_new_sessions: 5,
  vote_new_floor: 0.4,
  pair_window_days: 30,
  pair_decay: 0.6,
  pair_floor: 0.1,
  host_max_share: 0.7,
  host_pair_days: 60,
  host_pair_decay: 0.75,
  host_pair_floor: 0.25,
  org_anchor: 0,
  evidence_min_hosts: 3,
  evidence_min_voters: 6,
  evidence_min_games: 8,
  evidence_cap_score: 89.9,
  result_scale: 12,
  result_k_share: 0.15,
  result_max_delta: 2,
  result_min_attendance: 8,
  result_max_team_diff: 1,
  result_host_max_30d: 6,
};

export const K_BASE = 16;
export const ORG_FLOOR = 0.45;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** numeric(5,2) rounding, as Postgres stores it (halves away from zero). */
export const round2 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;

export type Attendee = {
  id: string;
  score: number;
  sessions: number;
  reliability: number;
  /** 1..10, already filled with 5 when the host did not score. */
  organizerScore: number;
  /** v2 only: earlier settled games in the host window where this player attended under this same host. */
  hostPriorGames?: number;
  /** v2 only: evidence before this game. */
  prior?: { hosts: Set<string>; voters: Set<string>; games: number };
};

export type Vote = {
  voter: string;
  votee: string;
  /** v2 only: earlier games in the pair window where this voter already named this votee. */
  priorPairGames?: number;
};

export type TeamResult = {
  /** Team of each attended player who was assigned one. */
  teams: Record<string, "A" | "B" | "C">;
  /** null = draw. */
  winningTeam: "A" | "B" | "C" | null;
  /** Both teams confirmed it. */
  verified: boolean;
  /** Per player: results this host entered that involve the player in the last 30 days, including this one. */
  hostResultCount?: Record<string, number>;
};

export type Session = {
  organizerId: string;
  attendees: Attendee[];
  votes: Vote[];
  /** Voter facts for weighting. A voter missing here is treated as a new account. */
  voters?: Record<string, { score: number; sessions: number; reliability: number }>;
  result?: TeamResult | null;
};

export type Outcome = {
  id: string;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  k: number;
  votes: number;
  weightedVotes: number;
  expected: number;
  fieldAvg: number;
  fieldFactor: number;
  hostWeight: number;
  resultSignal: number | null;
  deltaResult: number;
  capped: boolean;
  /** v2: the player has the distinct hosts, voters and games the top bands need. */
  evidenceOk: boolean;
};

const kFor = (sessions: number, kBase: number) => kBase * (0.35 + 0.65 * Math.exp(-sessions / 6));
const wOrgFor = (sessions: number, orgFloor: number) => orgFloor + (0.95 - orgFloor) * Math.exp(-sessions / 5);

/** settle_session as it is today. Rounds like the SQL (delta and score to 2 decimals). */
export function settleV1(s: Session, kBase = K_BASE, orgFloor = ORG_FLOOR): Outcome[] {
  const n = s.attendees.length;
  if (n < 4) throw new Error("Not enough attendees to rate");
  const totalVotes = s.votes.length;
  const voters = new Set(s.votes.map((v) => v.voter)).size;
  const thin = voters / n < 0.6;
  const expected = Math.max(totalVotes / n, 0.5);
  return s.attendees.map((a) => {
    const votes = s.votes.filter((v) => v.votee === a.id).length;
    const voteSignal = clamp((votes - expected) / expected, -1, 1);
    const orgSignal = clamp((a.organizerScore - 5.5) / 4.5, -1, 1);
    const wOrg = thin ? 1.0 : wOrgFor(a.sessions, orgFloor);
    const k = kFor(a.sessions, kBase);
    const delta = k * (wOrg * orgSignal + (1 - wOrg) * voteSignal);
    const after = round2(clamp(a.score + delta, 0, 100));
    return {
      id: a.id, scoreBefore: a.score, scoreAfter: after, delta: round2(delta), k, votes, weightedVotes: votes, expected,
      fieldAvg: NaN, fieldFactor: 1, hostWeight: wOrg, resultSignal: null, deltaResult: 0, capped: false, evidenceOk: true,
    };
  });
}

export function voterWeight(v: { score: number; sessions: number; reliability: number }, priorPairGames: number, c: RatingConfig): number {
  const scoreF = clamp(v.score / c.vote_score_ref, c.vote_w_min, c.vote_w_max);
  const relF = clamp(v.reliability / c.vote_rel_ref, c.vote_rel_min, 1);
  const newF = c.vote_new_floor + (1 - c.vote_new_floor) * Math.min(1, v.sessions / c.vote_new_sessions);
  const pairF = Math.max(c.pair_floor, Math.pow(c.pair_decay, priorPairGames));
  return scoreF * relF * newF * pairF;
}

export function fieldFactor(delta: number, gap: number, c: RatingConfig): number {
  const above = Math.max(gap, 0);
  return delta >= 0 ? Math.exp(-above / c.field_gain_scale) : 1 + c.field_loss_amp * (1 - Math.exp(-above / c.field_loss_scale));
}

/** Expected result of team X against team Y, in [0,1], from the difference of their average scores. */
export function expectedResult(avgX: number, avgY: number, scale: number): number {
  return 1 / (1 + Math.exp(-(avgX - avgY) / scale));
}

/**
 * Per player result signal (actual minus expected), or null when the result does not count.
 * Does not count: not verified, not exactly two teams (A and B), too few players, uneven teams, or the host entered too many results for the player.
 */
export function resultSignals(s: Session, c: RatingConfig): Record<string, number> {
  const out: Record<string, number> = {};
  const r = s.result;
  if (!r || !r.verified) return out;
  const rated = s.attendees.filter((a) => r.teams[a.id] === "A" || r.teams[a.id] === "B");
  if (s.attendees.length < c.result_min_attendance) return out;
  if (s.attendees.some((a) => r.teams[a.id] === "C")) return out;
  const A = rated.filter((a) => r.teams[a.id] === "A");
  const B = rated.filter((a) => r.teams[a.id] === "B");
  if (!A.length || !B.length || Math.abs(A.length - B.length) > c.result_max_team_diff) return out;
  const avg = (xs: Attendee[]) => xs.reduce((t, x) => t + x.score, 0) / xs.length;
  const eA = expectedResult(avg(A), avg(B), c.result_scale);
  const actualA = r.winningTeam == null ? 0.5 : r.winningTeam === "A" ? 1 : 0;
  for (const a of A) out[a.id] = actualA - eA;
  for (const a of B) out[a.id] = 1 - actualA - (1 - eA);
  for (const id of Object.keys(out)) if ((r.hostResultCount?.[id] ?? 0) > c.result_host_max_30d) delete out[id];
  return out;
}

/** settle_session_v2 without results: field strength, weighted votes, host limits, collusion damping, evidence cap. */
export function settleV2Base(s: Session, c: RatingConfig = DEFAULT_CONFIG, kBase = K_BASE, orgFloor = ORG_FLOOR): Outcome[] {
  const n = s.attendees.length;
  if (n < 4) throw new Error("Not enough attendees to rate");
  const thin = new Set(s.votes.map((v) => v.voter)).size / n < 0.6;
  const w = s.votes.map((v) => voterWeight(s.voters?.[v.voter] ?? { score: 50, sessions: 0, reliability: 92 }, v.priorPairGames ?? 0, c));
  const totalW = w.reduce((t, x) => t + x, 0);
  const meanW = s.votes.length ? totalW / s.votes.length : 1;
  const expected = Math.max(totalW / n, 0.5 * meanW);
  const totalScore = s.attendees.reduce((t, a) => t + a.score, 0);
  return s.attendees.map((a) => {
    const received = s.votes.reduce((t, v, i) => (v.votee === a.id ? t + w[i]! : t), 0);
    const count = s.votes.filter((v) => v.votee === a.id).length;
    const voteSignal = clamp((received - expected) / expected, -1, 1);
    const isHost = a.id === s.organizerId;
    const mid = (1 - c.org_anchor) * 5.5 + c.org_anchor * (1 + (9 * a.score) / 100);
    const orgSignal = isHost ? 0 : clamp((a.organizerScore - mid) / 4.5, -1, 1);
    const hostF = Math.max(c.host_pair_floor, Math.pow(c.host_pair_decay, a.hostPriorGames ?? 0));
    const wEff = (thin ? 1.0 : wOrgFor(a.sessions, orgFloor)) * hostF;
    const hostPart = clamp(wEff * orgSignal, -c.host_max_share, c.host_max_share);
    const votePart = thin ? 0 : (1 - wEff) * voteSignal;
    const raw = hostPart + votePart;
    const k = kFor(a.sessions, kBase);
    const fieldAvg = (totalScore - a.score) / (n - 1);
    const ff = fieldFactor(raw, a.score - fieldAvg, c);
    const delta = k * raw * ff;
    let after = clamp(a.score + delta, 0, 100);
    let capped = false;
    let evidenceOk = true;
    if (a.prior) {
      const hosts = new Set(a.prior.hosts);
      if (s.organizerId !== a.id) hosts.add(s.organizerId);
      const voters = new Set(a.prior.voters);
      for (const v of s.votes) if (v.votee === a.id) voters.add(v.voter);
      const enough = hosts.size >= c.evidence_min_hosts && voters.size >= c.evidence_min_voters && a.prior.games + 1 >= c.evidence_min_games;
      evidenceOk = enough;
      const ceiling = Math.max(a.score, c.evidence_cap_score);
      if (!enough && after > ceiling) {
        after = ceiling;
        capped = true;
      }
    }
    return {
      id: a.id, scoreBefore: a.score, scoreAfter: round2(after), delta: round2(after - a.score), k, votes: count, weightedVotes: received, expected,
      fieldAvg, fieldFactor: ff, hostWeight: wEff, resultSignal: null, deltaResult: 0, capped, evidenceOk,
    };
  });
}

/**
 * The result step (rating_results). Runs after the game is settled, from the settled scores, and moves each player by a small, hard-capped
 * amount. The same evidence ceiling applies. Players with no counting result are left as they are.
 */
export function applyResults(s: Session, base: Outcome[], c: RatingConfig = DEFAULT_CONFIG): Outcome[] {
  const sig = resultSignals(s, c);
  return base.map((o) => {
    const rs = sig[o.id];
    if (rs === undefined) return o;
    const deltaResult = round2(clamp(c.result_k_share * o.k * rs, -c.result_max_delta, c.result_max_delta));
    let after = clamp(o.scoreAfter + deltaResult, 0, 100);
    const ceiling = Math.max(o.scoreAfter, c.evidence_cap_score);
    if (!o.evidenceOk && after > ceiling) after = ceiling;
    after = round2(after);
    return { ...o, scoreAfter: after, delta: round2(after - o.scoreBefore), resultSignal: rs, deltaResult: round2(after - o.scoreAfter) };
  });
}

/** settle_session_v2. withResults is the rating_results flag. */
export function settleV2(s: Session, c: RatingConfig = DEFAULT_CONFIG, withResults = false, kBase = K_BASE, orgFloor = ORG_FLOOR): Outcome[] {
  const base = settleV2Base(s, c, kBase, orgFloor);
  return withResults ? applyResults(s, base, c) : base;
}
