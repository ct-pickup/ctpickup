import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Test tournaments are the ones whose slug starts with "test-" (the seed in scripts/test-tournament uses "test-bracket-demo").
 * They never send a push: not "Tournament is live", not "Bracket is live", not "Vote for Match MVP", not a reminder, nothing.
 * The check lives in the one function every push goes through (lib/push/sendExpoPush.ts), keyed on the tournament id the push
 * carries, so a new tournament push path is covered the moment it names its tournament.
 */
export const TEST_TOURNAMENT_SLUG_PREFIX = "test-";

export function isTestTournamentSlug(slug: unknown): boolean {
  return typeof slug === "string" && slug.trim().toLowerCase().startsWith(TEST_TOURNAMENT_SLUG_PREFIX);
}

/** The tournament id a push payload names, or null when it names none. */
export function tournamentIdOfPush(data: Record<string, unknown> | undefined): string | null {
  const id = data?.tournament_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * True when this push belongs to a test tournament and must not be sent. A push that names no tournament is never held back.
 * If the lookup itself fails the push goes out: a database hiccup must not silence a real tournament's notifications, and the
 * test accounts are staff or friends who agreed to receive them.
 */
export async function pushIsForTestTournament(
  admin: SupabaseClient,
  data: Record<string, unknown> | undefined,
): Promise<boolean> {
  const id = tournamentIdOfPush(data);
  if (!id) return false;
  try {
    const { data: row, error } = await admin.from("tournaments").select("slug").eq("id", id).maybeSingle();
    if (error) {
      console.warn(JSON.stringify({ tag: "expo-push", message: "test tournament check failed; sending", error: error.message }));
      return false;
    }
    return isTestTournamentSlug((row as { slug?: unknown } | null)?.slug);
  } catch (e) {
    console.warn(JSON.stringify({ tag: "expo-push", message: "test tournament check threw; sending", error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
