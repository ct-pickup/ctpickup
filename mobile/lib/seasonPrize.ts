import { appAsyncStorage } from "@/lib/appAsyncStorage";
import { siteOrigin } from "@/lib/env";
import { SEASON_PRIZE_RULES_VERSION, seasonWindowFor } from "@/lib/pickup/seasonPrize";

/** Client flag. Expo only inlines EXPO_PUBLIC_* variables. Off unless the build sets it to "true". */
export const SEASON_PRIZE_ENABLED = (process.env.EXPO_PUBLIC_SEASON_PRIZE_ENABLED ?? "").trim().toLowerCase() === "true";

/** `ctpickup_season_prize_seen_2026_Q3` for season key "2026-Q3". Holds a JSON list of user ids who have seen the intro. */
export function seenStorageKey(seasonKey: string = seasonWindowFor().key): string {
  return `ctpickup_season_prize_seen_${seasonKey.replace("-", "_")}`;
}

/** Set when a brand-new account finishes signup: the intro then always shows, whatever was stored. */
const FRESH_SIGNUP_KEY = "ctpickup_season_prize_fresh_signup";

/** Users who finished the intro in this app session, so the gate never bounces back before storage is re-read. */
const seenThisSession = new Set<string>();

async function readSeen(): Promise<string[]> {
  try {
    const raw = await appAsyncStorage.getItem(seenStorageKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function markFreshSignup(): Promise<void> {
  try {
    await appAsyncStorage.setItem(FRESH_SIGNUP_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Show the intro: always right after a fresh signup, otherwise once per season per user. */
export async function shouldShowSeasonIntro(userId: string): Promise<boolean> {
  if (seenThisSession.has(userId)) return false;
  try {
    if ((await appAsyncStorage.getItem(FRESH_SIGNUP_KEY)) === "1") return true;
  } catch {
    /* fall through */
  }
  return !(await readSeen()).includes(userId);
}

export function seasonIntroSeenThisSession(userId: string | null | undefined): boolean {
  return !!userId && seenThisSession.has(userId);
}

/** Lets the player into the app for this session without recording the intro as seen (it shows again next launch). */
export function skipSeasonIntroThisSession(userId: string): void {
  seenThisSession.add(userId);
}

export async function markSeasonIntroSeen(userId: string): Promise<void> {
  seenThisSession.add(userId);
  try {
    const seen = await readSeen();
    if (!seen.includes(userId)) await appAsyncStorage.setItem(seenStorageKey(), JSON.stringify([...seen, userId]));
    await appAsyncStorage.removeItem(FRESH_SIGNUP_KEY);
  } catch {
    /* ignore */
  }
}

/** `unavailable`: the server answered 404 (flag off or route not deployed). `failed`: network, 5xx, 429 or anything else. */
export type SeasonEntryResult = { ok: true } | { ok: false; kind: "unavailable" | "failed"; error: string };

/** Records the player's entry for the current season. Safe to call again after a failure. */
export async function enterSeason(accessToken: string | null): Promise<SeasonEntryResult> {
  const origin = siteOrigin();
  if (!origin || !accessToken) return { ok: false, kind: "failed", error: "You need to be signed in. Please try again." };
  try {
    const r = await fetch(`${origin}/api/season-prize/entry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ rules_version: SEASON_PRIZE_RULES_VERSION }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 404) return { ok: false, kind: "unavailable", error: "Season entries open soon." };
    return { ok: false, kind: "failed", error: "Couldn't save your entry. Check your connection and try again." };
  } catch {
    return { ok: false, kind: "failed", error: "Couldn't save your entry. Check your connection and try again." };
  }
}

/** Whether the signed-in player has entered the current season. Only ever their own entry. */
export async function fetchSeasonEntered(accessToken: string | null): Promise<boolean> {
  const origin = siteOrigin();
  if (!SEASON_PRIZE_ENABLED || !origin || !accessToken) return false;
  try {
    const r = await fetch(`${origin}/api/season-prize/entry`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return false;
    const j = (await r.json().catch(() => null)) as { entered?: boolean } | null;
    return j?.entered === true;
  } catch {
    return false;
  }
}
