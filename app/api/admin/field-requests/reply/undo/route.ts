import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { undoReply } from "@/lib/fields/venueReply";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/field-requests/reply/undo  { reply_id }
 * Restores the old value of every venue field the reply changed (fields changed again since are left alone and reported),
 * and moves the request back to its earlier status if nobody moved it since. Admin only.
 */
export async function POST(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const replyId = typeof body.reply_id === "string" ? body.reply_id : "";
  if (!replyId) return NextResponse.json({ error: "reply_id is required." }, { status: 400 });
  try {
    const res = await undoReply(supabaseService(), replyId, guard.userId);
    if (!res.ok) return NextResponse.json({ error: res.error === "missing" ? "Reply not found." : "That reply was already undone.", code: res.error }, { status: res.error === "missing" ? 404 : 409 });
    return NextResponse.json({ ok: true, restored: res.restored, skipped: res.skipped, status_restored: res.statusRestored });
  } catch (e) {
    console.error("[api/admin/field-requests/reply/undo] failed", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "We couldn’t undo that. Please try again." }, { status: 500 });
  }
}
