import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { promotePickupRunToHub } from "@/lib/pickup/hubPromote";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/** Promote a player from the waitlist, or promote a run to the regional pickup hub. */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const run_id = String(body.run_id || "").trim();
  const promote_user_id =
    body.promote_user_id === null || body.promote_user_id === undefined
      ? ""
      : String(body.promote_user_id).trim();
  const hubPromote =
    body.target === "hub" ||
    body.action === "hub" ||
    body.action === "set_hub_pickup" ||
    body.action === "promote_to_hub" ||
    (!promote_user_id && !!run_id);

  if (!run_id) {
    return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
  }

  if (hubPromote) {
    const hub = await promotePickupRunToHub(admin, run_id);
    if (!hub.ok) {
      return NextResponse.json({ error: hub.error }, { status: hub.status });
    }

    revalidatePath("/pickup");
    revalidatePath("/admin/pickup");
    revalidatePath("/status/pickup");
    revalidatePath("/admin/relationships");
    revalidatePath("/admin");

    return NextResponse.json({
      ok: true,
      action: "set_hub_pickup",
      wave_warning: hub.wave_warning,
      wave_outreach: hub.wave_outreach,
    });
  }

  if (!promote_user_id) {
    return NextResponse.json({ error: "Missing promote_user_id" }, { status: 400 });
  }

  const runRes = await admin.from("pickup_runs").select("*").eq("id", run_id).maybeSingle();
  if (runRes.error) return NextResponse.json({ error: runRes.error.message }, { status: 500 });
  if (!runRes.data) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const run = runRes.data;

  const countRes = await admin
    .from("pickup_run_rsvps")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run_id)
    .eq("status", "confirmed");

  const confirmedCount = countRes.count || 0;
  if (confirmedCount >= Number(run.capacity || 0)) {
    return NextResponse.json({ error: "Run is already at capacity." }, { status: 409 });
  }

  const newStatus = Number(run.fee_cents || 0) > 0 ? "pending_payment" : "confirmed";

  const up = await admin
    .from("pickup_run_rsvps")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("run_id", run_id)
    .eq("user_id", promote_user_id)
    .select("user_id");

  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  if ((up.data?.length ?? 0) > 0) {
    await sendPushToUsers(admin, [promote_user_id], {
      title: "You got in",
      body: "You have been promoted from the waitlist to confirmed for the upcoming pickup.",
      data: { kind: "pickup_promoted", run_id },
    });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
