import type { SupabaseClient } from "@supabase/supabase-js";
import { loadExactRatings } from "@/lib/ratings/exactRatings";
import { matchStatus, upcomingSlots, wonOnPenalties, type BracketMatch, type MatchStatus } from "@/lib/tournament/bracketLogic";
import { PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";
import { seedTeams, type SeededTeam } from "@/lib/tournament/seeding";

/**
 * The player-facing bracket. Every object is built field by field from an allow-list, never spread from a database row, so a
 * column added to a tournament table later (contact details, payment fields, review notes) cannot leak into this response.
 * What a player may see: team name, roster display names, seed, team average, scores, standings. Nothing else.
 */

export type PublicTeam = {
  id: string;
  team_name: string;
  /** 1 is the strongest team by combined rating. Null when it cannot be worked out yet. */
  seed: number | null;
  /** Team average of the exact display rating, two decimals. */
  team_avg: number | null;
  /** First name and last initial, e.g. "Sam R.". */
  roster: string[];
};

export type PublicMatch = {
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

export type PublicStanding = {
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

/** A later knockout round that has no stored match yet: known teams filled in, the rest labelled. */
export type PublicSlot = {
  id: string;
  stage: string;
  slot: number;
  team_a_id: string | null;
  team_b_id: string | null;
  label_a: string | null;
  label_b: string | null;
  is_bye: boolean;
};

export type PublicBracket = {
  teams: PublicTeam[];
  matches: PublicMatch[];
  standings: PublicStanding[];
  upcoming: PublicSlot[];
  top_scorers: { scorer_name: string; goals: number; rank: number }[];
};

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const intOrNull = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

/** "Sam R." from a profile. Falls back to "Player" so a name is never empty and a handle is never shown. */
export function rosterDisplayName(first: unknown, last: unknown): string {
  const f = String(first ?? "").trim();
  const l = String(last ?? "").trim().charAt(0).toUpperCase();
  if (f && l) return `${f} ${l}.`;
  return f || "Player";
}

export function publicMatch(row: Raw): PublicMatch {
  const m: BracketMatch = {
    id: String(row.id),
    stage: String(row.stage ?? ""),
    group_name: str(row.group_name),
    match_number: int(row.match_number),
    team_a_id: str(row.team_a_id),
    team_b_id: str(row.team_b_id),
    score_a: intOrNull(row.score_a),
    score_b: intOrNull(row.score_b),
    winner_id: str(row.winner_id),
    is_bye: row.is_bye === true,
    scheduled_at: str(row.scheduled_at),
    started_at: str(row.started_at),
    completed_at: str(row.completed_at),
  };
  return {
    id: m.id,
    stage: m.stage,
    group_name: m.group_name ?? null,
    match_number: m.match_number,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    score_a: m.score_a,
    score_b: m.score_b,
    winner_id: m.winner_id,
    is_bye: Boolean(m.is_bye),
    scheduled_at: m.scheduled_at ?? null,
    started_at: m.started_at ?? null,
    completed_at: m.completed_at ?? null,
    status: matchStatus(m),
    won_on_penalties: wonOnPenalties(m),
  };
}

function publicStanding(row: Raw): PublicStanding {
  return {
    id: String(row.id),
    team_id: String(row.team_id),
    group_id: String(row.group_id),
    wins: int(row.wins),
    draws: int(row.draws),
    losses: int(row.losses),
    goals_for: int(row.goals_for),
    goals_against: int(row.goals_against),
    goal_difference: int(row.goal_difference),
    points: int(row.points),
  };
}

export type PublicBracketInput = {
  /** Captain rows: only id and team_name are read. */
  captains: readonly Raw[];
  matches: readonly Raw[];
  standings: readonly Raw[];
  /** Roster display names by captain id. */
  rosters: ReadonlyMap<string, readonly string[]>;
  seeds: readonly SeededTeam[];
  topScorers: readonly { scorer_name: string; goals: number }[];
};

export function buildPublicBracket(input: PublicBracketInput): PublicBracket {
  const seedById = new Map(input.seeds.map((s) => [s.id, s]));
  const teams: PublicTeam[] = input.captains.map((c) => {
    const id = String(c.id);
    const seed = seedById.get(id);
    return {
      id,
      team_name: str(c.team_name)?.trim() || "Team",
      seed: seed?.seed ?? null,
      team_avg: seed?.team_avg ?? null,
      roster: [...(input.rosters.get(id) ?? [])],
    };
  });

  const matches = input.matches.map(publicMatch);
  const upcoming: PublicSlot[] = upcomingSlots(matches).map((s) => ({
    id: `slot:${s.stage}:${s.slot}`,
    stage: s.stage,
    slot: s.slot,
    team_a_id: s.team_a_id,
    team_b_id: s.team_b_id,
    label_a: s.label_a,
    label_b: s.label_b,
    is_bye: s.is_bye,
  }));

  const top_scorers = [...input.topScorers]
    .sort((a, b) => b.goals - a.goals || a.scorer_name.localeCompare(b.scorer_name))
    .slice(0, 20)
    .map((s, i) => ({ scorer_name: s.scorer_name, goals: s.goals, rank: i + 1 }));

  return { teams, matches, standings: input.standings.map(publicStanding), upcoming, top_scorers };
}

type DbResult<T> = { data: T | null; error: { message: string } | null };

/** Loads everything the player bracket needs and returns the allow-listed payload. */
export async function loadPublicBracket(
  admin: SupabaseClient,
  tournamentId: string,
): Promise<{ ok: true; bracket: PublicBracket } | { ok: false; error: string }> {
  const [teamsRes, matchesRes, standingsRes] = (await Promise.all([
    admin
      .from("tournament_captains")
      .select("id, team_name, user_id")
      .eq("tournament_id", tournamentId)
      .in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]),
    admin.from("tournament_matches").select("*").eq("tournament_id", tournamentId).order("match_number", { ascending: true }),
    admin.from("tournament_group_members").select("*").eq("tournament_id", tournamentId),
  ])) as [DbResult<Raw[]>, DbResult<Raw[]>, DbResult<Raw[]>];
  if (teamsRes.error) return { ok: false, error: teamsRes.error.message };
  if (matchesRes.error) return { ok: false, error: matchesRes.error.message };
  if (standingsRes.error) return { ok: false, error: standingsRes.error.message };

  const captains = teamsRes.data ?? [];
  const capIds = captains.map((c) => String(c.id));

  const rosterRows: Raw[] = [];
  if (capIds.length) {
    const r = (await admin
      .from("tournament_roster")
      .select("user_id, captain_id, status")
      .in("captain_id", capIds)
      .eq("status", "accepted")) as DbResult<Raw[]>;
    if (r.error) return { ok: false, error: r.error.message };
    rosterRows.push(...(r.data ?? []));
  }

  // Team members: the captain plus accepted roster players.
  const membersByTeam = new Map<string, Set<string>>();
  for (const c of captains) {
    const uid = str(c.user_id);
    if (uid) membersByTeam.set(String(c.id), new Set([uid]));
    else membersByTeam.set(String(c.id), new Set());
  }
  for (const r of rosterRows) {
    const uid = str(r.user_id);
    const set = membersByTeam.get(String(r.captain_id));
    if (uid && set) set.add(uid);
  }
  const allUserIds = [...new Set([...membersByTeam.values()].flatMap((s) => [...s]))];

  const names = new Map<string, string>();
  if (allUserIds.length) {
    const p = (await admin.from("profiles").select("id, first_name, last_name").in("id", allUserIds)) as DbResult<Raw[]>;
    if (p.error) return { ok: false, error: p.error.message };
    for (const row of p.data ?? []) names.set(String(row.id), rosterDisplayName(row.first_name, row.last_name));
  }

  const ratings = await loadExactRatings(admin, allUserIds);
  const seeds = seedTeams(
    captains.map((c) => ({ id: String(c.id), team_name: str(c.team_name) ?? "Team", user_ids: [...(membersByTeam.get(String(c.id)) ?? [])] })),
    ratings,
  );

  const rosters = new Map<string, string[]>();
  for (const [teamId, ids] of membersByTeam) {
    rosters.set(
      teamId,
      [...ids].map((uid) => names.get(uid) ?? "Player").sort((a, b) => a.localeCompare(b)),
    );
  }

  const goalsRes = (await admin.from("tournament_match_goals").select("scorer_name").eq("tournament_id", tournamentId)) as DbResult<Raw[]>;
  if (goalsRes.error) return { ok: false, error: goalsRes.error.message };
  const counts = new Map<string, number>();
  for (const g of goalsRes.data ?? []) {
    const name = typeof g.scorer_name === "string" ? g.scorer_name.trim() : "";
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return {
    ok: true,
    bracket: buildPublicBracket({
      captains,
      matches: matchesRes.data ?? [],
      standings: standingsRes.data ?? [],
      rosters,
      seeds,
      topScorers: [...counts.entries()].map(([scorer_name, goals]) => ({ scorer_name, goals })),
    }),
  };
}
