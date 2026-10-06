import { siteOrigin } from "@/lib/env";

/** Mirrors lib/records/gameLog.ts: the signed-in player's own detailed game log (CT+). */
export type RatingDirection = "up" | "down" | "flat";

export type GameLogEntry = {
  run_id: string;
  start_at: string | null;
  season: string | null;
  venue: string | null;
  outcome: "W" | "D" | "L" | null;
  score: string | null;
  teammates: string[];
  awards: string[];
  points: number | null;
  rating: RatingDirection | null;
};

export type TeammateRecord = { name: string; games: number; wins: number; draws: number; losses: number };

export type GameLogInsights = {
  currentWinStreak: number;
  longestWinStreak: number;
  teammates: TeammateRecord[];
  ratingTrend: { shape: number[]; seasonBreaks: number[] } | null;
};

export type GameLogPage = { games: GameLogEntry[]; nextCursor: string | null; total: number; insights: GameLogInsights | null };

/** One page of the log; insights come with the first page only. Null when the server cannot be reached. */
export async function fetchGameLog(accessToken: string, cursor: string | null): Promise<GameLogPage | null> {
  const origin = siteOrigin();
  if (!origin) return null;
  try {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const r = await fetch(`${origin}/api/player/game-log${q}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as (Partial<GameLogPage> & { ok?: boolean }) | null;
    if (!r.ok || j?.ok !== true || !Array.isArray(j.games)) return null;
    return { games: j.games, nextCursor: j.nextCursor ?? null, total: Number(j.total ?? j.games.length), insights: j.insights ?? null };
  } catch {
    return null;
  }
}

/** "Under 1 win in a row" style helpers kept out of the screen. */
export function directionWord(d: RatingDirection | null): string | null {
  return d === "up" ? "Up" : d === "down" ? "Down" : d === "flat" ? "Flat" : null;
}
