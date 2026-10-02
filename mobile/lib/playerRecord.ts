import { siteOrigin } from "@/lib/env";
import type { PlayerOutcome } from "@/lib/pickup/resultOutcome";

/** Mirrors lib/records/playerRecord.ts: every record shown in the app comes from /api/player/record. */
export type RecordGame = {
  run_id: string;
  start_at: string | null;
  title: string | null;
  location_text: string | null;
  team: string | null;
  outcome: PlayerOutcome | null;
  score: string | null;
  potd: boolean;
};

export type PlayerRecordSummary = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  win_pct: number | null;
  potd_count: number;
};

export type PlayerRecord = PlayerRecordSummary & { form: PlayerOutcome[]; log: RecordGame[] };

export const EMPTY_RECORD_SUMMARY: PlayerRecordSummary = { games: 0, wins: 0, draws: 0, losses: 0, win_pct: null, potd_count: 0 };

const OWN_TTL_MS = 30 * 1000;
let own: { token: string; at: number; promise: Promise<PlayerRecord | null> } | null = null;

/** Drop the cached own record (after posting or editing a result). */
export function invalidateMyRecord(): void {
  own = null;
}

async function getJson(path: string, accessToken: string): Promise<Record<string, unknown> | null> {
  const origin = siteOrigin();
  if (!origin) return null;
  try {
    const r = await fetch(`${origin}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return r.ok && j?.ok === true ? j : null;
  } catch {
    return null;
  }
}

/** The caller's record, form strip and match log. Shared for 30 s by the Games tab, Profile and recaps. */
export function fetchMyRecord(accessToken: string, opts: { fresh?: boolean } = {}): Promise<PlayerRecord | null> {
  const now = Date.now();
  if (!opts.fresh && own && own.token === accessToken && now - own.at < OWN_TTL_MS) return own.promise;
  const promise = getJson("/api/player/record", accessToken).then((j) => (j?.record as PlayerRecord | undefined) ?? null);
  own = { token: accessToken, at: now, promise };
  void promise.then((r) => {
    if (!r && own?.promise === promise) own = null;
  });
  return promise;
}

/** Another player's summary, to the extent the leaderboards show it. */
export async function fetchRecordSummary(accessToken: string, userId: string): Promise<PlayerRecordSummary | null> {
  const j = await getJson(`/api/player/record?userId=${encodeURIComponent(userId)}`, accessToken);
  return (j?.summary as PlayerRecordSummary | undefined) ?? null;
}

export async function fetchRecordSummaries(accessToken: string, userIds: string[]): Promise<Record<string, PlayerRecordSummary>> {
  const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, 200);
  if (!ids.length) return {};
  const j = await getJson(`/api/player/record?userIds=${ids.map(encodeURIComponent).join(",")}`, accessToken);
  return (j?.summaries as Record<string, PlayerRecordSummary> | undefined) ?? {};
}

/** Win % as a whole number, or null before the first game. */
export function winPercent(summary: PlayerRecordSummary | null | undefined): number | null {
  return summary && summary.win_pct != null ? Math.round(summary.win_pct * 100) : null;
}
