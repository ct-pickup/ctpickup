import { NextResponse } from "next/server";
import { sendRatingReminders } from "@/lib/ratings/ratingReminders";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/rating-reminders (hourly). The one "Rate your last game" push, 24 hours after kickoff, only while the
 * rating is still pending, never twice. Does nothing while the require_ratings flag is off. CRON_SECRET Bearer required.
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
  const r = await sendRatingReminders(admin);
  return NextResponse.json({ ok: true, ...r });
}
