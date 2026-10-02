import type { SupabaseClient } from "@supabase/supabase-js";
import { realKickoffMs } from "@/lib/pickup/runScheduling";
import { fetchRunTimeTbdIds } from "@/lib/pickup/runTimeTbd";

export const SESSION_RATE_REMINDER_KIND = "session_rate_reminder";

/** Flip planning → active once kickoff has passed. Runs with time TBD have no kickoff yet and stay planning. */
export async function promotePlanningRunsPastStart(
  admin: SupabaseClient,
  opts?: { runId?: string },
): Promise<{ updated: number }> {
  const nowIso = new Date().toISOString();
  let candidatesQ = admin.from("pickup_runs").select("id").eq("status", "planning").lt("start_at", nowIso);
  if (opts?.runId) candidatesQ = candidatesQ.eq("id", opts.runId);

  const { data: candidates, error: candErr } = await candidatesQ;
  if (candErr) {
    console.error("[promotePlanningRunsPastStart]", candErr.message);
    return { updated: 0 };
  }
  const candidateIds = (candidates ?? []).map((r) => String((r as { id?: unknown }).id ?? "")).filter(Boolean);
  if (!candidateIds.length) return { updated: 0 };

  const tbd = await fetchRunTimeTbdIds(admin, candidateIds);
  const ids = candidateIds.filter((id) => !tbd.has(id));
  if (!ids.length) return { updated: 0 };

  const { data, error } = await admin
    .from("pickup_runs")
    .update({ status: "active", updated_at: nowIso })
    .in("id", ids)
    .eq("status", "planning")
    .lt("start_at", nowIso)
    .select("id");
  if (error) {
    console.error("[promotePlanningRunsPastStart]", error.message);
    return { updated: 0 };
  }
  return { updated: data?.length ?? 0 };
}

async function deleteUnsentRateReminders(admin: SupabaseClient, runIds: string[]): Promise<void> {
  if (!runIds.length) return;
  const { error } = await admin
    .from("pickup_push_scheduled")
    .delete()
    .in("run_id", runIds)
    .eq("kind", SESSION_RATE_REMINDER_KIND)
    .is("sent_at", null);
  if (error) console.error("[sessionLifecycle] delete unsent rate reminders", error.message);
}

/**
 * Schedule "rate your teammates" pushes for confirmed attendees at start_at + 30 minutes.
 * Idempotent per (user_id, run_id, kind). Unsent reminders follow the current start_at. A run with time TBD
 * gets none (and loses any unsent ones) until a real time is set.
 */
export async function scheduleSessionRateRemindersForRun(
  admin: SupabaseClient,
  runId: string,
  opts?: { timeTbd?: boolean },
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

  const timeTbd = opts?.timeTbd ?? (await fetchRunTimeTbdIds(admin, [runId])).has(runId);
  if (timeTbd) {
    await deleteUnsentRateReminders(admin, [runId]);
    return { scheduled: 0 };
  }

  const startMs = realKickoffMs({ start_at: run.start_at, time_tbd: false });
  if (startMs === null) return { scheduled: 0 };

  const sendAt = new Date(startMs + 30 * 60 * 1000);
  const sendAtIso = sendAt.toISOString();
  // Don't schedule reminders for sessions that already ended long ago.
  if (sendAt.getTime() < Date.now() - 3 * 60 * 60 * 1000) return { scheduled: 0 };

  await admin
    .from("pickup_push_scheduled")
    .update({ send_at: sendAtIso })
    .eq("run_id", runId)
    .eq("kind", SESSION_RATE_REMINDER_KIND)
    .is("sent_at", null)
    .neq("send_at", sendAtIso);

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
      send_at: sendAtIso,
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

  const ids = (runs ?? []).map((r) => (typeof r.id === "string" ? r.id : "")).filter(Boolean);
  const tbd = await fetchRunTimeTbdIds(admin, ids);
  let scheduled = 0;
  for (const id of ids) {
    const res = await scheduleSessionRateRemindersForRun(admin, id, { timeTbd: tbd.has(id) });
    scheduled += res.scheduled;
  }
  return { runs: ids.length, scheduled };
}

/**
 * Of the due scheduled pushes, the ids of rate reminders whose run has time TBD. They are deleted so the
 * run is reminded at its real time once one is set.
 */
export async function dropDueRateRemindersForTbdRuns(
  admin: SupabaseClient,
  rows: Array<{ id?: unknown; run_id?: unknown; kind?: unknown }>,
): Promise<Set<string>> {
  const reminders = rows.filter((r) => String(r.kind ?? "").trim() === SESSION_RATE_REMINDER_KIND && r.id && r.run_id);
  if (!reminders.length) return new Set();
  const tbd = await fetchRunTimeTbdIds(admin, reminders.map((r) => String(r.run_id)));
  if (!tbd.size) return new Set();
  const dropIds = reminders.filter((r) => tbd.has(String(r.run_id))).map((r) => String(r.id));
  const { error } = await admin.from("pickup_push_scheduled").delete().in("id", dropIds).is("sent_at", null);
  if (error) console.error("[dropDueRateRemindersForTbdRuns]", error.message);
  return new Set(dropIds);
}
