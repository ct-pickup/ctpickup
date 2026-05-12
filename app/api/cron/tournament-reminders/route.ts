import { NextResponse } from "next/server";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { PAID_OR_READY_CAPTAIN_STATUSES } from "@/lib/tournament/outdoorTournamentConstants";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/tournament-reminders (hourly recommended).
 * Sends a single push per active tournament ~24 hours before `start_at` to paid captains + accepted roster players.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  const nowMs = Date.now();
  const windowLo = nowMs + 23 * 60 * 60 * 1000;
  const windowHi = nowMs + 25 * 60 * 60 * 1000;

  const { data: tours, error: tErr } = await admin
    .from("tournaments")
    .select("id,title,start_at,start_reminder_sent_at")
    .eq("is_active", true)
    .is("start_reminder_sent_at", null)
    .not("start_at", "is", null);

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  let sent = 0;
  for (const t of tours || []) {
    const startMs = new Date(String((t as { start_at: string }).start_at)).getTime();
    if (!Number.isFinite(startMs)) continue;
    if (startMs < windowLo || startMs > windowHi) continue;

    const tid = String((t as { id: string }).id);

    const { data: caps } = await admin
      .from("tournament_captains")
      .select("user_id")
      .eq("tournament_id", tid)
      .in("status", [...PAID_OR_READY_CAPTAIN_STATUSES]);

    const { data: ros } = await admin
      .from("tournament_roster")
      .select("user_id")
      .eq("tournament_id", tid)
      .eq("status", "accepted");

    const ids = new Set<string>();
    for (const c of caps || []) {
      const uid = (c as { user_id: string }).user_id;
      if (uid) ids.add(String(uid));
    }
    for (const r of ros || []) {
      const uid = (r as { user_id: string }).user_id;
      if (uid) ids.add(String(uid));
    }

    const list = [...ids];
    if (list.length) {
      await sendPushToUsers(admin, list, {
        title: "Tournament starts soon",
        body: `Your CT Pickup tournament starts in about 24 hours. ${String((t as { title?: string }).title || "").trim()}`,
        data: { kind: "tournament_starts_soon", tournament_id: tid },
      });
    }

    await admin.from("tournaments").update({ start_reminder_sent_at: new Date().toISOString() }).eq("id", tid);
    sent += 1;
  }

  return NextResponse.json({ ok: true, reminders_sent: sent });
}
