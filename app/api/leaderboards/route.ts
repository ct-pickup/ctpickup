import { NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { jsonConfigErrorResponse, jsonUnexpectedErrorResponse, logPublicApiRouteError } from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "leaderboards";
const HUB_REGIONS = new Set(["CT", "NY", "NJ", "MD"]);
const PAGE = 1000;

type LeaderboardPlayerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  instagram: string | null;
  nearest_venue: string | null;
  /** Primary stat for the category (win rate = percent, 0–100, one decimal). */
  value: number;
  /** Win rate category only: raw fraction 0–1 */
  win_rate?: number;
  games_played?: number;
};

function parseRegion(param: string | null): string | null {
  if (!param) return null;
  const u = param.trim().toUpperCase();
  return HUB_REGIONS.has(u) ? u : null;
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

function normalizeNameKey(first: string | null | undefined, last: string | null | undefined): string {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeScorerName(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function passesRegionFilter(nearestVenue: string | null, region: string | null): boolean {
  if (!region) return true;
  const mapped = serviceRegionForVenueName(nearestVenue);
  if (!mapped) return false;
  return mapped === region;
}

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  instagram: string | null;
  nearest_venue: string | null;
  pickup_wins_count: number | null | undefined;
  pickup_losses_count: number | null | undefined;
  attended_count: number | null | undefined;
};

function logSupabaseCategory(phase: string, err: PostgrestError): void {
  console.error(`[api/${ROUTE}] ${phase} Supabase error:`, {
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
  });
}

/** Try progressively smaller column sets so missing columns skip categories instead of failing the route. */
async function fetchApprovedProfiles(admin: SupabaseClient): Promise<{
  profiles: ProfileRow[];
  hasWinLossColumns: boolean;
  hasAttendedCount: boolean;
}> {
  const columnSets: string[] = [
    "id,first_name,last_name,username,instagram,nearest_venue,pickup_wins_count,pickup_losses_count,attended_count",
    "id,first_name,last_name,username,instagram,nearest_venue,pickup_wins_count,pickup_losses_count",
    "id,first_name,last_name,username,instagram,nearest_venue,attended_count",
    "id,first_name,last_name,username,instagram,nearest_venue",
  ];

  for (const columns of columnSets) {
    const out: ProfileRow[] = [];
    let from = 0;
    let failed = false;
    for (;;) {
      const { data, error } = await admin.from("profiles").select(columns).eq("approved", true).range(from, from + PAGE - 1);
      if (error) {
        logSupabaseCategory(`profiles.select(${columns})`, error);
        failed = true;
        break;
      }
      const rows = (data ?? []) as unknown as ProfileRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    if (!failed) {
      const hasWinLossColumns = columns.includes("pickup_wins_count");
      const hasAttendedCount = columns.includes("attended_count");
      return { profiles: out, hasWinLossColumns, hasAttendedCount };
    }
  }

  console.error(`[api/${ROUTE}] profiles: all column set fallbacks failed; returning empty profiles`);
  return { profiles: [], hasWinLossColumns: false, hasAttendedCount: false };
}

async function fetchPickupRunResultsAwardMaps(admin: SupabaseClient): Promise<{
  potdCount: Map<string, number>;
  gotdCount: Map<string, number>;
  dotdCount: Map<string, number>;
  motdCount: Map<string, number>;
  aotdCount: Map<string, number>;
}> {
  const empty = {
    potdCount: new Map<string, number>(),
    gotdCount: new Map<string, number>(),
    dotdCount: new Map<string, number>(),
    motdCount: new Map<string, number>(),
    aotdCount: new Map<string, number>(),
  };

  try {
    const potdCount = new Map<string, number>();
    const gotdCount = new Map<string, number>();
    const dotdCount = new Map<string, number>();
    const motdCount = new Map<string, number>();
    const aotdCount = new Map<string, number>();
    let resFrom = 0;
    for (;;) {
      const { data, error } = await admin
        .from("pickup_run_results")
        .select("player_of_day,goalie_of_the_day,defender_of_day,midfielder_of_day,attacker_of_day")
        .range(resFrom, resFrom + PAGE - 1);
      if (error) {
        logSupabaseCategory("pickup_run_results (award scan)", error);
        return empty;
      }
      const rows = (data ?? []) as Array<{
        player_of_day: string | null;
        goalie_of_the_day: string | null;
        defender_of_day: string | null;
        midfielder_of_day: string | null;
        attacker_of_day: string | null;
      }>;
      for (const row of rows) {
        const bump = (m: Map<string, number>, id: string | null) => {
          if (!id) return;
          m.set(id, (m.get(id) ?? 0) + 1);
        };
        bump(potdCount, row.player_of_day);
        bump(gotdCount, row.goalie_of_the_day);
        bump(dotdCount, row.defender_of_day);
        bump(motdCount, row.midfielder_of_day);
        bump(aotdCount, row.attacker_of_day);
      }
      if (rows.length < PAGE) break;
      resFrom += PAGE;
    }
    return { potdCount, gotdCount, dotdCount, motdCount, aotdCount };
  } catch (err) {
    logPublicApiRouteError(ROUTE, "pickup_run_results_awards", err);
    return empty;
  }
}

async function fetchTournamentGoalNameCounts(admin: SupabaseClient): Promise<Map<string, number>> {
  const goalNameCount = new Map<string, number>();
  try {
    let goalFrom = 0;
    for (;;) {
      const { data, error } = await admin.from("tournament_match_goals").select("scorer_name").range(goalFrom, goalFrom + PAGE - 1);
      if (error) {
        logSupabaseCategory("tournament_match_goals", error);
        return new Map();
      }
      const rows = (data ?? []) as { scorer_name: string | null }[];
      for (const row of rows) {
        const key = normalizeScorerName(row.scorer_name);
        if (!key) continue;
        goalNameCount.set(key, (goalNameCount.get(key) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
      goalFrom += PAGE;
    }
    return goalNameCount;
  } catch (err) {
    logPublicApiRouteError(ROUTE, "tournament_match_goals", err);
    return new Map();
  }
}

export async function GET(req: Request) {
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: authUser, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authUser.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const region = parseRegion(url.searchParams.get("region"));

    const { profiles, hasWinLossColumns, hasAttendedCount } = await fetchApprovedProfiles(admin);
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const { potdCount, gotdCount, dotdCount, motdCount, aotdCount } = await fetchPickupRunResultsAwardMaps(admin);
    const goalNameCount = await fetchTournamentGoalNameCounts(admin);

    const toRow = (p: ProfileRow, value: number, extras?: Partial<LeaderboardPlayerRow>): LeaderboardPlayerRow => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      username: p.username,
      instagram: p.instagram,
      nearest_venue: p.nearest_venue,
      value,
      ...extras,
    });

    let winsCandidates: LeaderboardPlayerRow[] = [];
    let rateRows: LeaderboardPlayerRow[] = [];
    try {
      if (hasWinLossColumns) {
        winsCandidates = profiles
          .map((p) => {
            const w = Math.max(0, Math.trunc(Number(p.pickup_wins_count ?? 0)));
            const l = Math.max(0, Math.trunc(Number(p.pickup_losses_count ?? 0)));
            return { p, w, games: w + l };
          })
          .filter(({ w, games }) => w > 0 && games >= 10)
          .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
          .sort((a, b) => b.w - a.w)
          .slice(0, 25)
          .map(({ p, w }) => toRow(p, w));

        rateRows = profiles
          .map((p) => {
            const w = Math.max(0, Math.trunc(Number(p.pickup_wins_count ?? 0)));
            const l = Math.max(0, Math.trunc(Number(p.pickup_losses_count ?? 0)));
            const games = w + l;
            const win_rate = games > 0 ? w / games : 0;
            return { p, games, win_rate };
          })
          .filter(({ games }) => games >= 10)
          .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
          .sort((a, b) => {
            if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
            return b.games - a.games;
          })
          .slice(0, 25)
          .map(({ p, win_rate, games }) => {
            const pct = Math.round(win_rate * 1000) / 10;
            return {
              id: p.id,
              first_name: p.first_name,
              last_name: p.last_name,
              username: p.username,
              instagram: p.instagram,
              nearest_venue: p.nearest_venue,
              value: pct,
              win_rate,
              games_played: games,
            };
          });
      }
    } catch (err) {
      logPublicApiRouteError(ROUTE, "category_wins_win_rate", err);
      winsCandidates = [];
      rateRows = [];
    }

    let sessionsRows: LeaderboardPlayerRow[] = [];
    try {
      if (hasAttendedCount) {
        const sessionEntries = profiles
          .map((p) => ({ p, n: Math.max(0, Math.trunc(Number(p.attended_count ?? 0))) }))
          .filter(({ n }) => n >= 5)
          .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
          .sort((a, b) => b.n - a.n)
          .slice(0, 25);
        sessionsRows = sessionEntries.map(({ p, n }) => toRow(p, n));
      }
    } catch (err) {
      logPublicApiRouteError(ROUTE, "category_sessions", err);
      sessionsRows = [];
    }

    function buildAwardRows(counts: Map<string, number>): LeaderboardPlayerRow[] {
      const out: LeaderboardPlayerRow[] = [];
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [userId, n] of sorted) {
        const p = profileById.get(userId);
        if (!p) continue;
        if (!passesRegionFilter(p.nearest_venue, region)) continue;
        out.push(toRow(p, n));
        if (out.length >= 25) break;
      }
      return out;
    }

    let potdRows: LeaderboardPlayerRow[] = [];
    let goalieRows: LeaderboardPlayerRow[] = [];
    let defenderRows: LeaderboardPlayerRow[] = [];
    let midfielderRows: LeaderboardPlayerRow[] = [];
    let attackerRows: LeaderboardPlayerRow[] = [];
    try {
      potdRows = buildAwardRows(potdCount);
      goalieRows = buildAwardRows(gotdCount);
      defenderRows = buildAwardRows(dotdCount);
      midfielderRows = buildAwardRows(motdCount);
      attackerRows = buildAwardRows(aotdCount);
    } catch (err) {
      logPublicApiRouteError(ROUTE, "category_awards_assemble", err);
    }

    let goalsRows: LeaderboardPlayerRow[] = [];
    try {
      goalsRows = profiles
        .map((p) => {
          const key = normalizeNameKey(p.first_name, p.last_name);
          if (!key) return null;
          const goals = goalNameCount.get(key) ?? 0;
          return { p, goals };
        })
        .filter((x): x is { p: ProfileRow; goals: number } => x != null && x.goals > 0)
        .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
        .sort((a, b) => b.goals - a.goals)
        .slice(0, 25)
        .map(({ p, goals }) => toRow(p, goals));
    } catch (err) {
      logPublicApiRouteError(ROUTE, "category_goals", err);
      goalsRows = [];
    }

    return NextResponse.json({
      ok: true as const,
      region: region ?? "ALL",
      wins: winsCandidates,
      sessions: sessionsRows,
      win_rate: rateRows,
      potd: potdRows,
      goalie: goalieRows,
      defender: defenderRows,
      midfielder: midfielderRows,
      attacker: attackerRows,
      goals: goalsRows,
    });
  } catch (err) {
    return jsonUnexpectedErrorResponse(ROUTE, "GET", err);
  }
}
