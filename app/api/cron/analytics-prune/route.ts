import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** How long usage events are kept. The privacy page says 24 months: change both together. */
const ANALYTICS_RETENTION_DAYS = 730;

/**
 * Vercel Cron: GET /api/cron/analytics-prune (weekly). Deletes usage events older than ANALYTICS_RETENTION_DAYS.
 * CRON_SECRET Bearer required. Quietly does nothing until the analytics migration is applied.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Missing Supabase env." }, { status: 500 });

  const { data, error } = await createClient(url, key).rpc("analytics_prune", { p_days: ANALYTICS_RETENTION_DAYS });
  if (error) {
    if (/does not exist|could not find the function|schema cache|42883|PGRST202/i.test(`${error.code ?? ""} ${error.message}`)) {
      return NextResponse.json({ ok: true, skipped: "analytics not set up" });
    }
    console.error("[cron/analytics-prune]", error.message);
    return NextResponse.json({ error: "prune_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: Number(data) || 0 });
}
