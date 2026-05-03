import { NextResponse } from "next/server";
import { adminDeleteChatRoomById } from "@/lib/admin/chatRoomDelete";
import { requireAdminBearer } from "@/lib/admin/requireAdmin";
import { getSupabaseAdmin } from "@/lib/server/runtimeClients";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const guard = await requireAdminBearer(req);
  if (!guard.ok) return guard.response;

  const { roomId } = await ctx.params;
  const id = String(roomId || "").trim();
  if (!id) return NextResponse.json({ error: "Missing roomId" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if ("title" in body) patch.title = String(body.title || "").trim();
  if ("slug" in body) patch.slug = String(body.slug || "").trim();
  if ("is_active" in body) patch.is_active = body.is_active === false ? false : true;
  if ("announcements_only" in body) patch.announcements_only = body.announcements_only === true;
  if ("closes_at" in body) {
    const raw = body.closes_at == null || body.closes_at === "" ? null : String(body.closes_at);
    patch.closes_at = raw ? new Date(raw).toISOString() : null;
  }

  if ("slug" in patch && typeof patch.slug === "string") {
    const slug = patch.slug;
    if (!slug) return NextResponse.json({ error: "slug cannot be empty" }, { status: 400 });
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(slug)) {
      return NextResponse.json(
        { error: "slug must be 2-63 chars: letters, numbers, _ or -" },
        { status: 400 },
      );
    }
  }
  if ("title" in patch && typeof patch.title === "string") {
    if (!patch.title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("chat_rooms")
    .update(patch)
    .eq("id", id)
    .select("id,slug,title,is_active,announcements_only,closes_at,created_at,created_by")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  return NextResponse.json({ ok: true, room: data });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const guard = await requireAdminBearer(_req);
  if (!guard.ok) return guard.response;

  const { roomId } = await ctx.params;
  const result = await adminDeleteChatRoomById(roomId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, deleted: result.deleted });
}

