/**
 * Outdoor tournament bracket rules as pure functions: what a score entry means, how a match reads (scheduled, in progress,
 * final), and how winners move through the knockout rounds. No database, no React, so the server routes and the tests share it.
 *
 * Knockout shape: rounds run qf, sf, final. The first knockout round is whatever generate_knockout created. Every later round is
 * derived: winners are paired in match order, and an odd one out gets a bye into the following round. A derived match only
 * exists as a row once both of its teams are known (or it is a bye), so no row ever has a missing first team.
 */

export const KNOCKOUT_STAGES = ["qf", "sf", "final"] as const;
export type KnockoutStage = (typeof KNOCKOUT_STAGES)[number];

export const STAGE_LABEL: Record<KnockoutStage, string> = { qf: "Quarter-final", sf: "Semi-final", final: "Final" };

/** Derived matches are numbered by stage so they never collide with each other or with group matches. */
const STAGE_BASE: Record<KnockoutStage, number> = { qf: 1000, sf: 2000, final: 3000 };

export const MAX_SCORE = 99;

export function isKnockoutStage(stage: unknown): stage is KnockoutStage {
  return stage === "qf" || stage === "sf" || stage === "final";
}

export function derivedMatchNumber(stage: KnockoutStage, slot: number): number {
  return STAGE_BASE[stage] + slot;
}

export type BracketMatch = {
  id: string;
  stage: string;
  group_name?: string | null;
  match_number: number;
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  is_bye?: boolean | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

// ---------------------------------------------------------------------------------------------------------------------------
// How a match reads
// ---------------------------------------------------------------------------------------------------------------------------

export type MatchStatus = "scheduled" | "in_progress" | "final" | "bye";

export function matchStatus(m: Pick<BracketMatch, "is_bye" | "completed_at" | "started_at">): MatchStatus {
  if (m.is_bye) return "bye";
  if (m.completed_at) return "final";
  if (m.started_at) return "in_progress";
  return "scheduled";
}

/** A finished knockout match whose scores are level: the stored winner took it on penalties. */
export function wonOnPenalties(m: Pick<BracketMatch, "stage" | "score_a" | "score_b" | "winner_id" | "completed_at" | "is_bye">): boolean {
  return (
    isKnockoutStage(m.stage) &&
    !m.is_bye &&
    m.completed_at != null &&
    m.winner_id != null &&
    m.score_a != null &&
    m.score_b != null &&
    m.score_a === m.score_b
  );
}

/** The team that moves on from a match, or null while it is undecided. Level knockout scores with no winner are undecided. */
export function winnerOf(m: Pick<BracketMatch, "is_bye" | "team_a_id" | "winner_id" | "completed_at">): string | null {
  if (m.is_bye) return m.team_a_id ?? null;
  return m.completed_at != null && m.winner_id != null ? m.winner_id : null;
}

function hasResult(m: Pick<BracketMatch, "is_bye" | "score_a" | "score_b" | "winner_id" | "completed_at">): boolean {
  if (m.is_bye) return false;
  return m.completed_at != null || m.score_a != null || m.score_b != null || m.winner_id != null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Score entry
// ---------------------------------------------------------------------------------------------------------------------------

export type ScoreEntryInput = {
  stage: string;
  team_a_id: string | null;
  team_b_id: string | null;
  is_bye?: boolean | null;
  score_a: unknown;
  score_b: unknown;
  /** Only read when a knockout match is level. */
  winner_id?: unknown;
};

export type ScoreEntryResult =
  | { ok: true; score_a: number; score_b: number; winner_id: string | null; won_on_penalties: boolean }
  | {
      ok: false;
      code: "bad_match" | "bad_score" | "penalty_winner_required" | "winner_not_in_match" | "winner_mismatch";
      error: string;
    };

function wholeScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_SCORE ? n : null;
}

/**
 * Group matches may end level. Knockout matches may not: when the score is level the admin names the winner (stored in
 * winner_id) and the match reads "won on penalties". When the score is not level the higher score wins and any winner sent
 * with it must agree.
 */
export function validateScoreEntry(input: ScoreEntryInput): ScoreEntryResult {
  if (input.is_bye || !input.team_a_id || !input.team_b_id) {
    return { ok: false, code: "bad_match", error: "This match has no second team yet, so it can't be scored." };
  }
  const a = wholeScore(input.score_a);
  const b = wholeScore(input.score_b);
  if (a == null || b == null) {
    return { ok: false, code: "bad_score", error: `Scores must be whole numbers from 0 to ${MAX_SCORE}.` };
  }
  const sent = typeof input.winner_id === "string" && input.winner_id.trim() ? input.winner_id.trim() : null;

  if (a !== b) {
    const winner = a > b ? input.team_a_id : input.team_b_id;
    if (sent && sent !== winner) {
      return { ok: false, code: "winner_mismatch", error: "The score decides the winner. Don't send a different one." };
    }
    return { ok: true, score_a: a, score_b: b, winner_id: winner, won_on_penalties: false };
  }

  if (!isKnockoutStage(input.stage)) {
    return { ok: true, score_a: a, score_b: b, winner_id: null, won_on_penalties: false };
  }
  if (!sent) {
    return { ok: false, code: "penalty_winner_required", error: "A knockout match can't end level. Pick the team that won on penalties." };
  }
  if (sent !== input.team_a_id && sent !== input.team_b_id) {
    return { ok: false, code: "winner_not_in_match", error: "The winner must be one of the two teams in this match." };
  }
  return { ok: true, score_a: a, score_b: b, winner_id: sent, won_on_penalties: true };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Knockout projection and advancement
// ---------------------------------------------------------------------------------------------------------------------------

export type KnockoutSlot = {
  stage: KnockoutStage;
  /** Position in the round, from 0. */
  slot: number;
  match_number: number;
  team_a_id: string | null;
  team_b_id: string | null;
  is_bye: boolean;
  /** Shown in place of a team that is not known yet, e.g. "Winner of Semi-final 1". */
  label_a: string | null;
  label_b: string | null;
  /** The stored row for this slot, when there is one. */
  match: BracketMatch | null;
  /** Who moves on from this slot, per the stored row (null while undecided or when the row no longer fits the teams). */
  winner: string | null;
  /** Both teams known (or a bye): the slot should be a row. */
  complete: boolean;
};

export type KnockoutRound = { stage: KnockoutStage; slots: KnockoutSlot[] };

function sameTeams(m: BracketMatch, a: string | null, b: string | null, bye: boolean): boolean {
  return (m.team_a_id ?? null) === a && (m.team_b_id ?? null) === b && Boolean(m.is_bye) === bye;
}

/** Every knockout round as slots, from the stored matches. Rounds after the first are derived from the winners before them. */
export function projectKnockout(matches: readonly BracketMatch[]): KnockoutRound[] {
  const ko = matches.filter((m) => isKnockoutStage(m.stage));
  if (!ko.length) return [];
  const firstRank = Math.min(...ko.map((m) => KNOCKOUT_STAGES.indexOf(m.stage as KnockoutStage)));
  const firstStage = KNOCKOUT_STAGES[firstRank]!;

  const first = ko
    .filter((m) => m.stage === firstStage)
    .sort((a, b) => a.match_number - b.match_number)
    .map<KnockoutSlot>((m, i) => ({
      stage: firstStage,
      slot: i,
      match_number: m.match_number,
      team_a_id: m.team_a_id ?? null,
      team_b_id: m.team_b_id ?? null,
      is_bye: Boolean(m.is_bye),
      label_a: null,
      label_b: null,
      match: m,
      winner: winnerOf(m),
      complete: true,
    }));

  const rounds: KnockoutRound[] = [{ stage: firstStage, slots: first }];

  for (let rank = firstRank + 1; rank < KNOCKOUT_STAGES.length; rank++) {
    const prev = rounds[rounds.length - 1]!;
    const n = prev.slots.length;
    if (n <= 1) break;
    const stage = KNOCKOUT_STAGES[rank]!;
    const count = Math.ceil(n / 2);
    if (stage === "final" && count !== 1) break;
    const existing = new Map(ko.filter((m) => m.stage === stage).map((m) => [m.match_number, m]));
    const prevLabel = STAGE_LABEL[prev.stage];
    const slots: KnockoutSlot[] = [];

    for (let k = 0; k < count; k++) {
      const left = prev.slots[2 * k]!;
      const right = prev.slots[2 * k + 1] ?? null;
      const bye = right == null;
      const a = left.winner;
      const b = right ? right.winner : null;
      const number = derivedMatchNumber(stage, k);
      const row = existing.get(number) ?? null;
      const complete = bye ? a != null : a != null && b != null;
      const fits = row != null && complete && sameTeams(row, a, b, bye);
      slots.push({
        stage,
        slot: k,
        match_number: number,
        team_a_id: a,
        team_b_id: b,
        is_bye: bye,
        label_a: a ? null : `Winner of ${prevLabel} ${2 * k + 1}`,
        label_b: bye ? null : b ? null : `Winner of ${prevLabel} ${2 * k + 2}`,
        match: row,
        winner: bye ? a : fits && row ? winnerOf(row) : null,
        complete,
      });
    }
    rounds.push({ stage, slots });
  }
  return rounds;
}

export type PlannedCreate = { stage: KnockoutStage; match_number: number; team_a_id: string; team_b_id: string | null; is_bye: boolean };
export type PlannedUpdate = { id: string; team_a_id: string; team_b_id: string | null; is_bye: boolean; reset: boolean };
export type AdvancementPlan = {
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  deletes: string[];
  /** Rows with a recorded result that this plan would wipe (a reset or a delete). The caller asks before doing that. */
  destructive: { id: string; stage: string; match_number: number }[];
};

/**
 * What to write so the later rounds match the winners of the rounds before them. Idempotent: running it on a bracket that is
 * already consistent gives an empty plan. Editing a result that changes who advances rewrites or removes the later matches that
 * depended on it, and lists the ones that already had a result in `destructive`.
 */
export function planAdvancement(matches: readonly BracketMatch[]): AdvancementPlan {
  const plan: AdvancementPlan = { creates: [], updates: [], deletes: [], destructive: [] };
  const rounds = projectKnockout(matches);
  for (const round of rounds.slice(1)) {
    for (const s of round.slots) {
      const row = s.match;
      if (s.complete && s.team_a_id) {
        if (!row) {
          plan.creates.push({ stage: s.stage, match_number: s.match_number, team_a_id: s.team_a_id, team_b_id: s.team_b_id, is_bye: s.is_bye });
        } else if (!sameTeams(row, s.team_a_id, s.team_b_id, s.is_bye)) {
          const reset = hasResult(row);
          plan.updates.push({ id: row.id, team_a_id: s.team_a_id, team_b_id: s.team_b_id, is_bye: s.is_bye, reset });
          if (reset) plan.destructive.push({ id: row.id, stage: row.stage, match_number: row.match_number });
        }
      } else if (row) {
        plan.deletes.push(row.id);
        if (hasResult(row)) plan.destructive.push({ id: row.id, stage: row.stage, match_number: row.match_number });
      }
    }
  }
  return plan;
}

/** Rounds after the first that have no stored row yet, for the "next round fills in" placeholders. */
export function upcomingSlots(matches: readonly BracketMatch[]): KnockoutSlot[] {
  return projectKnockout(matches)
    .slice(1)
    .flatMap((r) => r.slots)
    .filter((s) => s.match == null);
}
