import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { cancelAllPickupRsvpsAndRefundPaidConfirmed } from "@/lib/pickup/refundAllPickupPlayersOnRunCancel";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export async function POST(req: Request) {
  const supabaseAdmin = getSupabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = await supabaseAdmin.auth.getUser(token);
  const user = u.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prof = await supabaseAdmin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { run_id, reason } = await req.json();

  await supabaseAdmin
    .from("pickup_runs")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run_id);

  const rsvpsRes = await supabaseAdmin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", run_id);

  const rsvps = rsvpsRes.data || [];
  const canceledUserIds = Array.from(new Set(rsvps.map((r) => r.user_id).filter(Boolean)));

  const { refunded, failed } = await cancelAllPickupRsvpsAndRefundPaidConfirmed(supabaseAdmin, run_id);

  if (canceledUserIds.length) {
    await sendPushToUsers(supabaseAdmin, canceledUserIds, {
      title: "Pickup canceled",
      body: "The upcoming pickup run has been canceled.",
      data: { kind: "pickup_canceled", run_id },
    });
  }

  return NextResponse.json({ ok: true, refunded, failed });
}
