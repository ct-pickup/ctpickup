import { NextResponse } from "next/server";

import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { pushRequestStatus } from "@/lib/fields/requestPush";
import { applyReply, parseReplyInput } from "@/lib/fields/venueReply";
import { supabaseService } from "@/lib/supabase/service";
import type { RequestStatus } from "@/shared/fields/requestEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/field-requests/reply?request_id=...
 * The replies recorded for a request, newest first, each with the venue fields it changed (and whether it was undone). Admin only.
 */
export async function GET(req: Request) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;
  const requestId = new URL(req.url).searchParams.get("request_id") ?? "";
  if (!requestId) return NextResponse.json({ error: "request_id is required." }, { status: 400 });
  const admin = supabaseService();
  const { data, error } = await admin.from("venue_replies").select("*").eq("request_id", requestId).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Could not load replies." }, { status: 500 });
  const replies = (data ?? []) as { id: string }[];
  const ids = replies.map((r) => r.id);
  const { data: ev } = ids.length ? await admin.from("venue_data_events").select("reply_id,field,undone_at").in("reply_id", ids) : { data: [] };
  const byReply = new Map<string, { field: string; undone_at: string | null }[]>();
  for (const e of (ev ?? []) as { reply_id: string; field: string; undone_at: string | null }[]) byReply.set(e.reply_id, [...(byReply.get(e.reply_id) ?? []), e]);
  return NextResponse.json({ ok: true, items: replies.map((r) => ({ ...r, changes: byReply.get(r.id) ?? [] })) });
}

/**
 * POST /api/admin/field-requests/reply  { request_id, apply_to_venue?, ...reply fields }
 * Records the venue's reply, moves the request (approved / declined / waiting on the venue), tells the player, and when
 * apply_to_venue is on (the default) writes the answers to the venue with an audit trail. Admin only.
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
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  if (!requestId) return NextResponse.json({ error: "request_id is required." }, { status: 400 });
  const parsed = parseReplyInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = supabaseService();
  try {
    const res = await applyReply(admin, { requestId, adminId: guard.userId, input: parsed.input, applyToVenue: body.apply_to_venue !== false });
    if (!res.ok) return NextResponse.json({ error: res.error === "request_missing" ? "Request not found." : "The field for this request no longer exists." }, { status: 404 });
    if (res.newStatus !== res.previousStatus) await pushRequestStatus(admin, requestId, res.request, res.newStatus as RequestStatus);
    return NextResponse.json({ ok: true, reply_id: res.replyId, mode: res.mode, fields: res.fields, status: res.newStatus });
  } catch (e) {
    console.error("[api/admin/field-requests/reply] failed", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "We couldn’t save that. Please try again." }, { status: 500 });
  }
}
