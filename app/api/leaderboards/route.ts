import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceRegionForVenueName } from "@/lib/pickup/venueServiceRegion";
import { jsonConfigErrorResponse, jsonUnexpectedErrorResponse } from "@/lib/server/publicApiRouteErrors";
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
  pickup_wins_count: number | null;
  pickup_losses_count: number | null;
};

async function fetchApprovedProfiles(admin: SupabaseClient): Promise<ProfileRow[]> {
  const columns =
    "id,first_name,last_name,username,instagram,nearest_venue,pickup_wins_count,pickup_losses_count";
  const out: ProfileRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin.from("profiles").select(columns).eq("approved", true).range(from, from + PAGE - 1);
    if (error) throw new Error(`profiles: ${error.message}`);
    const rows = (data ?? []) as ProfileRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function GET(req: Request) {
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return jsonConfigErrorResponse(ROUTE, "getSupabaseAdmin", err);
  }

  try {
    const url = new URL(req.url);
    const region = parseRegion(url.searchParams.get("region"));

    const profiles = await fetchApprovedProfiles(admin);

    const profileById = new Map(profiles.map((p) => [p.id, p]));

    // --- Category 2: sessions (confirmed RSVP on completed runs) ---
    const completedRunIds = new Set<string>();
    let runFrom = 0;
    for (;;) {
      const { data, error } = await admin
        .from("pickup_runs")
        .select("id")
        .eq("is_completed", true)
        .range(runFrom, runFrom + PAGE - 1);
      if (error) throw new Error(`pickup_runs: ${error.message}`);
      const rows = data ?? [];
      for (const r of rows as { id: string }[]) {
        if (r.id) completedRunIds.add(r.id);
      }
      if (rows.length < PAGE) break;
      runFrom += PAGE;
    }

    const sessionCount = new Map<string, number>();
    let rsvpFrom = 0;
    for (;;) {
      const { data, error } = await admin
        .from("pickup_run_rsvps")
        .select("user_id,run_id")
        .eq("status", "confirmed")
        .range(rsvpFrom, rsvpFrom + PAGE - 1);
      if (error) throw new Error(`pickup_run_rsvps: ${error.message}`);
      const rows = (data ?? []) as { user_id: string; run_id: string }[];
      for (const row of rows) {
        if (!row.user_id || !row.run_id) continue;
        if (!completedRunIds.has(row.run_id)) continue;
        sessionCount.set(row.user_id, (sessionCount.get(row.user_id) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
      rsvpFrom += PAGE;
    }

    // --- Categories 4 & 6–9: run result “of the day” awards (one scan) ---
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
      if (error) throw new Error(`pickup_run_results: ${error.message}`);
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

    // --- Category 5: tournament goals by scorer_name ---
    const goalNameCount = new Map<string, number>();
    let goalFrom = 0;
    for (;;) {
      const { data, error } = await admin
        .from("tournament_match_goals")
        .select("scorer_name")
        .range(goalFrom, goalFrom + PAGE - 1);
      if (error) throw new Error(`tournament_match_goals: ${error.message}`);
      const rows = (data ?? []) as { scorer_name: string | null }[];
      for (const row of rows) {
        const key = normalizeScorerName(row.scorer_name);
        if (!key) continue;
        goalNameCount.set(key, (goalNameCount.get(key) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
      goalFrom += PAGE;
    }

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

    // Category 1 — Most wins
    const winsCandidates = profiles
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

    // Category 2 — Sessions
    const sessionsRows: LeaderboardPlayerRow[] = [];
    const sessionEntries = [...sessionCount.entries()]
      .filter(([, n]) => n >= 5)
      .sort((a, b) => b[1] - a[1]);
    for (const [userId, n] of sessionEntries) {
      const p = profileById.get(userId);
      if (!p) continue;
      if (!passesRegionFilter(p.nearest_venue, region)) continue;
      sessionsRows.push(toRow(p, n));
      if (sessionsRows.length >= 25) break;
    }

    // Category 3 — Win rate
    const rateRows: LeaderboardPlayerRow[] = profiles
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

    // Category 4 — POTD
    const potdRows = buildAwardRows(potdCount);
    // Category 6 — Goalie of the Day
    const goalieRows = buildAwardRows(gotdCount);
    // Category 7 — Defender of the Day
    const defenderRows = buildAwardRows(dotdCount);
    // Category 8 — Midfielder of the Day
    const midfielderRows = buildAwardRows(motdCount);
    // Category 9 — Attacker of the Day
    const attackerRows = buildAwardRows(aotdCount);

    // Category 5 — Tournament goals (name match)
    const goalsRows: LeaderboardPlayerRow[] = profiles
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

    return NextResponse.json({
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
