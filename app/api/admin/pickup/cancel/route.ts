import { NextResponse } from "next/server";
import { cancelAllPickupRsvpsAndIssueCancellationCredits } from "@/lib/pickup/cancellationCreditsOnRunCancel";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
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

  const { credited, creditFailed, paidUserIds, freeUserIds, venueLabel } =
    await cancelAllPickupRsvpsAndIssueCancellationCredits(supabaseAdmin, run_id);

  const venue = venueLabel === "your" ? "your" : venueLabel;

  if (paidUserIds.length) {
    await sendPushToUsers(supabaseAdmin, paidUserIds, {
      title: "Run Cancelled",
      body: `Your ${venue} run was cancelled. A credit for the exact amount you paid has been added to your account — valid for 3 months.`,
      data: { kind: "pickup_canceled", run_id },
    });
  }

  if (freeUserIds.length) {
    await sendPushToUsers(supabaseAdmin, freeUserIds, {
      title: "Run Cancelled",
      body: `Your ${venue} run was cancelled.`,
      data: { kind: "pickup_canceled", run_id },
    });
  }

  return NextResponse.json({ ok: true, credited, creditFailed });
}
