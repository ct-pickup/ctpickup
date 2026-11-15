import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The short list of live tournaments that the Home card and the Events tab show. Built field by field from an allow-list: a title,
 * when and where, whether a match is being played, and whether the final is done. No team, captain, roster, payment or review data.
 * Whether to show a tournament at all (finished, stale, starting soon) is decided on the phone, from these facts.
 */
export type TournamentListItem = {
  id: string;
  title: string;
  start_at: string | null;
  venue: string | null;
  service_region: string | null;
  /** A match has started and has no result yet. */
  live: boolean;
  /** Matches have been generated. */
  has_bracket: boolean;
  /** When the final got its result, if it has. */
  final_completed_at: string | null;
};

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function summarizeTournaments(tournaments: readonly Raw[], matches: readonly Raw[]): TournamentListItem[] {
  const byTournament = new Map<string, Raw[]>();
  for (const m of matches) {
    const id = str(m.tournament_id);
    if (!id) continue;
    byTournament.set(id, [...(byTournament.get(id) ?? []), m]);
  }
  return tournaments.flatMap((t) => {
    const id = str(t.id);
    if (!id) return [];
    const rows = byTournament.get(id) ?? [];
    const live = rows.some((m) => m.is_bye !== true && str(m.started_at) != null && str(m.completed_at) == null);
    const final = rows.find((m) => m.stage === "final" && m.is_bye !== true && str(m.completed_at) != null);
    return [
      {
        id,
        title: str(t.title) ?? "Tournament",
        start_at: str(t.start_at),
        venue: str(t.venue),
        service_region: str(t.service_region)?.toUpperCase() ?? null,
        live,
        has_bracket: rows.length > 0,
        final_completed_at: final ? str(final.completed_at) : null,
      },
    ];
  });
}

/** Active, not canceled tournaments, soonest first, with what the phone needs to decide what to show. */
export async function loadTournamentList(
  admin: SupabaseClient,
): Promise<{ ok: true; tournaments: TournamentListItem[] } | { ok: false; error: string }> {
  const t = await admin
    .from("tournaments")
    .select("id, title, start_at, venue, service_region, is_active, canceled_at")
    .eq("is_active", true)
    .is("canceled_at", null)
    .order("start_at", { ascending: true })
    .limit(10);
  if (t.error) return { ok: false, error: t.error.message };
  const rows = (t.data ?? []) as Raw[];
  if (!rows.length) return { ok: true, tournaments: [] };

  const m = await admin
    .from("tournament_matches")
    .select("tournament_id, stage, is_bye, started_at, completed_at")
    .in(
      "tournament_id",
      rows.map((r) => String(r.id)),
    );
  if (m.error) return { ok: false, error: m.error.message };
  return { ok: true, tournaments: summarizeTournaments(rows, (m.data ?? []) as Raw[]) };
}
