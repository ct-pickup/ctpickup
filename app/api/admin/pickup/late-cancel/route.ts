import { NextResponse } from "next/server";
import { recomputePickupStandingForUser } from "@/lib/pickup/standing/recomputePickupStanding";
import { deletePendingWaitlistExpiringReminders, promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

/**
 * Records a late cancellation (after the 24-hour refund cutoff or staff-directed removal) for standing.
 * Idempotent per user + run + kind via unique index.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await admin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const run_id = String(body?.run_id || "").trim();
  const user_id = String(body?.user_id || "").trim();
  const note = body?.note != null ? String(body.note).trim() || null : null;

  if (!run_id || !user_id) {
    return NextResponse.json({ error: "run_id and user_id required" }, { status: 400 });
  }

  const ins = await admin.from("pickup_reliability_incidents").insert({
    run_id,
    user_id,
    kind: "late_cancel",
    source: "admin",
    note,
  });

  if (ins.error && ins.error.code !== "23505") {
    console.error("[late-cancel]", ins.error.message);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  try {
    await recomputePickupStandingForUser(admin, user_id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[late-cancel] recompute:", msg);
    return NextResponse.json({ error: "recompute_failed" }, { status: 500 });
  }

  // Free the slot (if any) and promote next waitlist player.
  // We do this after standing recompute so "late_cancel" incident is captured either way.
  const current = await admin
    .from("pickup_run_rsvps")
    .select("status")
    .eq("run_id", run_id)
    .eq("user_id", user_id)
    .maybeSingle();

  const prev = current.data?.status || null;
  if (prev === "confirmed" || prev === "pending_confirm" || prev === "pending_payment") {
    await admin
      .from("pickup_run_rsvps")
      .update({ status: "late_canceled", updated_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("user_id", user_id);

    if (prev === "pending_confirm") {
      await deletePendingWaitlistExpiringReminders(admin, user_id, run_id);
    }

    await promoteNextWaitlistPlayer(admin, run_id, {
      requestedBy: user.id,
      reason: "admin_late_cancel",
    });
  }

  return NextResponse.json({ ok: true });
}
