import { NextResponse } from "next/server";
import { autoSettleTierSession } from "@/lib/pickup/autoSettleSession";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Lazily:
 * 1) Send peer-voting push notifications 30 minutes after kickoff
 * 2) Auto-settle ratings 2 hours after kickoff if still unsettled
 *
 * Triggered when someone opens the session detail screen.
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
    .select("id,start_at,created_by,voting_notif_sent,status,tier_session_id")
    .eq("id", run_id)
    .maybeSingle();

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const startMs = run.start_at ? new Date(run.start_at).getTime() : NaN;
  let votingSent = false;
  let settled = false;
  let settleError: string | undefined;

  // --- Voting notification (start_at + 30m) ---
  if (Number.isFinite(startMs) && run.voting_notif_sent !== true) {
    const thirtyMinAfterStart = startMs + 30 * 60 * 1000;
    if (Date.now() >= thirtyMinAfterStart) {
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

      if (claimed) {
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
        votingSent = true;
      }
    }
  }

  // --- Auto-settle (start_at + 2h) ---
  const tierSessionId =
    typeof run.tier_session_id === "string" && run.tier_session_id.trim()
      ? run.tier_session_id.trim()
      : null;

  if (Number.isFinite(startMs) && tierSessionId) {
    const twoHoursAfterStart = startMs + 2 * 60 * 60 * 1000;
    if (Date.now() >= twoHoursAfterStart) {
      const result = await autoSettleTierSession(admin, tierSessionId);
      settled = result.settled;
      settleError = result.error;
    }
  }

  return NextResponse.json({
    ok: true,
    sent: votingSent,
    settled,
    settle_error: settleError ?? null,
  });
}
