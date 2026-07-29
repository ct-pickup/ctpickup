import type { SupabaseClient } from "@supabase/supabase-js";

export const SESSION_RATE_REMINDER_KIND = "session_rate_reminder";

/** Flip planning → active once kickoff has passed. */
export async function promotePlanningRunsPastStart(
  admin: SupabaseClient,
  opts?: { runId?: string },
): Promise<{ updated: number }> {
  const nowIso = new Date().toISOString();
  let q = admin
    .from("pickup_runs")
    .update({ status: "active", updated_at: nowIso })
    .eq("status", "planning")
    .lt("start_at", nowIso);

  if (opts?.runId) q = q.eq("id", opts.runId);

  const { data, error } = await q.select("id");
  if (error) {
    console.error("[promotePlanningRunsPastStart]", error.message);
    return { updated: 0 };
  }
  return { updated: data?.length ?? 0 };
}

/**
 * Schedule "rate your teammates" pushes for confirmed attendees at start_at + 30 minutes.
 * Idempotent per (user_id, run_id, kind) while unsent.
 */
export async function scheduleSessionRateRemindersForRun(
  admin: SupabaseClient,
  runId: string,
): Promise<{ scheduled: number }> {
  const { data: run, error: runErr } = await admin
    .from("pickup_runs")
    .select("id,start_at,status")
    .eq("id", runId)
    .maybeSingle();

  if (runErr || !run?.start_at) {
    if (runErr) console.error("[scheduleSessionRateRemindersForRun] run", runErr.message);
    return { scheduled: 0 };
  }

  if (run.status === "canceled" || run.status === "cancelled") return { scheduled: 0 };

  const startMs = new Date(run.start_at).getTime();
  if (!Number.isFinite(startMs)) return { scheduled: 0 };

  const sendAt = new Date(startMs + 30 * 60 * 1000);
  // Don't schedule reminders for sessions that already ended long ago.
  if (sendAt.getTime() < Date.now() - 3 * 60 * 60 * 1000) return { scheduled: 0 };

  const { data: rsvps } = await admin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", runId)
    .in("status", ["confirmed", "pending_payment"]);

  const userIds = Array.from(
    new Set(
      (rsvps ?? [])
        .map((r) => (typeof r.user_id === "string" ? r.user_id : ""))
        .filter(Boolean),
    ),
  );
  if (!userIds.length) return { scheduled: 0 };

  const { data: existing } = await admin
    .from("pickup_push_scheduled")
    .select("user_id")
    .eq("run_id", runId)
    .eq("kind", SESSION_RATE_REMINDER_KIND)
    .in("user_id", userIds);

  const already = new Set(
    (existing ?? []).map((r) => (typeof r.user_id === "string" ? r.user_id : "")).filter(Boolean),
  );

  const rows = userIds
    .filter((uid) => !already.has(uid))
    .map((user_id) => ({
      user_id,
      run_id: runId,
      send_at: sendAt.toISOString(),
      kind: SESSION_RATE_REMINDER_KIND,
      title: "How was the session?",
      body: "Rate your teammates →",
      data: {
        screen: `session/${runId}`,
        run_id: runId,
        url: `ctpickup://session/${runId}`,
      },
    }));

  if (!rows.length) return { scheduled: 0 };

  const { error: insErr } = await admin.from("pickup_push_scheduled").insert(rows);
  if (insErr) {
    console.error("[scheduleSessionRateRemindersForRun] insert", insErr.message);
    return { scheduled: 0 };
  }
  return { scheduled: rows.length };
}

/** Ensure rate reminders are queued for host-created / public sessions around kickoff. */
export async function ensureUpcomingSessionRateReminders(
  admin: SupabaseClient,
): Promise<{ runs: number; scheduled: number }> {
  const now = Date.now();
  const from = new Date(now - 4 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 36 * 60 * 60 * 1000).toISOString();

  const { data: runs, error } = await admin
    .from("pickup_runs")
    .select("id")
    .in("status", ["planning", "likely_on", "active", "in_progress", "completed"])
    .gte("start_at", from)
    .lte("start_at", to)
    .limit(200);

  if (error) {
    console.error("[ensureUpcomingSessionRateReminders]", error.message);
    return { runs: 0, scheduled: 0 };
  }

  let scheduled = 0;
  for (const r of runs ?? []) {
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) continue;
    const res = await scheduleSessionRateRemindersForRun(admin, id);
    scheduled += res.scheduled;
  }
  return { runs: runs?.length ?? 0, scheduled };
}
