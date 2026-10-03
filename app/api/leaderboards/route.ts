import { NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { jsonConfigErrorResponse, logPublicApiRouteError } from "@/lib/server/publicApiRouteErrors";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { HUB_REGIONS } from "@/lib/pickup/hubRegions";
import { currentSeason } from "@/lib/pickup/points";
import { isLegacyMobileClient, LEGACY_TIER_RATING_COLUMNS, legacyTierRowFields } from "@/lib/api/appVersion";
import { DiscoverError, checkSearchRate } from "@/lib/discover/discoverService";
import { capRanked, LEADERBOARD_TOP_N } from "@/lib/leaderboards/cap";
import { loadPlayHistory } from "@/lib/match/compatibilityData";
import { loadRecordSummaries, summaryFor, type PlayerRecordSummary } from "@/lib/records/playerRecord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "leaderboards";
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
  /** True position in the full category (set by the cap). */
  rank?: number;
};

function parseRegion(param: string | null): string | null {
  if (!param) return null;
  const u = param.trim().toUpperCase();
  // "ALL" / empty → no filter (every hub: CT/NY/NJ/MD)
  if (!u || u === "ALL") return null;
  return HUB_REGIONS.has(u) ? u : null;
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
  const limit = 1000;
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
  }
  console.log(`[api/${ROUTE}] category=sessions result`, { rawRows: rows.length, rowCount: out.length });
  return { rows: out, error: null };
}

/** Points categories for the new app, from the record helper (points_events ledger). */
function pointsFromRecords(
  profiles: ProfileRow[],
  records: Map<string, PlayerRecordSummary>,
  region: string | null,
  key: "season_points" | "all_time_points",
): LeaderboardPlayerRow[] {
  return profiles
    .filter((p) => passesRegionFilter(p.nearest_venue, region))
    .map((p) => ({ p, r: summaryFor(records, p.id) }))
    .filter(({ r }) => r[key] > 0)
    .sort((a, b) => b.r[key] - a.r[key] || b.r.games - a.r.games)
    .map(({ p, r }) => toLeaderboardRow(p, r[key], { games_played: r.games }));
}

/** Sessions category for the new app: games played from posted results, 5 or more. */
function sessionsFromRecords(
  profiles: ProfileRow[],
  records: Map<string, PlayerRecordSummary>,
  region: string | null,
): LeaderboardPlayerRow[] {
  return profiles
    .filter((p) => passesRegionFilter(p.nearest_venue, region))
    .map((p) => ({ p, games: summaryFor(records, p.id).games }))
    .filter(({ games }) => games >= 5)
    .sort((a, b) => b.games - a.games)
    .map(({ p, games }) => toLeaderboardRow(p, games));
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

type TierLeaderboardRow = {
  user_id: string;
  sessions: number;
  /** Current-season points from the points_events ledger (new app only). */
  points?: number;
  tier?: string;
  score?: number;
  reliability?: number;
  /** Games played from posted results (new app only). */
  games?: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  nearest_venue: string | null;
  /** New app: half-star rating from player_ratings (null when unrated or the column is missing). */
  star?: number | null;
  provisional?: boolean;
  /** True position in the full Stars ranking (set by the cap). */
  rank?: number;
};

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
  tiers: [] as TierLeaderboardRow[],
};

/** New-app-only categories; v1.3.5 never receives these keys. */
const EMPTY_POINTS_PAYLOAD = {
  points: [] as LeaderboardPlayerRow[],
  points_all_time: [] as LeaderboardPlayerRow[],
};

/**
 * Rankings tab: all player_ratings (admin bypasses RLS own_rating), merged with profiles.
 * The new app gets sessions here and season points from the record helper in GET. Clients read stars and
 * percentile from player_cards.
 */
async function fetchTierLeaderboard(
  admin: SupabaseClient,
  region: string | null,
  legacy: boolean,
): Promise<TierLeaderboardRow[]> {
  const { data: ratings, error } = await admin
    .from("player_ratings")
    .select(legacy ? LEGACY_TIER_RATING_COLUMNS : "user_id,sessions")
    .order("score", { ascending: false })
    .limit(253);

  if (error) {
    logSupabaseCategory("player_ratings.tier_leaderboard", error);
    return [];
  }

  const ratingRows = (ratings ?? []) as unknown as Array<{
    user_id: string;
    tier: string | null;
    sessions: number | null;
    score?: number | null;
    reliability?: number | null;
  }>;
  console.log(`[api/${ROUTE}] category=tiers ratings`, { count: ratingRows.length });

  const ids = Array.from(new Set(ratingRows.map((r) => r.user_id).filter(Boolean)));
  const profileById = new Map<
    string,
    {
      first_name: string | null;
      last_name: string | null;
      username: string | null;
      avatar_url: string | null;
      nearest_venue: string | null;
    }
  >();

  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: profiles, error: pErr } = await admin
      .from("profiles")
      .select("id,first_name,last_name,username,avatar_url,nearest_venue")
      .in("id", chunk);
    if (pErr) {
      logSupabaseCategory("profiles.tier_leaderboard", pErr);
      continue;
    }
    for (const p of (profiles ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      username: string | null;
      avatar_url: string | null;
      nearest_venue: string | null;
    }>) {
      profileById.set(p.id, p);
    }
  }
  console.log(`[api/${ROUTE}] category=tiers profiles`, { count: profileById.size });

  const out: TierLeaderboardRow[] = [];
  for (const r of ratingRows) {
    const p = profileById.get(r.user_id);
    const nearest = p?.nearest_venue ?? null;
    if (!passesRegionFilter(nearest, region)) continue;
    out.push({
      user_id: r.user_id,
      sessions: r.sessions ?? 0,
      ...(legacy ? legacyTierRowFields(r) : {}),
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      username: p?.username ?? null,
      avatar_url: p?.avatar_url?.trim() || null,
      nearest_venue: nearest,
    });
  }

  // Region filter may drop rows; clients sort by stars, then season points.
  console.log(`[api/${ROUTE}] category=tiers result`, { rowCount: out.length });
  return out;
}

/**
 * Stars ranking for the new app: every rated approved player, best first, ordered the way the app has always
 * sorted it (half-star rating, then current-season points; unrated players last). Only the cap decides who is
 * returned; this returns the whole ordered list so a player's true rank is known.
 */
async function fetchStarRanking(
  admin: SupabaseClient,
  profiles: ProfileRow[],
  records: Map<string, PlayerRecordSummary>,
  region: string | null,
): Promise<TierLeaderboardRow[]> {
  const byId = new Map(profiles.map((p) => [p.id, p] as const));
  type RatingRow = { user_id: string; sessions: number | null; star_rating?: number | string | null; star_provisional?: boolean | null };
  const ratings: RatingRow[] = [];
  for (const columns of ["user_id,sessions,star_rating,star_provisional", "user_id,sessions"]) {
    ratings.length = 0;
    let from = 0;
    let failed = false;
    for (;;) {
      const { data, error } = await admin.from("player_ratings").select(columns).range(from, from + PAGE - 1);
      if (error) {
        logSupabaseCategory(`player_ratings.stars(${columns})`, error);
        failed = true;
        break;
      }
      const rows = (data ?? []) as unknown as RatingRow[];
      ratings.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    if (!failed) break;
  }

  const out: TierLeaderboardRow[] = [];
  for (const r of ratings) {
    const p = byId.get(r.user_id);
    if (!p || !passesRegionFilter(p.nearest_venue, region)) continue;
    const star = r.star_rating == null ? null : Number(r.star_rating);
    const rec = summaryFor(records, r.user_id);
    out.push({
      user_id: r.user_id,
      sessions: r.sessions ?? 0,
      points: rec.season_points,
      games: rec.games,
      first_name: p.first_name,
      last_name: p.last_name,
      username: p.username,
      avatar_url: null,
      nearest_venue: p.nearest_venue,
      star: star != null && Number.isFinite(star) ? star : null,
      provisional: r.star_provisional === true,
    });
  }
  out.sort((a, b) => (b.star ?? -1) - (a.star ?? -1) || (b.points ?? 0) - (a.points ?? 0));
  return out;
}

/** Fills avatar_url for the few rows that are actually returned. */
async function fillAvatars(admin: SupabaseClient, rows: TierLeaderboardRow[]): Promise<void> {
  const ids = Array.from(new Set(rows.map((r) => r.user_id)));
  if (ids.length === 0) return;
  const { data, error } = await admin.from("profiles").select("id,avatar_url").in("id", ids);
  if (error) {
    logSupabaseCategory("profiles.avatars", error);
    return;
  }
  const byId = new Map(((data ?? []) as Array<{ id: string; avatar_url: string | null }>).map((p) => [p.id, p.avatar_url?.trim() || null] as const));
  for (const r of rows) r.avatar_url = byId.get(r.user_id) ?? null;
}

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() || null : null;
}

export async function GET(req: Request) {
  console.log("[leaderboards] GET hit");

  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  const url = new URL(req.url);
  const region = parseRegion(url.searchParams.get("region"));

  // Optional sign-in: with a valid token the response also carries the requester's own rank and the players they
  // have played with. Without one (the v1.3.5 app, web) only the top rows are returned.
  let viewerId: string | null = null;
  const token = bearer(req);
  if (token) {
    try {
      const { data: u } = await admin.auth.getUser(token);
      viewerId = u.user?.id ?? null;
    } catch {
      viewerId = null;
    }
  }
  if (viewerId) {
    try {
      // Same hourly allowance as Discover search (discover_search_usage).
      await checkSearchRate(admin, viewerId);
    } catch (err) {
      if (err instanceof DiscoverError) return NextResponse.json({ error: err.message }, { status: err.status });
    }
  }
  let playedWith = new Set<string>();
  if (viewerId) {
    try {
      const history = await loadPlayHistory(admin, [viewerId]);
      if (!history.error) playedWith = history.byUser.get(viewerId)?.playedWith ?? new Set<string>();
    } catch (err) {
      logPublicApiRouteError(ROUTE, "played_with", err);
    }
  }

  let wins: LeaderboardPlayerRow[] = [];
  let sessions: LeaderboardPlayerRow[] = [];
  let win_rate: LeaderboardPlayerRow[] = [];
  let potd: LeaderboardPlayerRow[] = [];
  let goalie: LeaderboardPlayerRow[] = [];
  let defender: LeaderboardPlayerRow[] = [];
  let midfielder: LeaderboardPlayerRow[] = [];
  let attacker: LeaderboardPlayerRow[] = [];
  let goals: LeaderboardPlayerRow[] = [];
  let tiers: TierLeaderboardRow[] = [];
  let points: LeaderboardPlayerRow[] = [];
  let points_all_time: LeaderboardPlayerRow[] = [];

  // Records come from posted results for the new app; v1.3.5 keeps the stored counters below.
  const legacyClient = isLegacyMobileClient(req);
  let records: Map<string, PlayerRecordSummary> | null = null;
  if (!legacyClient) {
    try {
      records = await loadRecordSummaries(admin);
    } catch (err) {
      console.log(`[api/${ROUTE}] records failed`, err);
      logPublicApiRouteError(ROUTE, "records", err);
      records = new Map();
    }
  }

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

    try {
      if (records) {
        const recs = records;
        const withRecords = profiles
          .filter((p) => passesRegionFilter(p.nearest_venue, region))
          .map((p) => ({ p, r: summaryFor(recs, p.id) }))
          .filter(({ r }) => r.games >= 10);
        wins = withRecords
          .filter(({ r }) => r.wins > 0)
          .sort((a, b) => b.r.wins - a.r.wins)
          .map(({ p, r }) => toLeaderboardRow(p, r.wins, { games_played: r.games }));
        win_rate = withRecords
          .sort((a, b) => (b.r.win_pct ?? 0) - (a.r.win_pct ?? 0) || b.r.games - a.r.games)
          .map(({ p, r }) =>
            toLeaderboardRow(p, Math.round((r.win_pct ?? 0) * 1000) / 10, { win_rate: r.win_pct ?? 0, games_played: r.games }),
          );
      } else if (hasWinLossColumns) {
        wins = profiles
          .map((p) => {
            const w = Math.max(0, Math.trunc(Number(p.pickup_wins_count ?? 0)));
            const l = Math.max(0, Math.trunc(Number(p.pickup_losses_count ?? 0)));
            return { p, w, games: w + l };
          })
          .filter(({ w, games }) => w > 0 && games >= 10)
          .filter(({ p }) => passesRegionFilter(p.nearest_venue, region))
          .sort((a, b) => b.w - a.w)
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
      console.log("[leaderboards] category wins result", wins.length);
      console.log("[leaderboards] category win_rate result", win_rate.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=wins_win_rate error`, err);
      logPublicApiRouteError(ROUTE, "category_wins_win_rate", err);
      wins = [];
      win_rate = [];
    }

    try {
      const { rows, error } = records
        ? { rows: sessionsFromRecords(profiles, records, region), error: null }
        : await fetchSessionsLeaderboard(admin, region);
      sessions = rows;
      console.log(`[api/${ROUTE}] category=sessions`, { rows: sessions.length, supabaseError: error?.message ?? null });
      console.log("[leaderboards] category sessions result", sessions.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=sessions threw`, err);
      logPublicApiRouteError(ROUTE, "category_sessions", err);
      sessions = [];
    }

    if (records) {
      try {
        points = pointsFromRecords(profiles, records, region, "season_points");
        points_all_time = pointsFromRecords(profiles, records, region, "all_time_points");
      } catch (err) {
        logPublicApiRouteError(ROUTE, "category_points", err);
        points = [];
        points_all_time = [];
      }
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "player_of_day", "potd");
      console.log(`[api/${ROUTE}] category=potd scan`, { error: error?.message ?? null, distinctIds: counts.size });
      potd = await rowsFromUuidCounts(admin, counts, region, "potd");
      console.log("[leaderboards] category potd result", potd.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=potd error`, err);
      logPublicApiRouteError(ROUTE, "category_potd", err);
      potd = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "goalie_of_the_day", "goalie");
      console.log(`[api/${ROUTE}] category=goalie scan`, { error: error?.message ?? null, distinctIds: counts.size });
      goalie = await rowsFromUuidCounts(admin, counts, region, "goalie");
      console.log("[leaderboards] category goalie result", goalie.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=goalie error`, err);
      goalie = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "defender_of_day", "defender");
      console.log(`[api/${ROUTE}] category=defender scan`, { error: error?.message ?? null, distinctIds: counts.size });
      defender = await rowsFromUuidCounts(admin, counts, region, "defender");
      console.log("[leaderboards] category defender result", defender.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=defender error`, err);
      defender = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "midfielder_of_day", "midfielder");
      console.log(`[api/${ROUTE}] category=midfielder scan`, { error: error?.message ?? null, distinctIds: counts.size });
      midfielder = await rowsFromUuidCounts(admin, counts, region, "midfielder");
      console.log("[leaderboards] category midfielder result", midfielder.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=midfielder error`, err);
      midfielder = [];
    }

    try {
      const { counts, error } = await countPickupRunResultsUuidColumn(admin, "attacker_of_day", "attacker");
      console.log(`[api/${ROUTE}] category=attacker scan`, { error: error?.message ?? null, distinctIds: counts.size });
      attacker = await rowsFromUuidCounts(admin, counts, region, "attacker");
      console.log("[leaderboards] category attacker result", attacker.length);
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
        .map(({ p, goals: g }) => toLeaderboardRow(p, g));
      console.log(`[api/${ROUTE}] category=goals`, { rowCount: goals.length });
      console.log("[leaderboards] category goals result", goals.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=goals error`, err);
      logPublicApiRouteError(ROUTE, "category_goals", err);
      goals = [];
    }

    try {
      // TODO: Remove after v1.3.5 usage drops to near zero once the new build ships; target 2026-12-01.
      if (records) {
        tiers = await fetchStarRanking(admin, profiles, records, region);
      } else {
        tiers = await fetchTierLeaderboard(admin, region, isLegacyMobileClient(req));
      }
      console.log("[leaderboards] category tiers result", tiers.length);
    } catch (err) {
      console.log(`[api/${ROUTE}] category=tiers error`, err);
      logPublicApiRouteError(ROUTE, "category_tiers", err);
      tiers = [];
    }

    // Cap every category: top rows, plus the requester's own row and players they have played with,
    // each with its true rank. Nobody else is returned.
    const cap = <T extends { id: string }>(list: T[]) => capRanked(list, (r) => r.id, viewerId, playedWith);
    const cWins = cap(wins);
    const cSessions = cap(sessions);
    const cWinRate = cap(win_rate);
    const cPotd = cap(potd);
    const cGoalie = cap(goalie);
    const cDefender = cap(defender);
    const cMidfielder = cap(midfielder);
    const cAttacker = cap(attacker);
    const cGoals = cap(goals);
    const cPoints = cap(points);
    const cPointsAll = cap(points_all_time);
    const cTiers = capRanked(tiers, (r) => r.user_id, viewerId, playedWith);
    if (records) await fillAvatars(admin, cTiers.rows);

    return NextResponse.json({
      ok: true as const,
      region: region ?? "ALL",
      wins: cWins.rows,
      sessions: cSessions.rows,
      win_rate: cWinRate.rows,
      potd: cPotd.rows,
      goalie: cGoalie.rows,
      defender: cDefender.rows,
      midfielder: cMidfielder.rows,
      attacker: cAttacker.rows,
      goals: cGoals.rows,
      // v1.3.5 row shape stays exactly as before (no rank, no totals).
      tiers: legacyClient
        ? cTiers.rows.map((r) => {
            const legacyRow: TierLeaderboardRow = { ...r };
            delete legacyRow.rank;
            return legacyRow;
          })
        : cTiers.rows,
      ...(legacyClient
        ? {}
        : {
      top_n: LEADERBOARD_TOP_N,
      totals: {
        wins: cWins.total,
        sessions: cSessions.total,
        win_rate: cWinRate.total,
        potd: cPotd.total,
        goalie: cGoalie.total,
        defender: cDefender.total,
        midfielder: cMidfielder.total,
        attacker: cAttacker.total,
        goals: cGoals.total,
        points: cPoints.total,
        points_all_time: cPointsAll.total,
        tiers: cTiers.total,
      },
        }),
      ...(legacyClient ? {} : { season: currentSeason(), points: cPoints.rows, points_all_time: cPointsAll.rows }),
    });
  } catch (err) {
    console.log(`[api/${ROUTE}] GET top-level failure — returning empty categories`, err);
    logPublicApiRouteError(ROUTE, "GET", err);
    return NextResponse.json({
      ...EMPTY_PAYLOAD,
      ...(legacyClient ? {} : { season: currentSeason(), ...EMPTY_POINTS_PAYLOAD }),
      region: region ?? "ALL",
    });
  }
}
