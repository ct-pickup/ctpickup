import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { sendPickupAdminConfirmedPush } from "@/lib/pickup/pickupPushNotifications";
import { deletePendingWaitlistExpiringReminders } from "@/lib/pickup/waitlist";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const run_id = String(body.run_id ?? "").trim();
  const user_id = String(body.user_id ?? "").trim();
  if (!run_id || !user_id) {
    return NextResponse.json({ error: "Missing run_id or user_id" }, { status: 400 });
  }

  const runRes = await admin.from("pickup_runs").select("id,capacity,title").eq("id", run_id).maybeSingle();
  if (runRes.error) {
    return NextResponse.json({ error: runRes.error.message }, { status: 500 });
  }
  if (!runRes.data?.id) {
    // 422 avoids confusion with a missing Next.js route (HTTP 404 HTML from the host).
    return NextResponse.json({ error: "Pickup run not found for this run_id." }, { status: 422 });
  }
  const run = runRes.data;

  const countRes = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run_id)
    .eq("status", "confirmed");

  const confirmedCount = countRes.count || 0;
  // Capacity = fully confirmed RSVPs only (not pending_payment / pending_confirm).
  if (confirmedCount >= Number(run.capacity || 0)) {
    return NextResponse.json({ error: "Run is already at capacity." }, { status: 409 });
  }

  const tierRes = await admin.from("profiles").select("tier").eq("id", user_id).maybeSingle();
  const now = new Date().toISOString();

  const up = await admin.from("pickup_run_rsvps").upsert(
    {
      run_id,
      user_id,
      tier_at_time: tierRes.data?.tier ?? null,
      status: "confirmed",
      waitlist_position: null,
      waitlist_offered_at: null,
      waitlist_expires_at: null,
      checkout_session_id: null,
      updated_at: now,
    },
    { onConflict: "run_id,user_id" },
  );

  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  await deletePendingWaitlistExpiringReminders(admin, user_id, run_id);

  await sendPickupAdminConfirmedPush(admin, {
    userId: user_id,
    runId: run_id,
    runTitle: String(run.title || ""),
  });

  revalidatePath("/pickup");
  revalidatePath("/status/pickup");

  return NextResponse.json({ ok: true });
}
