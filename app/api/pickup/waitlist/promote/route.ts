import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";
import { promoteNextWaitlistPlayer } from "@/lib/pickup/waitlist";

export const runtime = "nodejs";

function bearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * POST /api/pickup/waitlist/promote
 *
 * Auth:
 * - Admin user Bearer token, OR
 * - CRON_SECRET (Bearer) for server-to-server automation.
 */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let requestedBy: string | null = null;
  const cronSecret = process.env.CRON_SECRET || null;

  if (cronSecret && token === cronSecret) {
    requestedBy = "cron";
  } else {
    const u = await admin.auth.getUser(token);
    const user = u.data.user;
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    requestedBy = user.id;
    const prof = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!prof.data?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const run_id = String(body?.run_id || "").trim();
  if (!run_id) return NextResponse.json({ error: "Missing run_id" }, { status: 400 });

  const r = await promoteNextWaitlistPlayer(admin, run_id, { requestedBy, reason: "manual_or_hook" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });

  return NextResponse.json({ ok: true, promoted_user_id: r.promoted_user_id });
}

