import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUsers } from "@/lib/push/sendExpoPush";

export const runtime = "nodejs";

/**
 * Vercel Cron: GET /api/cron/push-scheduled
 * Sends deferred push rows when send_at is due. CRON_SECRET Bearer required.
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
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await admin
    .from("pickup_push_scheduled")
    .select("id,user_id,title,body,kind,data")
    .lte("send_at", nowIso)
    .is("sent_at", null)
    .order("send_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const row of rows || []) {
    const id = String((row as { id?: unknown }).id || "");
    const userId = String((row as { user_id?: unknown }).user_id || "");
    const title = String((row as { title?: unknown }).title || "");
    const body = String((row as { body?: unknown }).body || "");
    const kind = String((row as { kind?: unknown }).kind || "").trim();
    const rawData = (row as { data?: unknown }).data;
    const dataObj =
      rawData != null && typeof rawData === "object" && !Array.isArray(rawData)
        ? (rawData as Record<string, unknown>)
        : {};
    const pushData: Record<string, unknown> = { kind, ...dataObj };

    if (!id || !userId || !kind) continue;

    const res = await sendPushToUsers(admin, [userId], { title, body, data: pushData });
    if (res.lookupError) {
      console.error("[cron/push-scheduled] lookup error:", res.lookupError, { id });
      continue;
    }

    const up = await admin
      .from("pickup_push_scheduled")
      .update({ sent_at: nowIso })
      .eq("id", id)
      .is("sent_at", null);

    if (!up.error) sent += 1;
  }

  return NextResponse.json({ sent });
}
