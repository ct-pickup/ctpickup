import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { isSeasonPrizeEnabled, SEASON_PRIZE_MIN_GAMES, SEASON_PRIZE_USD, seasonWindowFor } from "@/lib/pickup/seasonPrize";
import { adminPrizeList, type SeasonEntrantStats } from "@/lib/season/prizeRanking";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const CHUNK = 200;

type EntryRow = { user_id: string; accepted_at: string; disqualified_at?: string | null; disqualified_reason?: string | null };

async function loadEntries(admin: ReturnType<typeof supabaseService>, seasonKey: string): Promise<EntryRow[] | null> {
  const full = await admin
    .from("season_prize_entries")
    .select("user_id,accepted_at,disqualified_at,disqualified_reason")
    .eq("season_key", seasonKey);
  if (!full.error) return (full.data ?? []) as EntryRow[];
  // Before 20261010000000 runs the disqualification columns do not exist: read entries without them.
  const basic = await admin.from("season_prize_entries").select("user_id,accepted_at").eq("season_key", seasonKey);
  return basic.error ? null : ((basic.data ?? []) as EntryRow[]);
}

/**
 * GET /api/admin/season-prize
 * The top 10 eligible entrants for the current season in prize order (points, wins, Player of the Day awards,
 * earliest entry), with the first marked as the current winner, plus the disqualified entrants.
 * Admin only, checked here on the server.
 */
export async function GET(req: Request) {
  if (!isSeasonPrizeEnabled()) return NOT_FOUND();
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = supabaseService();
  const season = seasonWindowFor();

  const entries = await loadEntries(admin, season.key);
  if (!entries) return NextResponse.json({ error: "Could not load entries." }, { status: 500 });
  const ids = entries.map((e) => e.user_id);

  const stats = new Map<string, { points: number; wins: number; potd: number; games: number }>();
  const names = new Map<string, { name: string; banned: boolean }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const [ledger, profiles] = await Promise.all([
      admin.from("points_events").select("user_id,reason,points").eq("season", season.label).in("user_id", chunk),
      admin.from("profiles").select("id,first_name,last_name,is_banned").in("id", chunk),
    ]);
    if (ledger.error || profiles.error) return NextResponse.json({ error: "Could not load standings." }, { status: 500 });
    for (const row of ledger.data ?? []) {
      const r = row as { user_id: string; reason: string; points: number };
      const s = stats.get(r.user_id) ?? { points: 0, wins: 0, potd: 0, games: 0 };
      s.points += Number(r.points) || 0;
      if (r.reason === "win") s.wins += 1;
      else if (r.reason === "potd") s.potd += 1;
      else if (r.reason === "played") s.games += 1;
      stats.set(r.user_id, s);
    }
    for (const row of profiles.data ?? []) {
      const p = row as { id: string; first_name: string | null; last_name: string | null; is_banned: boolean | null };
      names.set(p.id, { name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Player", banned: p.is_banned === true });
    }
  }

  const entrants: SeasonEntrantStats[] = entries.map((e) => {
    const s = stats.get(e.user_id) ?? { points: 0, wins: 0, potd: 0, games: 0 };
    return { user_id: e.user_id, ...s, accepted_at: e.accepted_at, disqualified: e.disqualified_at != null, in_good_standing: !names.get(e.user_id)?.banned };
  });

  const label = (id: string) => names.get(id)?.name ?? "Player";
  return NextResponse.json(
    {
      season: { key: season.key, label: season.label },
      prize_usd: SEASON_PRIZE_USD,
      min_games: SEASON_PRIZE_MIN_GAMES,
      entrants_total: entries.length,
      top: adminPrizeList(entrants).map((e) => ({ ...e, name: label(e.user_id) })),
      disqualified: entries
        .filter((e) => e.disqualified_at != null)
        .map((e) => ({ user_id: e.user_id, name: label(e.user_id), reason: e.disqualified_reason ?? null })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** POST { user_id, disqualified: boolean, reason? }: disqualify or reinstate an entrant for the current season. */
export async function POST(req: Request) {
  if (!isSeasonPrizeEnabled()) return NOT_FOUND();
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as { user_id?: unknown; disqualified?: unknown; reason?: unknown } | null;
  const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  if (!userId || typeof body?.disqualified !== "boolean") {
    return NextResponse.json({ error: "user_id and disqualified are required." }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) || null : null;

  const patch = body.disqualified
    ? { disqualified_at: new Date().toISOString(), disqualified_by: guard.userId, disqualified_reason: reason }
    : { disqualified_at: null, disqualified_by: null, disqualified_reason: null };

  const { data, error } = await supabaseService()
    .from("season_prize_entries")
    .update(patch)
    .eq("user_id", userId)
    .eq("season_key", seasonWindowFor().key)
    .select("user_id");
  if (error) return NextResponse.json({ error: "Could not update this entrant. Has the latest migration run?" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "No entry for that player this season." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
