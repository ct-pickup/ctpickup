import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripePickup } from "@/lib/server/runtimeClients";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export const WAITLIST_OFFER_MINUTES = 30;

export const PICKUP_WAITLIST_EXPIRING_KIND = "pickup_waitlist_expiring";

const WAITLIST_EXPIRING_REMINDER_MINUTES_BEFORE = 10;

/** Removes unsent scheduled expiry reminders so they are not delivered after the offer ends. */
export async function deletePendingWaitlistExpiringReminders(
  admin: SupabaseClient,
  user_id: string,
  run_id: string,
): Promise<void> {
  await admin
    .from("pickup_push_scheduled")
    .delete()
    .eq("user_id", user_id)
    .eq("run_id", run_id)
    .eq("kind", PICKUP_WAITLIST_EXPIRING_KIND)
    .is("sent_at", null);
}

/** Statuses that reserve a spot while checkout is open or after payment. */
export const PICKUP_CAPACITY_STATUSES = ["confirmed", "pending_payment"] as const;

export function isReservedRsvpStatus(st: unknown): boolean {
  return typeof st === "string" && (PICKUP_CAPACITY_STATUSES as readonly string[]).includes(st);
}

/** Canonical capacity count: confirmed + pending_payment RSVPs for a run. */
export async function countAcceptedPickupRsvps(
  admin: SupabaseClient,
  run_id: string,
): Promise<number> {
  const res = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run_id)
    .in("status", Array.from(PICKUP_CAPACITY_STATUSES));
  if (res.error) return 0;
  return res.count ?? 0;
}

export async function reservedCountForRun(admin: SupabaseClient, run_id: string): Promise<number> {
  return countAcceptedPickupRsvps(admin, run_id);
}

/** Refund a paid RSVP and move the player to the waitlist when capacity was exceeded at fulfillment. */
export async function rejectPickupFulfillmentOverCapacity(
  admin: SupabaseClient,
  opts: {
    run_id: string;
    user_id: string;
    payment_intent_id: string | null;
  },
): Promise<void> {
  const { run_id, user_id, payment_intent_id } = opts;

  const maxPosRes = await admin
    .from("pickup_run_rsvps")
    .select("waitlist_position")
    .eq("run_id", run_id)
    .eq("status", "waitlist")
    .order("waitlist_position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const maxPos =
    maxPosRes.data?.waitlist_position === null || maxPosRes.data?.waitlist_position === undefined
      ? 0
      : Number(maxPosRes.data.waitlist_position);
  const nextPos = (Number.isFinite(maxPos) ? maxPos : 0) + 1;
  const nowIso = new Date().toISOString();

  let refund_id: string | null = null;
  const pi =
    payment_intent_id != null && String(payment_intent_id).trim().length > 0
      ? String(payment_intent_id).trim()
      : null;

  if (pi) {
    try {
      const stripe = getStripePickup();
      const refund = await stripe.refunds.create({ payment_intent: pi });
      refund_id = refund.id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("pickup_fulfill_over_capacity_refund_error:", msg, { run_id, user_id });
    }
  }

  await admin
    .from("pickup_run_rsvps")
    .update({
      status: "waitlist",
      waitlist_position: nextPos,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      checkout_session_id: null,
      payment_intent_id: null,
      refund_id,
      updated_at: nowIso,
    })
    .eq("run_id", run_id)
    .eq("user_id", user_id);

  await sendPushToUsers(admin, [user_id], {
    title: "Run is full",
    body: "Your payment was refunded. You've been added to the waitlist.",
    data: { kind: "pickup_over_capacity_refund", run_id },
  });
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

  const promotedUserId = String(next.user_id);
  await deletePendingWaitlistExpiringReminders(admin, promotedUserId, run_id);

  const reminderAt = new Date(expires.getTime() - WAITLIST_EXPIRING_REMINDER_MINUTES_BEFORE * 60 * 1000);
  if (reminderAt.getTime() > now.getTime()) {
    const ins = await admin.from("pickup_push_scheduled").insert({
      user_id: promotedUserId,
      run_id,
      send_at: reminderAt.toISOString(),
      kind: PICKUP_WAITLIST_EXPIRING_KIND,
      title: "Spot expiring soon ⏰",
      body: "Your waitlist spot expires in 10 minutes. Confirm now before it's gone.",
      data: { run_id },
    });
    if (ins.error) {
      console.error("[waitlist] schedule expiring reminder failed:", ins.error.message, { run_id, promotedUserId });
    }
  }

  // Best-effort: attach a small audit note for admins in logs.
  if (opts?.requestedBy || opts?.reason) {
    console.log({
      tag: "pickup-waitlist",
      message: "promoted",
      data: {
        run_id,
        promoted_user_id: String(next.user_id),
        waitlist_position: next.waitlist_position ?? null,
        requested_by: opts.requestedBy ?? null,
        reason: opts.reason ?? null,
      },
    });
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

  for (const row of expired) {
    if (row.user_id && row.run_id) {
      await deletePendingWaitlistExpiringReminders(admin, String(row.user_id), String(row.run_id));
    }
  }

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

