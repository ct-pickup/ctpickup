import { siteOrigin } from "@/lib/env";

export type PlayedWithPerson = { first_name: string | null; avatar_url: string | null };
export type PlayedWithSummary = { count: number; people: PlayedWithPerson[] };

export type BestGame = {
  id: string;
  title: string | null;
  start_at: string;
  time_tbd?: boolean;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  spots_taken: number;
  fee_cents: number;
  format: string | null;
  run_type: string | null;
  status: string | null;
  reasons: string[];
  played_with: PlayedWithSummary;
};

export type FillCandidate = {
  invite_token: string;
  first_name: string;
  last_initial: string | null;
  stars: number | null;
  position: string | null;
  town: string | null;
  invited: boolean;
};

export type FillCandidatesResult = {
  candidates: FillCandidate[];
  invites_available: boolean;
  invites_sent: number;
  invite_limit: number;
};

export type MatchResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export const PLAYED_WITH_MAX_RUNS = 40;

function errorFrom(json: unknown, status: number): string {
  if (json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string") {
    return (json as { error: string }).error;
  }
  if (status === 401) return "Sign in again to continue.";
  if (status >= 500) return "Server error. Try again in a moment.";
  return "Something went wrong. Try again.";
}

async function call<T>(accessToken: string, path: string, init?: { method: "POST"; body: unknown }): Promise<MatchResult<T>> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, status: 0, error: "App configuration error. Try again later." };
  try {
    const r = await fetch(`${origin}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(init ? { "Content-Type": "application/json" } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const json = (await r.json().catch(() => null)) as unknown;
    if (!r.ok) return { ok: false, status: r.status, error: errorFrom(json, r.status) };
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Network error. Try again." };
  }
}

export async function fetchBestGames(accessToken: string, limit = 3): Promise<MatchResult<BestGame[]>> {
  const res = await call<{ games?: BestGame[] }>(accessToken, `/api/match/best-games?limit=${limit}`);
  return res.ok ? { ok: true, data: res.data.games ?? [] } : res;
}

export async function fetchPlayedWith(
  accessToken: string,
  runIds: string[],
): Promise<MatchResult<Record<string, PlayedWithSummary>>> {
  const ids = Array.from(new Set(runIds.filter(Boolean)));
  const out: Record<string, PlayedWithSummary> = {};
  for (let i = 0; i < ids.length; i += PLAYED_WITH_MAX_RUNS) {
    const chunk = ids.slice(i, i + PLAYED_WITH_MAX_RUNS);
    const res = await call<{ runs?: Record<string, PlayedWithSummary> }>(
      accessToken,
      `/api/match/played-with?run_ids=${chunk.map(encodeURIComponent).join(",")}`,
    );
    if (!res.ok) return res;
    Object.assign(out, res.data.runs ?? {});
  }
  return { ok: true, data: out };
}

export function fetchFillCandidates(accessToken: string, runId: string): Promise<MatchResult<FillCandidatesResult>> {
  return call<FillCandidatesResult>(accessToken, `/api/match/fill-candidates?run_id=${encodeURIComponent(runId)}`);
}

export function postMatchInvite(
  accessToken: string,
  runId: string,
  inviteToken: string,
): Promise<MatchResult<{ ok: true; already_invited: boolean; invites_sent: number; invite_limit: number }>> {
  return call(accessToken, "/api/match/invite", { method: "POST", body: { run_id: runId, invite_token: inviteToken } });
}

/**
 * One-line social copy for cards: "Played with Kofi", "Played with Kofi and Liam", "Played with Kofi +2".
 * Falls back to the "+N" form when the two-name form would be long, so it never needs an ellipsis.
 */
export function playedWithShort(summary: PlayedWithSummary): string | null {
  if (summary.count <= 0) return null;
  const names = summary.people.map((p) => p.first_name?.trim() || "A player");
  const a = names[0] ?? "A player";
  if (summary.count === 1) return `Played with ${a}`;
  const b = names[1] ?? "a player";
  if (summary.count === 2 && a.length + b.length <= 14) return `Played with ${a} and ${b}`;
  return `Played with ${a} +${summary.count - 1}`;
}

/** "Jude, you've played with" / "Jude and Dylan, you've played with" / "Jude, Dylan + 2 you've played with". */
export function playedWithLine(summary: PlayedWithSummary): string | null {
  if (summary.count <= 0) return null;
  const names = summary.people.map((p) => p.first_name?.trim() || "A player");
  const a = names[0] ?? "A player";
  const b = names[1] ?? "a player";
  if (summary.count === 1) return `${a}, you've played with`;
  if (summary.count === 2) return `${a} and ${b}, you've played with`;
  return `${a}, ${b} + ${summary.count - 2} you've played with`;
}
