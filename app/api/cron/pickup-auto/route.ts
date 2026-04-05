import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processAllAutoPickupRuns } from "@/lib/pickup/autoRunCheckpoints";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/pickup-auto
 * Set CRON_SECRET in env; Vercel sends Authorization: Bearer <CRON_SECRET> when configured.
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase env." }, { status: 500 });
  }

  const admin = createClient(url, key);
  const { processed } = await processAllAutoPickupRuns(admin);

  return NextResponse.json({ ok: true, processed });
}
