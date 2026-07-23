import type { SupabaseClient } from "@supabase/supabase-js";

type RunForTierSession = {
  id: string;
  title?: string | null;
  location_text?: string | null;
  start_at?: string | null;
  created_by?: string | null;
  open_tier_rank?: number | null;
  tier_session_id?: string | null;
};

const TIER_RANK_TO_NAME: Record<number, string> = {
  0: "bronze",
  1: "bronze",
  2: "silver",
  3: "gold",
  4: "platinum",
  5: "diamond",
};

function asUuid(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

/**
 * Ensures a `tier_sessions` row exists for a pickup run and syncs attendance
 * from confirmed RSVPs. Peer votes / settle require a real tier_session id
 * (peer_votes.session_id FKs to tier_sessions).
 */
export async function ensureTierSessionForRun(
  admin: SupabaseClient,
  run: RunForTierSession,
  fallbackOrganizerId: string,
): Promise<{ tier_session_id: string | null; error?: string }> {
  let tier_session_id = asUuid(run.tier_session_id);
  const now = new Date().toISOString();

  if (!tier_session_id) {
    const min_tier = TIER_RANK_TO_NAME[Number(run.open_tier_rank ?? 0)] ?? "bronze";
    const { data: ts, error: tsErr } = await admin
      .from("tier_sessions")
      .insert({
        organizer_id: run.created_by ?? fallbackOrganizerId,
        venue: run.location_text ?? run.title ?? "CT Pickup Session",
        starts_at: run.start_at ?? now,
        capacity: 20,
        min_tier,
        state: "open",
        created_at: now,
      })
      .select("id")
      .maybeSingle();

    if (tsErr || !ts?.id) {
      return { tier_session_id: null, error: tsErr?.message ?? "Failed to create tier session" };
    }

    tier_session_id = ts.id as string;
    await admin.from("pickup_runs").update({ tier_session_id }).eq("id", run.id);
  }

  const { data: rsvps } = await admin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", run.id)
    .in("status", ["confirmed", "pending_payment"]);

  if (rsvps && rsvps.length > 0) {
    const attendanceRows = rsvps.map((r: { user_id: string }) => ({
      session_id: tier_session_id,
      user_id: r.user_id,
      status: "attended",
    }));
    await admin.from("session_attendance").upsert(attendanceRows, {
      onConflict: "session_id,user_id",
    });

    for (const r of rsvps) {
      await admin
        .from("player_ratings")
        .upsert({ user_id: r.user_id }, { onConflict: "user_id", ignoreDuplicates: true });
    }
  }

  return { tier_session_id };
}
