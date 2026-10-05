import { siteOrigin } from "@/lib/env";
import type { DirectoryResponse, DiscoverPlayer, DiscoverResponse, SearchResponse } from "@shared/discover";

/** Plain-words failure the Discover screen can show as-is. */
export class DiscoverRequestError extends Error {}

const OFFLINE = "We could not reach the server. Check your connection and try again.";

async function get<T>(path: string, accessToken: string, fallback: string): Promise<T> {
  const origin = siteOrigin();
  if (!origin) throw new DiscoverRequestError(OFFLINE);

  let res: Response;
  try {
    res = await fetch(`${origin}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new DiscoverRequestError(OFFLINE);
  }

  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) {
    throw new DiscoverRequestError(typeof json?.error === "string" ? json.error : fallback);
  }
  return json;
}

/** The viewer's five picks for the week. */
export async function fetchWeeklyPicks(accessToken: string): Promise<DiscoverResponse> {
  return get<DiscoverResponse>("/api/discover", accessToken, "We could not load your picks right now.");
}

/** Exact full name or exact @username. Anything partial comes back empty. */
export async function searchPlayers(accessToken: string, query: string): Promise<DiscoverPlayer[]> {
  const res = await get<SearchResponse>(
    `/api/discover/search?q=${encodeURIComponent(query)}`,
    accessToken,
    "We could not run that search right now.",
  );
  return Array.isArray(res.players) ? res.players : [];
}

export type DirectoryFilters = {
  /** "Keeper", "Defender", "Midfielder" or "Attacker", or null for any. */
  position: string | null;
  minStar: number | null;
  maxStar: number | null;
  maxDrive: number | null;
};

/** One page of the player directory (20 players) and the cursor for the next. */
export async function fetchDirectory(accessToken: string, filters: DirectoryFilters, cursor: string | null): Promise<DirectoryResponse> {
  const q = new URLSearchParams();
  if (filters.position) q.set("position", filters.position);
  if (filters.minStar != null) q.set("min_star", String(filters.minStar));
  if (filters.maxStar != null) q.set("max_star", String(filters.maxStar));
  if (filters.maxDrive != null) q.set("max_drive", String(filters.maxDrive));
  if (cursor) q.set("cursor", cursor);
  const qs = q.toString();
  const res = await get<DirectoryResponse>(`/api/discover/directory${qs ? `?${qs}` : ""}`, accessToken, "We could not load players right now.");
  return { players: Array.isArray(res.players) ? res.players : [], nextCursor: typeof res.nextCursor === "string" ? res.nextCursor : null };
}
