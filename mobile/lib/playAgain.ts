import { siteOrigin } from "@/lib/env";

export type PlayAgainPrefill = {
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  venue_key: string | null;
  capacity: number;
  format: string;
  fee_cents: number;
  invite_only: boolean;
  tiered_pricing: boolean;
  min_star: number | null;
  min_tier: string;
  date: string;
  time: string | null;
  time_tbd: boolean;
};

export type PlayAgainInfo = {
  eligible: boolean;
  role: "host" | "attendee" | null;
  previous_players: number;
  prefill: PlayAgainPrefill | null;
};

export type PlayAgainResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<PlayAgainResult<T>> {
  const origin = siteOrigin();
  if (!origin) return { ok: false, status: 0, error: "We couldn’t reach the server." };
  try {
    const r = await fetch(`${origin}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok || !j) return { ok: false, status: r.status, error: j?.error === "feature_off" ? "feature_off" : (j?.error ?? "Something went wrong. Try again.") };
    return { ok: true, data: j };
  } catch {
    return { ok: false, status: 0, error: "We couldn’t reach the server." };
  }
}

/** What "Play with this group again" offers this player for a finished game. */
export const fetchPlayAgain = (token: string, runId: string) => call<PlayAgainInfo>(token, "GET", `/api/sessions/play-again?run_id=${encodeURIComponent(runId)}`);

/** A player from the game asks the host to run it again. */
export const askHostToRepeat = (token: string, runId: string) => call<{ ok: boolean; notified: boolean }>(token, "POST", "/api/sessions/play-again", { run_id: runId });
