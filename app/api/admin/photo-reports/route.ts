import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { listOpenPhotoReports, reviewPhotoReports } from "@/lib/profilePhoto/reports";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

/** GET: open photo reports grouped by player. */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const res = await listOpenPhotoReports(getSupabaseAdmin());
  return NextResponse.json(res.body, { status: res.status });
}

/** POST { user_id, action: "remove" | "dismiss" } resolves every open report on that player. */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as { user_id?: unknown; action?: unknown };
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!userId) return NextResponse.json({ error: "Choose a player." }, { status: 400 });
  const res = await reviewPhotoReports(getSupabaseAdmin(), { adminId: guard.userId, userId, action: body.action });
  return NextResponse.json(res.body, { status: res.status });
}
