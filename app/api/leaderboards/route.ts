import { NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { jsonConfigErrorResponse, logPublicApiRouteError } from "@/lib/server/publicApiRouteErrors";
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

function toLeaderboardRow(p: ProfileRow, value: number, extras?: Partial<LeaderboardPlayerRow>): LeaderboardPlayerRow {
  return {
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    username: p.username,
    instagram: p.instagram,
    nearest_venue: p.nearest_venue,
    value,
    ...extras,
  };
}

/** Paginate a single UUID column on pickup_run_results and count occurrences (no join). */
async function countPickupRunResultsUuidColumn(
  admin: SupabaseClient,
  column: "player_of_day" | "goalie_of_the_day" | "defender_of_day" | "midfielder_of_day" | "attacker_of_day",
  categoryLabel: string,
): Promise<{ counts: Map<string, number>; error: PostgrestError | null }> {
  const counts = new Map<string, number>();
  try {
    let resFrom = 0;
    for (;;) {
      const { data, error } = await admin.from("pickup_run_results").select(column).range(resFrom, resFrom + PAGE - 1);
      if (error) {
        console.log(`[api/${ROUTE}] category=${categoryLabel} column scan error`, {
          message: error.message,
          code: error.code,
          details: error.details,
        });
        return { counts: new Map(), error };
      }
      const rows = (data ?? []) as Record<string, string | null>[];
      for (const row of rows) {
        const id = row[column];
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
      resFrom += PAGE;
    }
    console.log(`[api/${ROUTE}] category=${categoryLabel} column scan ok`, { distinctIds: counts.size, pagesEnd: resFrom });
    return { counts, error: null };
  } catch (err) {
    console.log(`[api/${ROUTE}] category=${categoryLabel} column scan threw`, err);
    logPublicApiRouteError(ROUTE, `${categoryLabel}_scan`, err);
    return { counts: new Map(), error: null };
  }
}

async function fetchProfilesByIds(admin: SupabaseClient, ids: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  const CHUNK = 120;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,instagram,nearest_venue")
      .in("id", chunk)
      .eq("approved", true);
    if (error) {
      logSupabaseCategory(`profiles.in(chunk ${chunk.length})`, error);
      continue;
    }
    for (const row of (data ?? []) as ProfileRow[]) {
      map.set(row.id, row);
    }
  }
  return map;
}

/** Top leaderboard rows from uuid → count map; optional profile fetch for names; region filter may scan past first 25 globally. */
async function rowsFromUuidCounts(
  admin: SupabaseClient,
  counts: Map<string, number>,
  region: string | null,
  categoryLabel: string,
): Promise<LeaderboardPlayerRow[]> {
  try {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const candidateIds: string[] = [];
    for (const [id] of sorted) {
      candidateIds.push(id);
      if (candidateIds.length >= 400) break;
    }
    console.log(`[api/${ROUTE}] category=${categoryLabel} assemble`, {
      sortedLen: sorted.length,
      fetchProfilesFor: candidateIds.length,
    });
    const profileById = await fetchProfilesByIds(admin, candidateIds);
    const out: LeaderboardPlayerRow[] = [];
    for (const [userId, n] of sorted) {
      const p = profileById.get(userId);
      if (!p) continue;
      if (!passesRegionFilter(p.nearest_venue, region)) continue;
      out.push(toLeaderboardRow(p, n));
      if (out.length >= 25) break;
    }
    console.log(`[api/${ROUTE}] category=${categoryLabel} result`, { rowCount: out.length });
    return out;
  } catch (err) {
    console.log(`[api/${ROUTE}] category=${categoryLabel} assemble threw`, err);
    return [];
  }
}

/**
 * Sessions: direct profiles query (no RSVP/run join). Uses attended_count only.
 * When a hub region is selected, fetch extra rows then filter so we can still fill 25 slots.
 */
async function fetchSessionsLeaderboard(admin: SupabaseClient, region: string | null): Promise<{
  rows: LeaderboardPlayerRow[];
  error: PostgrestError | null;
}> {
  const limit = region ? 500 : 25;
  const { data, error } = await admin
    .from("profiles")
    .select("id,first_name,last_name,username,instagram,nearest_venue,attended_count")
    .eq("approved", true)
    .gte("attended_count", 5)
    .order("attended_count", { ascending: false })
    .limit(limit);

  if (error) {
    console.log(`[api/${ROUTE}] category=sessions query error`, {
      message: error.message,
      code: error.code,
      details: error.details,
    });
    return { rows: [], error };
  }

  const rows = (data ?? []) as ProfileRow[];
  const out: LeaderboardPlayerRow[] = [];
  for (const p of rows) {
    if (!passesRegionFilter(p.nearest_venue, region)) continue;
    const n = Math.max(0, Math.trunc(Number(p.attended_count ?? 0)));
    out.push(toLeaderboardRow(p, n));
    if (out.length >= 25) break;
  }
  console.log(`[api/${ROUTE}] category=sessions result`, { rawRows: rows.length, rowCount: out.length });
  return { rows: out, error: null };
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

const EMPTY_PAYLOAD = {
  ok: true as const,
  region: "ALL" as string,
  wins: [] as LeaderboardPlayerRow[],
  sessions: [] as LeaderboardPlayerRow[],
  win_rate: [] as LeaderboardPlayerRow[],
  potd: [] as LeaderboardPlayerRow[],
  goalie: [] as LeaderboardPlayerRow[],
  defender: [] as LeaderboardPlayerRow[],
  midfielder: [] as LeaderboardPlayerRow[],
  attacker: [] as LeaderboardPlayerRow[],
  goals: [] as LeaderboardPlayerRow[],
};

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
  console.log(`[api/${ROUTE}] auth`, {
    hasUser: Boolean(authUser?.user?.id),
    userId: authUser?.user?.id ?? null,
    authError: authErr?.message ?? null,
    authCode: authErr?.status ?? authErr?.code ?? null,
  });
  if (authErr || !authUser.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const region = parseRegion(url.searchParams.get("region"));

  let wins: LeaderboardPlayerRow[] = [];
  let sessions: LeaderboardPlayerRow[] = [];
  let win_rate: LeaderboardPlayerRow[] = [];
  let potd: LeaderboardPlayerRow[] = [];
  let goalie: LeaderboardPlayerRow[] = [];
  let defender: LeaderboardPlayerRow[] = [];
  let midfielder: LeaderboardPlayerRow[] = [];
  let attacker: LeaderboardPlayerRow[] = [];
  let goals: LeaderboardPlayerRow[] = [];

  try {
    let profiles: ProfileRow[] = [];
    let hasWinLossColumns = false;
    try {
      const bundle = await fetchApprovedProfiles(admin);
      profiles = bundle.profiles;
      hasWinLossColumns = bundle.hasWinLossColumns;
      console.log(`[api/${ROUTE}] profiles`, {
        count: profiles.length,
        hasWinLossColumns,
        hasAttendedCount: bundle.hasAttendedCount,
      });
    } catch (err) {
      console.log(`[api/${ROUTE}] category=profiles threw`, err);
      profiles = [];
      hasWinLossColumns = false;
    }

    const profileById = new Map(profiles.map((p) => [p.id, p]));

    try {
      if (hasWinLossColumns) {
        wins = profiles
          .map((p) => {
            const w = Math.max(0, Math.trunc(Number(p.pickup_wins_count ?? 0)));
            const l = Math.max(0, Math.trunc(Number(p.pickup_losses_count ?? 0)));
            return { p, w, games: w + l };
          })
          .filter(({ w, games }) => w > 0 && games >= 10)
          .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
          .sort((a, b) => b.w - a.w)
          .slice(0, 25)
          .map(({ p, w }) => toLeaderboardRow(p, w));

        win_rate = profiles
          .map((p) => {
            const w = Math.max(0, Math.trunc(Number(p.pickup_wins_count ?? 0)));
            const l = Math.max(0, Math.trunc(Number(p.pickup_losses_count ?? 0)));
            const games = w + l;
            const winRate = games > 0 ? w / games : 0;
            return { p, games, winRate };
          })
          .filter(({ games }) => games >= 10)
          .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
          .sort((a, b) => {
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            return b.games - a.games;
          })
          .slice(0, 25)
          .map(({ p, winRate, games }) => {
            const pct = Math.round(winRate * 1000) / 10;
            return {
              id: p.id,
              first_name: p.first_name,
              last_name: p.last_name,
              username: p.username,
              instagram: p.instagram,
              nearest_venue: p.nearest_venue,
              value: pct,
              win_rate: winRate,
              games_played: games,
            };
          });
      }
      console.log(`[api/${ROUTE}] category=wins_win_rate`, { wins: wins.length, win_rate: win_rate.length });
    } catch (err) {
      console.log(`[api/${ROUTE}] category=wins_win_rate error`, err);
      logPublicApiRouteError(ROUTE, "category_wins_win_rate", err);
      wins = [];
      win_rate = [];
    }

    try {
      const { rows, error } = await fetchSessionsLeaderboard(admin, region);
      sessions = rows;
      console.log(`[api/${ROUTE}] category=sessions`, { rows: sessions.length, supabaseError: error?.message ?? null });
    } catch (err) {
      console.log(`[api/${ROUTE}] category=sessions threw`, err);
      logPublicApiRouteError(ROUTE, "category_sessions", err);
      sessions = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "player_of_day", "potd");
      console.log(`[api/${ROUTE}] category=potd scan`, { error: error?.message ?? null, distinctIds: counts.size });
      potd = await rowsFromUuidCounts(admin, counts, region, "potd");
    } catch (err) {
      console.log(`[api/${ROUTE}] category=potd error`, err);
      logPublicApiRouteError(ROUTE, "category_potd", err);
      potd = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "goalie_of_the_day", "goalie");
      console.log(`[api/${ROUTE}] category=goalie scan`, { error: error?.message ?? null, distinctIds: counts.size });
      goalie = await rowsFromUuidCounts(admin, counts, region, "goalie");
    } catch (err) {
      console.log(`[api/${ROUTE}] category=goalie error`, err);
      goalie = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "defender_of_day", "defender");
      console.log(`[api/${ROUTE}] category=defender scan`, { error: error?.message ?? null, distinctIds: counts.size });
      defender = await rowsFromUuidCounts(admin, counts, region, "defender");
    } catch (err) {
      console.log(`[api/${ROUTE}] category=defender error`, err);
      defender = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "midfielder_of_day", "midfielder");
      console.log(`[api/${ROUTE}] category=midfielder scan`, { error: error?.message ?? null, distinctIds: counts.size });
      midfielder = await rowsFromUuidCounts(admin, counts, region, "midfielder");
    } catch (err) {
      console.log(`[api/${ROUTE}] category=midfielder error`, err);
      midfielder = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "attacker_of_day", "attacker");
      console.log(`[api/${ROUTE}] category=attacker scan`, { error: error?.message ?? null, distinctIds: counts.size });
      attacker = await rowsFromUuidCounts(admin, counts, region, "attacker");
    } catch (err) {
      console.log(`[api/${ROUTE}] category=attacker error`, err);
      attacker = [];
    }

    try {
      const goalNameCount = await fetchTournamentGoalNameCounts(admin);
      goals = profiles
        .map((p) => {
          const key = normalizeNameKey(p.first_name, p.last_name);
          if (!key) return null;
          const g = goalNameCount.get(key) ?? 0;
          return { p, goals: g };
        })
        .filter((x): x is { p: ProfileRow; goals: number } => x != null && x.goals > 0)
        .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
        .sort((a, b) => b.goals - a.goals)
        .slice(0, 25)
        .map(({ p, goals: g }) => toLeaderboardRow(p, g));
      console.log(`[api/${ROUTE}] category=goals`, { rowCount: goals.length });
    } catch (err) {
      console.log(`[api/${ROUTE}] category=goals error`, err);
      logPublicApiRouteError(ROUTE, "category_goals", err);
      goals = [];
    }

    return NextResponse.json({
      ok: true as const,
      region: region ?? "ALL",
      wins,
      sessions,
      win_rate,
      potd,
      goalie,
      defender,
      midfielder,
      attacker,
      goals,
    });
  } catch (err) {
    console.log(`[api/${ROUTE}] GET top-level failure — returning empty categories`, err);
    logPublicApiRouteError(ROUTE, "GET", err);
    return NextResponse.json({
      ...EMPTY_PAYLOAD,
      region: region ?? "ALL",
    });
  }
}
