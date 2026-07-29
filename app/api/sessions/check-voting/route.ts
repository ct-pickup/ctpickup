import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Lazily send peer-voting push notifications 30 minutes after kickoff.
 * Triggered when an attendee opens the session detail screen.
 * Body: { run_id }
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { run_id?: string };
  const run_id = String(body.run_id ?? "").trim();
  if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await admin
    .from("pickup_runs")
    .select("id,start_at,created_by,voting_notif_sent,status")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (run.voting_notif_sent === true) {
    return NextResponse.json({ ok: true, sent: false });
  }

  const startMs = run.start_at ? new Date(run.start_at).getTime() : NaN;
  if (!Number.isFinite(startMs)) {
    return NextResponse.json({ ok: true, sent: false });
  }

  const thirtyMinAfterStart = startMs + 30 * 60 * 1000;
  if (Date.now() < thirtyMinAfterStart) {
    return NextResponse.json({ ok: true, sent: false });
  }

  // Claim the send atomically so concurrent opens don't double-push.
  const { data: claimed, error: claimErr } = await admin
    .from("pickup_runs")
    .update({ voting_notif_sent: true })
    .eq("id", run_id)
    .eq("voting_notif_sent", false)
    .select("id")
    .maybeSingle();

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json({ ok: true, sent: false });
  }

  const { data: rsvps } = await admin
    .from("pickup_run_rsvps")
    .select("user_id")
    .eq("run_id", run_id)
    .eq("status", "confirmed");

  const hostId = typeof run.created_by === "string" ? run.created_by : null;
  const recipientIds = Array.from(
    new Set(
      ((rsvps ?? []) as Array<{ user_id: string | null }>)
        .map((r) => r.user_id)
        .filter((uid): uid is string => Boolean(uid) && uid !== hostId),
    ),
  );

  if (recipientIds.length > 0) {
    await sendPushToUsers(admin, recipientIds, {
      title: "How was the session? ⚽",
      body: "Rate your teammates and the host from today's session",
      data: { screen: `session/${run_id}`, run_id },
    });
  }

  return NextResponse.json({ ok: true, sent: true });
}
