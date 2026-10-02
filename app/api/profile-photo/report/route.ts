import { NextResponse } from "next/server";

import { createPhotoReport } from "@/lib/profilePhoto/reports";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST { reported_user_id, reason?: "not_them" | "inappropriate" | "other" } */
export async function POST(req: Request) {
  const admin = getSupabaseAdmin();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data } = await admin.auth.getUser(token);
  const user = data.user;
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { reported_user_id?: unknown; reason?: unknown };
  const reportedUserId = typeof body.reported_user_id === "string" ? body.reported_user_id.trim() : "";
  if (!UUID_RE.test(reportedUserId)) return NextResponse.json({ error: "Player not found." }, { status: 400 });

  const res = await createPhotoReport(admin, { reporterId: user.id, reportedUserId, reason: body.reason });
  return NextResponse.json(res.body, { status: res.status });
}
