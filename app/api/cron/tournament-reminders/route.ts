import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { sendTournamentStartReminders } from "@/lib/tournament/tournamentReminders";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/tournament-reminders (hourly, see vercel.json). The one "Tournament starts soon" push, once per player
 * and tournament, never for a test or inactive or canceled tournament. What it says and who gets it: lib/tournament/tournamentReminders.ts.
 * CRON_SECRET Bearer required, like every other cron.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }
  const r = await sendTournamentStartReminders(admin);
  return NextResponse.json({ ok: true, reminders_sent: r.sent, ...r });
}
