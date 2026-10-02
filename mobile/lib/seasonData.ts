import type { SupabaseClient } from "@supabase/supabase-js";

import { splitLocation, type GameCardRun, type RunCrowd } from "@/components/games/GameCards";
import type { AvatarPerson } from "@/components/PlayerAvatar";
import { fetchMyRecord, recordPoints, type PlayerRecord } from "@/lib/playerRecord";
import { fetchRunTimeTbdIds } from "@/lib/pickup/runTimeTbd";
import { outcomeFor, privacyName, scoreLine, type Outcome, type TeamScores } from "@/lib/season";
import { averageStars, fetchPlayerCards, type PlayerCard } from "@/lib/starRatings";

export type PastGame = {
  run_id: string;
  start_at: string | null;
  field: string;
  town: string | null;
  position: string | null;
  potd: boolean;
  outcome: Outcome | null;
  score: string | null;
};

export type SeasonData = {
  wins: number;
  losses: number;
  draws: number;
  games: number;
  potdCount: number;
  /** Last five decided games, oldest first. */
  form: Outcome[];
  /** Current-season points from the points ledger. */
  points: number | null;
  card: PlayerCard | null;
  upcoming: GameCardRun[];
  crowds: Map<string, RunCrowd>;
  past: PastGame[];
  /** True when /api/player/record did not answer; the header and log are then empty. */
  recordFailed?: boolean;
};

export type RecapTeam = { team: string; mine: boolean; won: boolean; players: string[] };

export type MatchRecap = {
  run_id: string;
  start_at: string | null;
  field: string;
  town: string | null;
  format: string | null;
  outcome: Outcome | null;
  score: string | null;
  myTeam: string | null;
  teams: RecapTeam[];
  potd: { name: string; isMe: boolean } | null;
  myAwards: string[];
  position: string | null;
  card: PlayerCard | null;
};

type RunRow = {
  id: string;
  title: string | null;
  start_at: string | null;
  location_text: string | null;
  capacity: number | null;
  spots_taken: number | null;
  format: string | null;
  status: string | null;
};

type ResultRow = {
  run_id: string;
  winning_team: string | null;
  player_of_day: string | null;
  goalie_of_the_day: string | null;
  defender_of_day: string | null;
  midfielder_of_day: string | null;
  attacker_of_day: string | null;
};

const RUN_COLUMNS = "id,title,start_at,location_text,capacity,spots_taken,format,status";
const RESULT_COLUMNS =
  "run_id,winning_team,player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day";
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
const PAST_LIMIT = 60;

function isCanceled(status: string | null): boolean {
  const st = (status ?? "").trim().toLowerCase();
  return st === "canceled" || st === "cancelled";
}

function isPast(run: RunRow, now: number): boolean {
  if (isCanceled(run.status)) return false;
  if ((run.status ?? "").trim().toLowerCase() === "completed") return true;
  const t = run.start_at ? Date.parse(run.start_at) : NaN;
  return Number.isFinite(t) && t < now - LIVE_WINDOW_MS;
}

let scoresUnavailable = false;

/**
 * Pickup scores are optional: `pickup_run_results.score_a/score_b` are not in the schema yet.
 * The first failed read disables the lookup until the next launch, so the log stays quiet.
 */
async function fetchRunScores(supabase: SupabaseClient, runIds: string[]): Promise<Map<string, TeamScores>> {
  const out = new Map<string, TeamScores>();
  if (scoresUnavailable || runIds.length === 0) return out;
  const { data, error } = await supabase.from("pickup_run_results").select("run_id,score_a,score_b").in("run_id", runIds);
  if (error) {
    scoresUnavailable = true;
    console.warn("[season] pickup scores unavailable:", error.message);
    return out;
  }
  for (const row of (data ?? []) as Array<{ run_id: string; score_a: number | null; score_b: number | null }>) {
    if (typeof row.score_a === "number" && typeof row.score_b === "number") {
      out.set(row.run_id, { A: row.score_a, B: row.score_b });
    }
  }
  return out;
}

async function myConfirmedRunIds(supabase: SupabaseClient, uid: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("pickup_run_rsvps")
    .select("run_id")
    .eq("user_id", uid)
    .eq("status", "confirmed")
    .limit(500);
  if (error) console.warn("[season] rsvps:", error.message);
  return Array.from(
    new Set(((data ?? []) as Array<{ run_id: string | null }>).map((r) => r.run_id).filter((v): v is string => Boolean(v))),
  );
}

export async function fetchSeason(supabase: SupabaseClient, uid: string, accessToken: string | null): Promise<SeasonData> {
  const now = Date.now();
  const [profileRes, record, runIds] = await Promise.all([
    supabase.from("profiles").select("playing_position").eq("id", uid).maybeSingle(),
    accessToken ? fetchMyRecord(accessToken) : Promise.resolve<PlayerRecord | null>(null),
    myConfirmedRunIds(supabase, uid),
  ]);
  if (profileRes.error) console.warn("[season] profile:", profileRes.error.message);
  const position = (profileRes.data as { playing_position?: string | null } | null)?.playing_position?.trim() || null;

  const runs: RunRow[] = [];
  for (let i = 0; i < runIds.length; i += 200) {
    const { data, error } = await supabase.from("pickup_runs").select(RUN_COLUMNS).in("id", runIds.slice(i, i + 200));
    if (error) console.warn("[season] runs:", error.message);
    runs.push(...((data ?? []) as RunRow[]));
  }

  const upcomingRuns = runs
    .filter((r) => {
      if (isCanceled(r.status) || isPast(r, now)) return false;
      const t = r.start_at ? Date.parse(r.start_at) : NaN;
      return Number.isFinite(t) && t >= now - LIVE_WINDOW_MS;
    })
    .sort((a, b) => String(a.start_at ?? "").localeCompare(String(b.start_at ?? "")))
    .slice(0, 8);
  const upcomingIds = upcomingRuns.map((r) => r.id);
  const upcomingTbd = await fetchRunTimeTbdIds(supabase, upcomingIds);

  const past: PastGame[] = (record?.log ?? []).slice(0, PAST_LIMIT).map((g) => {
    const { field, town } = splitLocation(g.location_text, g.title);
    return {
      run_id: g.run_id,
      start_at: g.start_at,
      field,
      town,
      position,
      potd: g.potd,
      outcome: g.outcome,
      score: g.score,
    };
  });

  const crowdRsvpRes = upcomingIds.length
    ? await supabase
        .from("pickup_run_rsvps")
        .select("run_id,user_id")
        .in("run_id", upcomingIds)
        .in("status", ["confirmed", "pending_payment"])
    : { data: [], error: null };
  if (crowdRsvpRes.error) console.warn("[season] attendees:", crowdRsvpRes.error.message);

  const crowdRows = (crowdRsvpRes.data ?? []) as Array<{ run_id: string; user_id: string }>;
  const crowdIds = Array.from(new Set(crowdRows.map((r) => r.user_id).filter(Boolean)));
  const [crowdProfilesRes, cards] = await Promise.all([
    crowdIds.length
      ? supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", crowdIds)
      : Promise.resolve({ data: [], error: null }),
    fetchPlayerCards(supabase, [...crowdIds, uid]),
  ]);
  const personById = new Map<string, AvatarPerson>();
  for (const p of (crowdProfilesRes.data ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  }>) {
    personById.set(p.id, { user_id: p.id, first_name: p.first_name, last_name: p.last_name, avatar_url: p.avatar_url?.trim() || null });
  }
  const crowds = new Map<string, RunCrowd>();
  for (const id of upcomingIds) {
    const ids = crowdRows.filter((r) => r.run_id === id).map((r) => r.user_id);
    crowds.set(id, {
      people: ids.map((u) => personById.get(u) ?? { user_id: u, first_name: null, last_name: null, avatar_url: null }),
      avgStar: averageStars(ids.map((u) => cards.get(u)?.star)),
    });
  }

  return {
    wins: record?.wins ?? 0,
    losses: record?.losses ?? 0,
    draws: record?.draws ?? 0,
    games: record?.games ?? 0,
    potdCount: record?.potd_count ?? 0,
    form: record?.form ?? [],
    recordFailed: Boolean(accessToken) && !record,
    points: recordPoints(record, "season_points"),
    card: cards.get(uid) ?? null,
    upcoming: upcomingRuns
      .filter((r): r is RunRow & { start_at: string } => Boolean(r.start_at))
      .map((r) => ({
        id: r.id,
        title: r.title,
        start_at: r.start_at,
        time_tbd: upcomingTbd.has(r.id),
        location_text: r.location_text,
        capacity: Math.max(0, Number(r.capacity ?? 0)),
        spots_taken: Math.max(0, Number(r.spots_taken ?? 0)),
        format: r.format,
      })),
    crowds,
    past,
  };
}

/** The recap's result line is the match log row from the record helper; local rows only if it is unavailable. */
function recapOutcome(
  record: PlayerRecord | null,
  runId: string,
  myTeam: string | null,
  res: ResultRow | null,
  runScores: TeamScores | null,
): { outcome: Outcome | null; score: string | null } {
  const row = record?.log.find((g) => g.run_id === runId);
  if (row) return { outcome: row.outcome, score: row.score };
  return {
    outcome: outcomeFor(myTeam, res ? { winning_team: res.winning_team, scores: runScores } : null),
    score: scoreLine(myTeam, runScores),
  };
}

const AWARD_LABELS: Array<[keyof ResultRow, string]> = [
  ["goalie_of_the_day", "Goalie of the Day"],
  ["defender_of_day", "Defender of the Day"],
  ["midfielder_of_day", "Midfielder of the Day"],
  ["attacker_of_day", "Attacker of the Day"],
];

export async function fetchMatchRecap(
  supabase: SupabaseClient,
  uid: string,
  runId: string,
  accessToken: string | null = null,
): Promise<MatchRecap | null> {
  const [runRes, resultRes, assignRes, meRes, scores, cards, record] = await Promise.all([
    supabase.from("pickup_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle(),
    supabase.from("pickup_run_results").select(RESULT_COLUMNS).eq("run_id", runId).maybeSingle(),
    supabase.from("pickup_run_team_assignments").select("user_id,team").eq("run_id", runId),
    supabase.from("profiles").select("playing_position").eq("id", uid).maybeSingle(),
    fetchRunScores(supabase, [runId]),
    fetchPlayerCards(supabase, [uid]),
    accessToken ? fetchMyRecord(accessToken) : Promise.resolve<PlayerRecord | null>(null),
  ]);
  if (runRes.error) console.warn("[recap] run:", runRes.error.message);
  if (resultRes.error) console.warn("[recap] result:", resultRes.error.message);
  if (assignRes.error) console.warn("[recap] teams:", assignRes.error.message);
  const run = runRes.data as RunRow | null;
  if (!run) return null;
  const res = resultRes.data as ResultRow | null;
  const assigns = (assignRes.data ?? []) as Array<{ user_id: string; team: string }>;
  const myTeam = assigns.find((a) => a.user_id === uid)?.team ?? null;
  const runScores = scores.get(runId) ?? null;

  const nameIds = Array.from(new Set([...assigns.map((a) => a.user_id), res?.player_of_day].filter((v): v is string => Boolean(v))));
  const nameById = new Map<string, string>();
  if (nameIds.length) {
    const { data, error } = await supabase.from("profiles").select("id,first_name,last_name").in("id", nameIds);
    if (error) console.warn("[recap] names:", error.message);
    for (const p of (data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
      nameById.set(p.id, privacyName(p.first_name, p.last_name));
    }
  }

  const teamNames = Array.from(new Set(assigns.map((a) => a.team))).sort();
  const teams: RecapTeam[] = teamNames.map((team) => ({
    team,
    mine: team === myTeam,
    won: res?.winning_team === team,
    players: assigns
      .filter((a) => a.team === team)
      .map((a) => (a.user_id === uid ? "You" : (nameById.get(a.user_id) ?? "Player")))
      .sort((a, b) => (a === "You" ? -1 : b === "You" ? 1 : a.localeCompare(b))),
  }));

  const potdId = res?.player_of_day ?? null;
  const { field, town } = splitLocation(run.location_text, run.title);
  return {
    run_id: run.id,
    start_at: run.start_at,
    field,
    town,
    format: run.format,
    ...recapOutcome(record, runId, myTeam, res, runScores),
    myTeam,
    teams,
    potd: potdId ? { name: potdId === uid ? "You" : (nameById.get(potdId) ?? "Player"), isMe: potdId === uid } : null,
    myAwards: res ? AWARD_LABELS.filter(([col]) => res[col] === uid).map(([, label]) => label) : [],
    position: (meRes.data as { playing_position?: string | null } | null)?.playing_position?.trim() || null,
    card: cards.get(uid) ?? null,
  };
}
