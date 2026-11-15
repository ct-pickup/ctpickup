/**
 * The player bracket as plain data and plain words: parsing the server payload and the text each match card shows.
 * No React and no `@/` imports, so it runs in the root test suite. The server (lib/tournament/publicBracket.ts) already
 * allow-lists every field; this file only reads what is there and fills in what an older server did not send.
 */

export type MatchStatus = "scheduled" | "in_progress" | "final" | "bye";

export type BracketTeam = {
  id: string;
  team_name: string;
  seed: number | null;
  team_avg: number | null;
  roster: string[];
};

export type BracketMatch = {
  id: string;
  stage: string;
  group_name: string | null;
  match_number: number;
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  is_bye: boolean;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  status: MatchStatus;
  won_on_penalties: boolean;
};

export type BracketStanding = {
  id: string;
  team_id: string;
  group_id: string;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

export type BracketSlot = {
  id: string;
  stage: string;
  slot: number;
  team_a_id: string | null;
  team_b_id: string | null;
  label_a: string | null;
  label_b: string | null;
  is_bye: boolean;
};

export type TopScorer = { scorer_name: string; goals: number; rank: number };

export type BracketPayload = {
  teams: BracketTeam[];
  matches: BracketMatch[];
  standings: BracketStanding[];
  upcoming: BracketSlot[];
  top_scorers: TopScorer[];
};

const KNOCKOUT = ["qf", "sf", "final"] as const;
export const STAGE_TITLE: Record<string, string> = { qf: "Quarter-finals", sf: "Semi-finals", final: "Final" };
const SLOT_BASE: Record<string, number> = { qf: 1000, sf: 2000, final: 3000 };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const int = (v: unknown, d = 0): number => {
  const n = num(v);
  return n == null ? d : Math.trunc(n);
};

export function isKnockout(stage: string): boolean {
  return (KNOCKOUT as readonly string[]).includes(stage);
}

function statusOf(m: { is_bye: boolean; completed_at: string | null; started_at: string | null }): MatchStatus {
  if (m.is_bye) return "bye";
  if (m.completed_at) return "final";
  if (m.started_at) return "in_progress";
  return "scheduled";
}

function parseMatch(x: unknown): BracketMatch | null {
  const r = obj(x);
  const id = str(r?.id);
  if (!r || !id) return null;
  const base = {
    id,
    stage: str(r.stage) ?? "",
    group_name: str(r.group_name),
    match_number: int(r.match_number),
    team_a_id: str(r.team_a_id),
    team_b_id: str(r.team_b_id),
    score_a: num(r.score_a),
    score_b: num(r.score_b),
    winner_id: str(r.winner_id),
    is_bye: r.is_bye === true,
    scheduled_at: str(r.scheduled_at),
    started_at: str(r.started_at),
    completed_at: str(r.completed_at),
  };
  const status = ((): MatchStatus => {
    const s = r.status;
    return s === "scheduled" || s === "in_progress" || s === "final" || s === "bye" ? s : statusOf(base);
  })();
  const penalties =
    typeof r.won_on_penalties === "boolean"
      ? r.won_on_penalties
      : isKnockout(base.stage) && status === "final" && base.winner_id != null && base.score_a != null && base.score_a === base.score_b;
  return { ...base, status, won_on_penalties: penalties };
}

export function parseBracketPayload(json: unknown): BracketPayload | null {
  const o = obj(json);
  if (!o || !Array.isArray(o.teams) || !Array.isArray(o.matches) || !Array.isArray(o.standings)) return null;

  const teams: BracketTeam[] = [];
  for (const x of o.teams) {
    const r = obj(x);
    const id = str(r?.id);
    if (!r || !id) continue;
    teams.push({
      id,
      team_name: str(r.team_name)?.trim() || "Team",
      seed: num(r.seed) == null ? null : int(r.seed),
      team_avg: num(r.team_avg),
      roster: Array.isArray(r.roster) ? r.roster.filter((n): n is string => typeof n === "string" && n.trim().length > 0) : [],
    });
  }

  const matches = o.matches.map(parseMatch).filter((m): m is BracketMatch => m != null);

  const standings: BracketStanding[] = [];
  for (const x of o.standings) {
    const r = obj(x);
    const id = str(r?.id);
    if (!r || !id) continue;
    standings.push({
      id,
      team_id: str(r.team_id) ?? "",
      group_id: str(r.group_id) ?? "",
      wins: int(r.wins),
      draws: int(r.draws),
      losses: int(r.losses),
      goals_for: int(r.goals_for),
      goals_against: int(r.goals_against),
      goal_difference: int(r.goal_difference),
      points: int(r.points),
    });
  }

  const upcoming: BracketSlot[] = [];
  for (const x of Array.isArray(o.upcoming) ? o.upcoming : []) {
    const r = obj(x);
    const id = str(r?.id);
    const stage = str(r?.stage);
    if (!r || !id || !stage) continue;
    upcoming.push({
      id,
      stage,
      slot: int(r.slot),
      team_a_id: str(r.team_a_id),
      team_b_id: str(r.team_b_id),
      label_a: str(r.label_a),
      label_b: str(r.label_b),
      is_bye: r.is_bye === true,
    });
  }

  const top_scorers: TopScorer[] = [];
  for (const x of Array.isArray(o.top_scorers) ? o.top_scorers : []) {
    const r = obj(x);
    const name = str(r?.scorer_name)?.trim();
    const goals = num(r?.goals);
    if (!r || !name || goals == null || goals < 0) continue;
    const rank = num(r.rank);
    top_scorers.push({ scorer_name: name, goals: Math.trunc(goals), rank: rank != null && rank > 0 ? Math.trunc(rank) : top_scorers.length + 1 });
  }

  return { teams, matches, standings, upcoming, top_scorers };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------------

export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  final: "Final",
  bye: "Bye",
};

export function teamName(teams: Record<string, BracketTeam | undefined>, id: string | null, fallback = "TBD"): string {
  return id ? teams[id]?.team_name || fallback : fallback;
}

/** "Seed 1", or null when the team has none yet. */
export function seedText(team: Pick<BracketTeam, "seed"> | undefined): string | null {
  return team?.seed != null ? `Seed ${team.seed}` : null;
}

/** "avg 3.50", the team average of the display rating. */
export function avgText(team: Pick<BracketTeam, "team_avg"> | undefined): string | null {
  return team?.team_avg != null ? `avg ${team.team_avg.toFixed(2)}` : null;
}

/** "Seed 1 · avg 3.50", or whichever half exists. */
export function seedAndAvgText(team: Pick<BracketTeam, "seed" | "team_avg"> | undefined): string | null {
  const parts = [seedText(team), avgText(team)].filter((p): p is string => p != null);
  return parts.length ? parts.join(" · ") : null;
}

export const SEED_HELP = "Seeds come from each team's average rating. A player with no rating yet counts as the field average.";

/** The score in the middle of a card: "2 - 1" once scores exist, "BYE" for a bye, otherwise "vs". */
export function scoreText(m: Pick<BracketMatch, "is_bye" | "score_a" | "score_b" | "stage">): string {
  if (m.is_bye && m.stage !== "group") return "BYE";
  return m.score_a != null && m.score_b != null ? `${m.score_a} - ${m.score_b}` : "vs";
}

/** Which side won a finished match, from the stored winner. Null while undecided and for a group draw. */
export function winnerSide(m: Pick<BracketMatch, "status" | "winner_id" | "team_a_id" | "team_b_id">): "a" | "b" | null {
  if (m.status !== "final" || !m.winner_id) return null;
  if (m.winner_id === m.team_a_id) return "a";
  if (m.winner_id === m.team_b_id) return "b";
  return null;
}

/** "Alphas won on penalties" for a level knockout match, otherwise null. */
export function penaltyText(m: BracketMatch, teams: Record<string, BracketTeam | undefined>): string | null {
  if (!m.won_on_penalties) return null;
  return `${teamName(teams, m.winner_id, "Winner")} won on penalties`;
}

/** True when at least one match is being played right now. */
export function hasLiveMatch(matches: readonly Pick<BracketMatch, "status">[]): boolean {
  return matches.some((m) => m.status === "in_progress");
}

export type RoundItem =
  | { kind: "match"; order: number; match: BracketMatch }
  | { kind: "slot"; order: number; slot: BracketSlot };

export type Round = { stage: string; title: string; items: RoundItem[] };

/** Knockout rounds in order, with the matches that exist and the slots still waiting for a result, side by side. */
export function knockoutRounds(matches: readonly BracketMatch[], upcoming: readonly BracketSlot[]): Round[] {
  return (KNOCKOUT as readonly string[])
    .map((stage) => {
      const items: RoundItem[] = [
        ...matches.filter((m) => m.stage === stage).map<RoundItem>((match) => ({ kind: "match", order: match.match_number, match })),
        ...upcoming.filter((s) => s.stage === stage).map<RoundItem>((slot) => ({ kind: "slot", order: (SLOT_BASE[stage] ?? 0) + slot.slot, slot })),
      ].sort((a, b) => a.order - b.order);
      return { stage, title: STAGE_TITLE[stage] ?? stage, items };
    })
    .filter((r) => r.items.length > 0);
}

/** "Sat 2:30 PM ET" for a scheduled kickoff, or null when there is none or it cannot be read. */
export function scheduledText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const s = new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    return s && !s.includes("Invalid") ? `${s} ET` : null;
  } catch {
    return null;
  }
}
