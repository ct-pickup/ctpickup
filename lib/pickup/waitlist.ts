import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export const WAITLIST_OFFER_MINUTES = 30;

const RESERVED_STATUSES = ["confirmed", "pending_confirm", "pending_payment"] as const;

export function isReservedRsvpStatus(st: unknown): boolean {
  return typeof st === "string" && (RESERVED_STATUSES as readonly string[]).includes(st);
}

export async function reservedCountForRun(admin: SupabaseClient, run_id: string): Promise<number> {
  const res = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run_id)
    .in("status", Array.from(RESERVED_STATUSES));
  return res.count || 0;
}

export async function promoteNextWaitlistPlayer(
  admin: SupabaseClient,
  run_id: string,
  opts?: { requestedBy?: string; reason?: string }
): Promise<{ ok: true; promoted_user_id: string | null } | { ok: false; error: string }> {
  const runRes = await admin
    .from("pickup_runs")
    .select("id,capacity,fee_cents,status")
    .eq("id", run_id)
    .maybeSingle();

  if (runRes.error) return { ok: false, error: runRes.error.message };
  const run = runRes.data;
  if (!run) return { ok: false, error: "Run not found" };

  // Only promote for active runs; otherwise waitlist is meaningless.
  if (run.status !== "active") {
    return { ok: true, promoted_user_id: null };
  }

  const capacity = Number(run.capacity || 0);
  if (capacity <= 0) return { ok: true, promoted_user_id: null };

  const reserved = await reservedCountForRun(admin, run_id);
  if (reserved >= capacity) return { ok: true, promoted_user_id: null };

  const nextRes = await admin
    .from("pickup_run_rsvps")
    .select("user_id,waitlist_position")
    .eq("run_id", run_id)
    .eq("status", "waitlist")
    .order("waitlist_position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextRes.error) return { ok: false, error: nextRes.error.message };
  const next = nextRes.data;
  if (!next?.user_id) return { ok: true, promoted_user_id: null };

  const now = new Date();
  const expires = new Date(now.getTime() + WAITLIST_OFFER_MINUTES * 60 * 1000);

  const up = await admin
    .from("pickup_run_rsvps")
    .update({
      status: "pending_confirm",
      waitlist_offered_at: now.toISOString(),
      waitlist_expires_at: expires.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("run_id", run_id)
    .eq("user_id", next.user_id);

  if (up.error) return { ok: false, error: up.error.message };

  await sendPushToUsers(admin, [String(next.user_id)], {
    title: "A spot opened!",
    body: "You have 30 minutes to confirm.",
    data: { kind: "pickup_waitlist_offer", run_id },
  });

  // Best-effort: attach a small audit note for admins in logs.
  if (opts?.requestedBy || opts?.reason) {
    console.log(
      JSON.stringify({
        event: "pickup_waitlist_promoted",
        run_id,
        promoted_user_id: String(next.user_id),
        waitlist_position: next.waitlist_position ?? null,
        requested_by: opts.requestedBy ?? null,
        reason: opts.reason ?? null,
      }),
    );
  }

  return { ok: true, promoted_user_id: String(next.user_id) };
}

export async function expireWaitlistOffersAndPromote(
  admin: SupabaseClient,
  opts?: { now?: Date }
): Promise<{ ok: true; expired: number; promoted: number } | { ok: false; error: string }> {
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();

  const expiredRes = await admin
    .from("pickup_run_rsvps")
    .select("run_id,user_id")
    .eq("status", "pending_confirm")
    .lt("waitlist_expires_at", nowIso);

  if (expiredRes.error) return { ok: false, error: expiredRes.error.message };
  const expired = expiredRes.data || [];
  if (expired.length === 0) return { ok: true, expired: 0, promoted: 0 };

  // Expire all offers first.
  const runIds = Array.from(new Set(expired.map((r) => String(r.run_id))));
  const upd = await admin
    .from("pickup_run_rsvps")
    .update({
      status: "declined",
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      updated_at: nowIso,
    })
    .eq("status", "pending_confirm")
    .lt("waitlist_expires_at", nowIso);

  if (upd.error) return { ok: false, error: upd.error.message };

  // Promote next for each affected run (one spot per expired offer).
  let promoted = 0;
  for (const run_id of runIds) {
    // Promote as many as needed based on how many offers expired for this run.
    const n = expired.filter((r) => String(r.run_id) === run_id).length;
    for (let i = 0; i < n; i++) {
      const pr = await promoteNextWaitlistPlayer(admin, run_id, { reason: "offer_expired" });
      if (!pr.ok) {
        console.error("[waitlist-expire] promote failed:", pr.error, { run_id });
        continue;
      }
      if (pr.promoted_user_id) promoted += 1;
    }
  }

  return { ok: true, expired: expired.length, promoted };
}

