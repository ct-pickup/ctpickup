import type { SupabaseClient } from "@supabase/supabase-js";
import { deactivateActiveTournamentsInRegionBucket } from "@/lib/tournament/deactivateActiveByRegionBucket";

/**
 * Sets which outdoor captain tournament is live on public hubs (`is_active`).
 * Passing null clears every tournament's active flag.
 */
export async function setOutdoorTournamentHub(
  admin: SupabaseClient,
  tournamentId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!tournamentId) {
    const { data: all, error: listErr } = await admin.from("tournaments").select("id");
    if (listErr) return { ok: false, error: listErr.message };
    for (const r of all ?? []) {
      const { error: uErr } = await admin.from("tournaments").update({ is_active: false }).eq("id", r.id);
      if (uErr) return { ok: false, error: uErr.message };
    }
    return { ok: true };
  }

  const rowRes = await admin.from("tournaments").select("service_region").eq("id", tournamentId).maybeSingle();
  if (!rowRes.data) return { ok: false, error: "Tournament not found." };
  const sr = rowRes.data.service_region;
  const bucket = sr != null && String(sr).trim() !== "" ? String(sr).trim() : null;
  const { error: dErr } = await deactivateActiveTournamentsInRegionBucket(admin, bucket);
  if (dErr) return { ok: false, error: dErr.message };
  const { error: actErr } = await admin.from("tournaments").update({ is_active: true }).eq("id", tournamentId);
  if (actErr) return { ok: false, error: actErr.message };
  return { ok: true };
}
